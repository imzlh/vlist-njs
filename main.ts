/// <reference path="type/index.d.ts" />
/// <reference path="type/ngx_http_js_module.d.ts" />

/**
 * vList5 njs API interface
 * use `tsc` to compile the source file
 * 
 * @version 1.0
 * @copyright izGroup
 * @license MIT
 */

import fs from "fs";

/**
 * 应用根目录，暴露在list下
 */
const APP_ROOT = '/mnt';

/**
 * 检验文件是否应该被隐藏
 */
const HIDE_FILES = (name: string) => name[0] == '.';

/**
 * 允许跨域
 */
const CORS_ENABLE = true;

/**
 * 避免身份认证的方式
 */
const AUTH_IGNORE = [
    'list',
    'slist'
];

/**
 * 获取单个文件的状态
 * @param file 文件路径
 * @param name 文件实际名称
 * @returns stat后的数据结构
 */
async function stat(file: string,name: string) {
    const i = await fs.promises.stat(file,{
        throwIfNoEntry: true
    });
    return {
        'type': i.isDirectory() ? 'dir' : 'file',
        'name': name,
        'ctime': i.ctime.getTime(),
        'access': i.mode,
        'size': i.size
    };
}

/**
 * 复制文件(夹)
 * 需要对应，如文件不能拷贝到文件夹上
 * @param from 源文件（夹）
 * @param to 目标文件（夹）
 */
async function copy(from: string,to: string) {
    const raw = await fs.promises.stat(from,{
        throwIfNoEntry: true
    });

    // format
    if(raw.isDirectory()){
        // 验证文件夹
        try{
            const dest = await fs.promises.stat(to, {
                throwIfNoEntry: true
            });
            var dest_is_dir = dest.isDirectory();
        }catch(e){
            // 尝试创建文件夹
            try{
                await fs.promises.mkdir(to);
                var dest_is_dir = true;
            }catch(e){
                throw new Error('Access failed');
            }
        }

        if(!dest_is_dir)
            throw new Error('Destination is not a dir');
        
        // 格式化
        from = format(from, true);
        to = format(to, true);

        // 尝试依次复制
        const dir = await fs.promises.readdir(from);
        for (let i = 0; i < dir.length; i++)
            await copy(from + dir[i], to + dir[i]);
    }else if(raw.isFile()){
        // 验证文件是否存在
        try{
            const dest = await fs.promises.stat(to, {
                throwIfNoEntry: true
            });

            // 格式化
            if(dest.isDirectory())
                to = format(to, true) + format(from,false).split('/').pop();
            else
                to = format(to, false);
        }catch(e){
            // 文件不存在
            let dest = format(to, false);
            dest = dest.substring(0, dest.lastIndexOf('/') +1);
            try{
                // 检验父文件夹是文件夹
                const dest_stat = await fs.promises.stat(dest,{
                    throwIfNoEntry: true
                });
                if(!dest_stat.isDirectory())
                    throw new Error('Parent Path(' + dest + ') is not a dir');
            }catch(e){
                try{
                    await fs.promises.mkdir(dest);
                }catch(e){
                    throw new Error('Copy abort: Create dir failed')
                }
            }
        }

        // 打开文件并复制
        const st = await fs.promises.open(from,'r'),
            en = await fs.promises.open(to,'w');
        while(true){
            // 64k 空间
            const buf = new Uint8Array(64 * 1024),
                readed = await st.read(buf, 0, 64 * 1024, null);
            
            // 读取完成
            if(readed.bytesRead == 0) break;

            // 防漏式写入
            let writed = 0;
            do{
                const write = await en.write(buf, writed, readed.bytesRead - writed, null);
                writed += write.bytesWritten;
            }while(writed != readed.bytesRead);
        }
    }
}

/**
 * 批量删除，支持删除目录
 * @param path 路径
 */
async function del(path: string) {
    try{
        var stat = await fs.promises.stat(path,{
            throwIfNoEntry: true
        });
    }catch(e){
        throw new Error('Failed to stat(): ' + (e instanceof Error ? e.message : new String(e)));
    }
    if(stat.isFile()) return await fs.promises.unlink(path);
    else if(!stat.isDirectory()) return;

    path = path[path.length -1] == '/' ? path : path + '/';
    const items = await fs.promises.readdir(path);
    for (let i = 0; i < items.length; i++)
        await del(path + items[i]);

    // 删除空目录
    await fs.promises.rmdir(path);
}

/**
 * 异步Array.filter
 * @param items Array
 * @param callback 同Array.filter的callback
 * @returns filter后的array
 */
async function asyncFilter<T>(items: Array<T>, callback: (item: T, index: number) => Promise<boolean>): Promise<Array<T>> {
    const out = [] as Array<T>;
    for (let i = 0; i < items.length; i++)
        if(await callback(items[i], i))
            out.push(items[i]);
    return out;
}

/**
 * 格式化路径
 * @param path 路径
 * @param is_dir 是文件夹，那么末尾会带上"/"
 * @returns 格式化后的路径
 */
function format(path: string, is_dir: boolean | undefined){
    path = path.replace(/[\/\\]+/,'/');
    if(is_dir && path[path.length -1] != '/') return path + '/';
    else if(!is_dir && path[path.length -1] == '/' ) return path.substring(0, path.length -1);
    else return path;
}

const b64ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const b64chs = Array.prototype.slice.call(b64ch);

/**
 * base64编码
 * @param buf 输入
 * @returns 输出
 */
function base64_encode(buf: ArrayBuffer){
    const bin = new Uint8Array(buf);
    let u32, c0, c1, c2, asc = '';
    const pad = bin.length % 3;
    for (let i = 0; i < bin.length;) {
        c0 = bin[i++],
        c1 = bin[i++],
        c2 = bin[i++];

        u32 = (c0 << 16) | (c1 << 8) | c2;
        asc += b64chs[u32 >> 18 & 63]
            + b64chs[u32 >> 12 & 63]
            + b64chs[u32 >> 6 & 63]
            + b64chs[u32 & 63];
    }
    return pad ? asc.slice(0, pad - 3) + "===".substring(pad) : asc;
}

/**
 * 为双方安全传输编码的函数
 * @param ctxlen 消息长度
 * @param pass 密码
 * @returns 加密后的信息
 */
async function encrypto(ctxlen: number, pass: string, content: string):Promise<string>{
    // 验证时间有效性: 10s内
    const timestrap = Date.now() / 1000;
    let timecode = Math.floor(timestrap / 10);
    if(timestrap % 10 > 5)
        timecode += 1;

    // 打乱pass，验证消息有效性
    const pass_code = new TextEncoder().encode(pass),
        encrypto = timecode & ctxlen;
    let safeCode = 0;
    for (let i = 0; i < pass_code.length; i++) 
        safeCode += (pass_code[i] << (4 * i % 4)) & (pass_code[i] >> 4);
    const hmac_key = (safeCode ^ encrypto).toString(20);

    // hmac+sha1加密
    const hmac = await crypto.subtle.importKey(
        'raw', 
        new TextEncoder().encode(hmac_key),
        {
            "name": "HMAC",
            "hash": "SHA-1"
        },
        false,
        ['sign']
    );
        var value = await crypto.subtle.sign('HMAC', hmac, content);

    return base64_encode(value);
}

/**
 * 用于njs调用的主函数
 */
async function main(h:NginxHTTPRequest){
    // 错误handle
    function _error(e: any, sub?: string, code?: number){
        h.return(code || 403, 
            (sub || 'Core') + ' Error: ' + (
            e instanceof Error
                ? '[' + e.name + '] ' + e.message + '\n' + ((e.stack && e.stack[0]) || '')
                : new String(e).toString()
            )
        );
        ngx.log(ngx.ERR, new String(e).toString());
    }

    // 返回json
    function _json(obj: Object){
        // 发送header
        h.headersOut['Transfer-Encoding'] = 'chunked';
        h.status = 200;
        try{ h.sendHeader(); }catch(e){}
        
        // 编码一项
        function encode_obj(o: Record<string, any>){
            const keys = Object.keys(o), length = keys.length;

            h.send('{');

            // 依次编码
            for (let i = 0 ; i < length ; i++) {
                if (!Object.prototype.hasOwnProperty.call(o, keys[i])) continue;
                switch(typeof o[keys[i]]){
                    case "string":
                        h.send(`"${keys[i].replace('"','\"')}": "${o[keys[i]]}"`);
                    break;

                    case "bigint":
                    case "number":
                        h.send(`"${keys[i].replace('"','\"')}": ${o[keys[i]]}`);
                    break;

                    case "boolean":
                        h.send(`"${keys[i].replace('"','\"')}": ${o[keys[i]] ? 'true' : 'false'}`);
                    break;

                    case "object":
                        h.send(`"${keys[i].replace('"','\"')}": `);
                        if(h instanceof Array)
                            encode_arr(h);
                        else
                            encode_obj(o);
                    break;

                    default:
                    continue;
                }

                // 不是最后一个：加逗号
                if(length-1 != i) h.send(',');
                
            }
            
            h.send('}');
        }

        // 编码Array
        function encode_arr(arr:Array<any>){

            h.send('[');

            for (let i = 0 ; i < arr.length ; i++) {
                switch(typeof arr[i]){
                    case "string":
                        h.send(`"${arr[i]}"`);
                    break;

                    case "bigint":
                    case "number":
                        h.send(arr[i].toString());
                    break;

                    case "boolean":
                        h.send(arr[i] ? 'true' : 'false');
                    break;

                    case "object":
                        if(h instanceof Array)
                            encode_arr(arr[i]);
                        else
                            encode_obj(arr[i]);
                    break;

                    default:
                    continue;
                }

                // 不是最后一个：加逗号
                if(arr.length -1 != i) h.send(',');
            }

            h.send(']');
        }

        // 开始编码
        encode_obj(obj);
        h.finish();
    }

    // txt
    h.headersOut["Content-Type"] = 'text/plain';

    // CORS 预检
    if(CORS_ENABLE)
        h.rawHeadersOut.push(
            ['Access-Control-Allow-Origin', '*'],
            ['Access-Control-Request-Method', 'GET, POST, OPTIONS'],
            ['Access-Control-Allow-Headers', 'Content-Type, Token']
        );
    if(h.method == 'OPTIONS'){
        h.headersOut['Allow'] = 'OPTIONS, GET, POST';
        return h.return(204);
    }

    // 行为
    if(typeof h.args.action != 'string')
        return h.return(400,'invaild request: Action should be defined');

    // 获取authkey
    const AUTHKEY = h.variables.authkey as string;

    // 文件上传提前检测
    if(h.args.action == 'upload' && h.method == 'GET' && h.args.length && h.args.path){
        if(!AUTH_IGNORE.includes('upload')){
            if(
                !h.headersIn['Authorization'] ||
                h.headersIn['Authorization'] != await encrypto(
                    parseInt(h.args.length),
                    AUTHKEY,
                    h.args.path
                )
            ) return h.return(401, 'auth precheck failed');
        }
        try{
            await fs.promises.writeFile(APP_ROOT + '/' + format(h.args.path,false), '');
        }catch(e){
            return _error(e, 'PreUpload');
        }
        return h.return(204);
    }

    // 读取body: POST 且 长度 > 0
    if(h.method != 'POST' || !h.headersIn['Content-Length'] || h.headersIn['Content-Length'] == '0')
        return h.return(400,'Bad Method(POST only or losing BODY)');

    // 文件上传
    if(h.args.action == 'upload')
        try{
            // 前提检测
            if(h.args.path.includes('/../'))
                return h.return(403, 'Bad path');

            // 加密检测
            if(
                !AUTH_IGNORE.includes('upload') && (
                !h.headersIn['Authorization'] || 
                h.headersIn['Authorization'] != await encrypto(
                    parseInt(h.headersIn['Content-Length']),
                    AUTHKEY,
                    h.args.path
                )
            )) return h.return(401, 'require auth');

            // 开始上传
            const dest = APP_ROOT + '/' + format(h.args.path,false);
            try{
                // 内容不在内存中
                if(h.requestBuffer && h.requestBuffer.length == 0) throw 0;
            }catch(_e){
                // 尝试读取文件
                const file = h.variables.request_body_file;
                if(!file) return h.return(500, 'Body read failed');
                const from = await fs.promises.open(file, 'r'),
                    to = await fs.promises.open(dest, 'w');
                // 循环写入文件
                while(true){
                    const buf = new Uint8Array(8 * 1024),
                        readed = await from.read(buf, 0, buf.byteLength, null);
                    if(readed.bytesRead == 0) break;
                    to.write(buf, 0, readed.bytesRead, null);
                }
                return h.return(204);
            }
            
            // 写入Buffer
            await fs.promises.writeFile(dest, h.requestBuffer as Buffer,{
                "flag": 'w',
                "mode": 0o755
            });
            return h.return(204);
        }catch(e){
            return _error(e, 'Upload');
        }

    // 读取JSON
    try{
        let text = '';
        try{
            // 在Buffer内：直接可以使用
            if(!h.requestText) throw 1;
            text = h.requestText;
        }catch(_e){
            // 在文件中：打开
            const file = h.variables.request_body_file;
            if(!file) return h.return(500, 'Body read failed');
            text = (await fs.promises.readFile(file)).toString('utf8');
        }

        // 尝试身份认证
        if(
            !AUTH_IGNORE.includes(h.args.action) &&
            (!h.headersIn['Authorization'] || 
            h.headersIn['Authorization'] != await encrypto(
                parseInt(h.headersIn['Content-Length']),
                AUTHKEY,
                text
            ))
        ) return h.return(401, 'Auth required');

        // 尝试解析JSON
        var request = JSON.parse(text);
        if(typeof request != 'object') throw 0;
    }catch(e){
        return h.return(400,'Bad JSON body');
    }

    // 判断模式
    switch(h.args.action){
        // 带有文件信息的列表
        case 'slist':{
            const dir = APP_ROOT + '/' + format(request.path, true);
            if(typeof dir != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('/../'))
                return h.return(403, 'Bad path');
            // 尝试访问
            try{
                var files = await fs.promises.readdir(dir);
            }catch(e){
                return h.return(403,'Access Failed');
            }
            // 循环读取文件
            const res = [];
            for (let i = 0; i < files.length; i++)
                try{
                    // 隐藏文件
                    if(HIDE_FILES(files[i])) continue;
                    const statres = await stat(dir + '/' + files[i],files[i]);
                    res.push(statres);
                }catch(e){
                    return h.return(403,'Access Failed');
                }
            return h.return(200, JSON.stringify(res));
            // return _json(res);
        }

        // 列表
        case 'list':{
            const dir = APP_ROOT + '/' + request.path;
            if(typeof dir != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('/../'))
                return h.return(403, 'Bad path');

            try{
                await fs.promises.access(dir,fs.constants.R_OK);
            }catch(e){
                return h.return(403,'Access Failed');
            }

            let files = await fs.promises.readdir(dir);
            
            // filter
            try{
                // 名称正则匹配
                if(request.select == 'name'){
                    const regexp = new RegExp(request.reg, 'i');
                    files.filter(item => !HIDE_FILES(item) && regexp.test(item));

                // 文件类型匹配
                }else if(request.select == 'type'){
                    files = await asyncFilter(files, async item => {
                        if(HIDE_FILES(item)) return false;
                        const stat = await fs.promises.stat(dir + '/' + item);
                        return (
                            request.type == 'dir'
                                ? stat.isDirectory()
                                : !stat.isDirectory()
                        );
                    })

                // 文件大小匹配
                }else if(request.select == 'size'){
                    files = await asyncFilter(files, async item => {
                        if(HIDE_FILES(item)) return false;
                        const stat = await fs.promises.stat(dir + '/' + item);
                        if(typeof request.min == 'number' && stat.size < request.min)
                            return false;
                        if(typeof request.max == 'number' && stat.size > request.max)
                            return false;
                        return true;
                    });

                // 文件模式匹配
                }else if(request.select == 'mode'){
                    const mode = ({
                        r: fs.constants.R_OK,
                        w: fs.constants.W_OK,
                        x: fs.constants.X_OK
                    } as Record<string, number>)[request.mode] || fs.constants.F_OK;

                    files = await asyncFilter(files, async item => {
                        try{
                            if(HIDE_FILES(item)) return false;
                            await fs.promises.access(dir + '/' + item, mode);
                            return true;
                        }catch(e){
                            return false;
                        }
                    });
                }
            }catch(e){
                h.headersOut['Warning'] = 'Select Failed: ' + (
                    e instanceof Error ? e.message : new String(e)
                );
            }

            // return _json(files);
            return h.return(200, JSON.stringify(files));
        }

        // 批量删除
        case 'delete':{
            if(!(request.files instanceof Array))
                return h.return(400,'invaild request: Missing `path` field');
            
            for (let i = 0; i < request.files.length; i++)
                try{
                    // 前提检测
                    if(request.files[i].includes('/../'))
                        throw 'Bad path';
                    await del(APP_ROOT + '/' + request.files[i]);
                }catch(e){
                    return _error(e, 'Delete');
                }

            return h.return(204);
        }

        // 获取单个文件信息
        case 'stat':{
            const file = APP_ROOT + '/' + request.path;
            if(typeof file != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('/../'))
                return h.return(403, 'Bad path');
            try{
                const res = await stat(file,file.split('/').pop() as string);
                h.headersOut['Content-Type'] = 'application/json';
                // return _json(res);
                return h.return(200, JSON.stringify(res));
            }catch(e){
                return _error(e, 'Stat');
            }
        }

        // 复制文件
        case  'copy':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            // 前提检测
            if(request.to.includes('/../'))
                return h.return(403, 'Bad output path');
            try{
                const stato = await fs.promises.stat(APP_ROOT + '/' + request.to,{
                    throwIfNoEntry: true
                });
                if(!stato.isDirectory())
                    throw new Error('<to> is not a dir');
            }catch(e){
                return _error(e);
            }

            for (let i = 0; i < request.from.length; i++) try{
                // 前提检测
                if(request.from[i].includes('/../'))
                    return h.return(403, 'Bad input path: ' + request.from[i]);

                const f = request.from[i] as string,
                    fname = f.match(/\/([^/]+)\/?$/);
                if(!fname) throw new Error('Unknown source ' + f);
                await copy(
                    APP_ROOT + '/' + request.from[i],
                    APP_ROOT + '/' + request.to + '/' + fname[i]
                );
            }catch(e){
                return _error(e, 'Copy')
            }
            return h.return(204);
        }

        // 重命名文件
        case 'rename':{
            for (let from in request) try{
                if(typeof request[from] != 'string' || (from + request[from]).includes('/../'))
                    throw 'Bad Path';

                const to = APP_ROOT + '/' + request[from];
                from = APP_ROOT + '/' + from;

                await fs.promises.rename(from, to);
            }catch(e){
                return _error(e, 'Rename');
            }
            return h.return(204);
        }

        // 移动文件
        case 'move':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            if(request.to.includes('/../'))
                return h.return(403, 'Bad output path');

            const to = APP_ROOT + '/' + format(request.to, true),
                to_stat = await fs.promises.stat(to);

            if(!to_stat.isDirectory())
                return h.return(400,'<to> is not a dir');

            for (let i = 0; i < request.from.length; i++) try{
                // 前提检测
                if(request.from[i].includes('/../'))
                    return h.return(403, 'Bad input path: ' + request.from[i]);

                const from = APP_ROOT + '/' + format(request.from[i], false),
                    from_stat = await fs.promises.stat(from);
                
                // 相同dev使用rename
                if(from_stat.dev == to_stat.dev){
                    await fs.promises.rename(from, to + from.split('/').pop());
                // 不同dev先复制再删除
                }else{
                    await copy(from, to);
                    try{
                        // del使用不同的try...catch
                        await del(from);
                    }catch(e){
                        throw new Error('Move abort. Reason: Delete failed:' + 
                            (e as Error).message
                        );
                    }
                }
            }catch(e){
                return _error(e, 'Move');
            }
            return h.return(204);
        }

        // 创建新文件
        case 'touch':{
            if(!(request.files instanceof Array))
                return h.return(400,'Param <files> is Not an array');

            const emptyBuffer = new Uint8Array();
            for (let i = 0; i < request.files.length; i++) try{
                // 前提检测
                if(request.files[i].includes('/../'))
                    return h.return(403, 'Bad path: ' + request.files[i]);
                await fs.promises.writeFile(APP_ROOT + '/' + request.files[i] ,emptyBuffer ,{
                    mode: request.mode || 0o0755
                });
            }catch(e){
                return _error(e, 'Create File')
            }
            return h.return(204);
        }
        
        default:{
            return h.return(400,'Unknown mode');
        }
    }
}

export default { main: (h:NginxHTTPRequest) => main(h).catch(() => void 0) };