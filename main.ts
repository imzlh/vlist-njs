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
 * 文件传输Buffer
 */
const BUFFER_LENGTH = 128 * 1024;

/**
 * 允许文件传输
 */
const FILE_TRANSITION = true;

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
        'ctime': i.ctime,
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
    from = from[from.length -1] == '/' ? from : from + '/';
    to = to[to.length -1] == '/' ? to : to + '/';
    if(raw.isDirectory()){
        const dir = await fs.promises.readdir(from);
        for (let i = 0; i < dir.length; i++)
            await copy(from + dir[i], to + dir[i]);
            
    }else{
        const st = await fs.promises.open(from,'r'),
            en = await fs.promises.open(to,'w');
        while(true){
            // 64k 空间
            const buf = new Uint8Array(64 * 1024),
                readed = await st.read(buf, 0, 64 * 1024, null);
            
            // 读取完成
            if(readed.bytesRead == 0) break;

            // 写入
            en.write(buf, 0, readed.bytesRead, null);
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
 * 用于njs调用的主函数
 */
async function main(h:NginxHTTPRequest){
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

    // 文件服务
    if(FILE_TRANSITION && h.method == 'GET' && h.args.file)
    return (async function(){
        // 前提检测
        if(h.args.file.includes('..'))
            return h.return(403, 'Bad path');

        try{
            var path = APP_ROOT + '/' + h.args.file,
                file = await fs.promises.open(path, 'r'),
                stat = await file.stat();
        }catch(e){
            return h.return(403,'Access Failed: ' + (e instanceof Error ? e.message : new String(e)));
        }

        // 添加mime和修改时间
        h.headersOut['Content-Type'] = h.args.mime || 'application/octet-stream';
        h.headersOut['ETag'] = stat.ctimeMs.toString(36);

        // 检查是否有缓存
        let etag;
        h.rawHeadersIn.forEach(item => (item[0].toLowerCase() == 'etag') && (etag = item[1]));
        
        if (etag && etag == stat.ctimeMs.toString(36)) {
            h.headersOut['Content-Length'] = stat.size.toString();
            return h.return(304);
        } else {
            // 文件：服务文件
            if(h.headersIn['Range']){
                const range = h.headersIn['Range'].match(/^bytes=\s*([0-9]*)-([0-9]*)?/i);
                if(!range || (range[1] == '' && range[2] == ''))
                    return h.return(400,'Bad range');
                
                let start,end;
                // 倒数n个字符串
                if(range[1] == ''){
                    start = stat.size - parseInt(range[2]);
                    end = stat.size -1;
                // 正数n到最后面
                }else if(range[2] == ''){
                    start = parseInt(range[1]);
                    end = stat.size -1;
                // 两个都写明了
                }else{
                    start = parseInt(range[1]);
                    end = parseInt(range[2]);
                }

                if(end >= stat.size)
                    return h.return(416,"Out of fileSize($fsize)");
                else if(end < start)
                    return h.return(400,`Illegal range(#0:${start} >= #1:${end})`);
                
                h.status = 206;
                h.headersOut['Content-Length'] = (end - start +1).toString();
                h.headersOut['Content-Range'] = `bytes ${range[1]}-${(end || stat.size)-1}/${stat.size}`;
                h.sendHeader();

                let pos = start;
                do{
                    const read = pos + BUFFER_LENGTH > end ? end - pos : BUFFER_LENGTH,
                        readed = await file.read(
                            new Uint8Array(read), 0, read, pos
                        );
                    pos += readed.bytesRead;

                    h.send(readed.buffer);
                }while(pos != end);
            }else{
                h.headersOut['Content-Length'] = stat.size.toString();
                h.status = 200;
                h.sendHeader();
                while(true){
                    const readed = await file.read(
                            new Uint8Array(BUFFER_LENGTH), 0, BUFFER_LENGTH, null
                        );

                    h.send(
                        readed.bytesRead == BUFFER_LENGTH
                            ? readed.buffer
                            : readed.buffer.buffer.slice(0,readed.bytesRead)
                    );

                    if(readed.bytesRead != BUFFER_LENGTH) break;
                }
            }
        }
        h.finish();
    })() .catch(e => h.return(403, e instanceof Error ? e.message : new String(e).toString()));

    // 行为
    if(typeof h.args.action != 'string')
        return h.return(400,'invaild request: Action should be defined');

    // 读取body
    if(h.method != 'POST' || !h.requestText)
        return h.return(400,'Bad Method(POST only)');

    // 文件上传
    if(h.args.action == 'upload' && h.requestBuffer) 
        try{
            // 前提检测
            if(h.args.path.includes('..'))
                return h.return(403, 'Bad path');

            // 打开文件
            const file = await fs.promises.open(APP_ROOT + '/' + h.args.path,'w'),
                buf = new Uint8Array(h.requestBuffer.buffer);
            let readed = 0;
            while(buf.byteLength < readed)
                readed += (await file.write(buf, readed)).bytesWritten;

            return h.return(200);
        }catch(e){
            return h.return(403, 'Put Failed: ' + (e instanceof Error ? e.message : new String(e)));
        }

    // 读取JSON
    try{
        // 尝试解析JSON
        var request = JSON.parse(h.requestText);
        if(typeof request != 'object') throw 0;
    }catch(e){
        return h.return(400,'Bad JSON body');
    }

    switch(h.args.action){
        // 带有文件信息的列表
        case 'slist':{
            const dir = APP_ROOT + '/' + request.path;
            if(typeof dir != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('..'))
                return h.return(403, 'Bad path');
            // 尝试访问
            try{
                await fs.promises.access(dir,fs.constants.R_OK);
            }catch(e){
                return h.return(403,'Access Failed');
            }
            const res = [];
            const files = await fs.promises.readdir(dir);
            for (let i = 0; i < files.length; i++)
                try{
                    // 隐藏文件
                    if(HIDE_FILES(files[i])) continue;
                    const statres = await stat(dir + '/' + files[i],files[i]);
                    res.push(statres );
                }catch(e){
                    return h.return(403,'Access Failed');
                }
            h.headersOut['Content-Type'] = 'application/json';
            return h.return(200,JSON.stringify(res));
        }

        // 列表
        case 'list':{
            const dir = APP_ROOT + '/' + request.path;
            if(typeof dir != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('..'))
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

            h.headersOut['Content-Type'] = 'application/json';
            return h.return(200,JSON.stringify(files));
        }

        // 批量删除
        case 'delete':{
            if(!(request.files instanceof Array))
                return h.return(400,'invaild request: Missing `path` field');
            
            for (let i = 0; i < request.files.length; i++)
                try{
                    // 前提检测
                    if(request.files[i].includes('..'))
                        throw 'Bad path';
                    await del(APP_ROOT + '/' + request.files[i]);
                }catch(e){
                    return h.return(403,'Delete "' + request.files[i] + '" Failed: ' + (
                        e instanceof Error ? e.message : new String(e)
                    ));
                }

            return h.return(200);
        }

        // 获取单个文件信息
        case 'stat':{
            const file = APP_ROOT + '/' + request.path;
            if(typeof file != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            // 前提检测
            if(request.path.includes('..'))
                return h.return(403, 'Bad path');

            const res = await stat(file,file.split('/').pop() as string);
            h.headersOut['Content-Type'] = 'application/json';
            return h.return(200,JSON.stringify(res));
        }

        // 复制文件
        case  'copy':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            // 前提检测
            if(request.to.includes('..'))
                return h.return(403, 'Bad output path');
            try{
                const stato = await fs.promises.stat(APP_ROOT + '/' + request.to,{
                    throwIfNoEntry: true
                });
                if(!stato.isDirectory())
                    throw new Error('<to> is not a dir');
            }catch(e){
                return h.return(403, e instanceof Error ? e.message : new String(e).toString());
            }

            for (let i = 0; i < request.from.length; i++) try{

                // 前提检测
                if(request.from[i].includes('..'))
                    return h.return(403, 'Bad input path: ' + request.from[i]);

                const f = request.from[i] as string,
                    fname = f.match(/\/([^/]+)\/?$/);
                if(!fname) throw new Error('Unknown source ' + f);
                await copy(
                    APP_ROOT + '/' + request.from[i],
                    APP_ROOT + '/' + request.to + '/' + fname[1]
                );
            }catch(e){
                return h.return(403,'Copy ' + request.from[i] + ' Failed: ' + (
                    e instanceof Error ? e.message : new String(e)
                ));
            }
            return h.return(200);
        }

        // 移动文件
        case 'move':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            if(request.to.includes('..'))
                return h.return(403, 'Bad output path');

            const to = APP_ROOT + '/' + request.to,
                to_stat = await fs.promises.stat(to);

            if(!to_stat.isDirectory())
                return h.return(400,'<to> is not a dir');

            for (let i = 0; i < request.from.length; i++) try{
                // 前提检测
                if(request.from[i].includes('..'))
                    return h.return(403, 'Bad input path: ' + request.from[i]);

                const from = APP_ROOT + '/' + request.from[i],
                    stat = await fs.promises.stat(from);
                
                // 相同dev使用rename
                if(stat.dev == to_stat.dev){
                    await fs.promises.rename(from, to);
                // 不同dev先复制再删除
                }else{
                    await copy(from, to);
                    await del(from);
                }
            }catch(e){
                return h.return(403,'Move ' + request.from[i] + ' Failed: ' + (
                    e instanceof Error ? e.message : new String(e)
                ));
            }
            return h.return(200);
        }

        // 创建新文件
        case 'touch':{
            if(!(request.files instanceof Array))
                return h.return(400,'Param <files> is Not an array');

            const emptyBuffer = new Uint8Array();
            for (let i = 0; i < request.files.length; i++) try{
                // 前提检测
                if(request.files[i].includes('..'))
                    return h.return(403, 'Bad path: ' + request.files[i]);
                await fs.promises.writeFile(APP_ROOT + '/' + request.files[i] ,emptyBuffer ,{
                    mode: request.mode || 0o0755
                });
            }catch(e){
                return h.return(403,'Create File ' + request.files[i] + ' Failed: ' + (
                    e instanceof Error ? e.message : new String(e)
                ));
            }
            return h.return(200);
        }
        
        default:{
            return h.return(400,'Unknown mode');
        }
    }
}

export default { main };