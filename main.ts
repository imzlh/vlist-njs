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

const APP_ROOT = '/mnt';

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

async function del(path: string) {
    const stat = await fs.promises.stat(path,{
        throwIfNoEntry: true
    });
    if(stat.isFile()) await fs.promises.unlink(path);
    else if(!stat.isDirectory()) return;

    path = path[path.length -1] == '/' ? path : path + '/';
    const items = await fs.promises.readdir(path);
    for (let i = 0; i < items.length; i++)
        await del(items[i]);
}

async function main(h:NginxHTTPRequest){
    // txt
    h.headersOut["Content-Type"] = 'text/plain';

    // 行为
    if(typeof h.args.action != 'string')
        return h.return(400,'invaild request: Action should be defined');

    // 读取body
    if(h.method != 'POST' || !h.requestText)
        return h.return(400,'Bad Method(POST only)');

    // 文件上传
    if(h.args.action == 'upload' && h.requestBuffer) 
        try{
            const file = await fs.promises.open(APP_ROOT + '/' + h.args.path,'w'),
                buf = new Uint8Array(h.requestBuffer.buffer);
            let readed = 0;
            while(buf.byteLength < readed)
                readed += (await file.write(buf, readed)).bytesWritten;

            return h.return(200);
        }catch(e){
            return h.return(403, 'Put Failed: ' + (e instanceof Error ? e.message : e));
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
            try{
                await fs.promises.access(dir,fs.constants.R_OK);
            }catch(e){
                return h.return(403,'Access Failed');
            }
            const res = [];
            const files = await fs.promises.readdir(dir);
            for (let i = 0; i < files.length; i++)
                try{
                    const statres = await stat(dir + '/' + files[i],files[i]);
                    res.push(statres );
                }catch(e){
                    return h.return(403,'Access Failed');
                }
            return h.return(200,JSON.stringify(res));
        }

        // 列表
        case 'list':{
            const dir = APP_ROOT + '/' + request.path;
            if(typeof dir != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            try{
                await fs.promises.access(dir,fs.constants.R_OK);
            }catch(e){
                return h.return(403,'Access Failed');
            }
            const files = await fs.promises.readdir(dir);
            return h.return(200,JSON.stringify(files));
        }

        // 批量删除
        case 'delete':{
            const dir = APP_ROOT + '/' + request.path;
            if(typeof dir != 'string' || !(request.files instanceof Array))
                return h.return(400,'invaild request: Missing `path` field');
            try{
                await fs.promises.access(dir,fs.constants.R_OK);
            }catch(e){
                return h.return(403,'Access Failed');
            }
            
            for (let i = 0; i < request.files.length; i++)
                try{
                    await del(request.files[i]);
                }catch(e){
                    return h.return(403,'Move Failed: ' + (
                        e instanceof Error ? e.message : e
                    ));
                }

            return h.return(200,'1');
        }

        // 获取单个文件信息
        case 'stat':{
            const file = APP_ROOT + '/' + request.path;
            if(typeof file != 'string')
                return h.return(400,'invaild request: Missing `path` field');
            const res = await stat(file,file.split('/').pop() as string);
            return h.return(200,JSON.stringify(res));
        }

        // 复制文件
        case  'copy':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            try{
                for (let i = 0; i < request.from.length; i++)
                    await copy(APP_ROOT + '/' + request.from[i],APP_ROOT + '/' + request.to);
            }catch(e){
                return h.return(403,'Move Failed: ' + (
                    e instanceof Error ? e.message : e
                ));
            }
            return h.return(200,'');
        }

        // 移动文件
        case 'move':{
            if(!(request.from instanceof Array))
                return h.return(400,'Request param <from> Is Not an array');
            if(!request.to)
                return h.return(400,'No Destination(to) found');
            try{
                for (let i = 0; i < request.from.length; i++)
                    await fs.promises.rename(APP_ROOT + '/' + request.from[i],APP_ROOT + '/' + request.to);
            }catch(e){
                return h.return(403,'Move Failed: ' + (
                    e instanceof Error ? e.message : e
                ));
            }
            return h.return(200,'');
        }

        // 创建新文件
        case 'touch':{
            if(!(request.files instanceof Array))
                return h.return(400,'Param <files> is Not an array');

            try{
                const emptyBuffer = new Uint8Array();
                for (let i = 0; i < request.files.length; i++)
                    await fs.promises.writeFile(APP_ROOT + '/' + request.files[i] ,emptyBuffer ,{
                        mode: request.mode || 0o0755
                    });
            }catch(e){
                return h.return(403,'Create File Failed: ' + (
                    e instanceof Error ? e.message : e
                ));
            }
            return h.return(200,'');
        }
        
        default:{
            return h.return(400,'Unknown mode');
        }
    }
}

export default { main };