import{spawn}from'node:child_process';import{dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';
const root=dirname(fileURLToPath(import.meta.url));const blocked=resolve('D:/desktop/文档/secret').toLowerCase();if(root.toLowerCase().startsWith(blocked))throw Error('Protected path');
const url='http://127.0.0.1:4188';
async function ready(){try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});return r.ok&&(await r.text()).includes('<title>宇的大观本地版</title>')}catch{return false}}
if(!await ready()){const child=spawn(process.execPath,[resolve(root,'serve.mjs')],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});child.unref();for(let n=0;n<20&&!await ready();n++)await new Promise(r=>setTimeout(r,200))}
if(!await ready())throw Error('无法启动离线题库，请确认本机4188端口未被其他程序占用。也可直接双击宇的大观本地版.html。');
spawn('cmd.exe',['/c','start','',url],{stdio:'ignore',windowsHide:true}).unref();console.log('已打开宇的大观本地版。');
