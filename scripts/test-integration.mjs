// Isolated fake-provider/Keiki test. No real provider or message traffic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const root=resolve(new URL('..',import.meta.url).pathname), temp=await mkdtemp(join(tmpdir(),'keiki-integration-test-'));
const notices=[],sessions=new Map();let creates=0,stops=0,child,logs='';
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const fake=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'http://localhost').pathname;
 if(path.endsWith('/notice')){notices.push(body);return json(res,{ok:true,queued:1,ran:0});}
 if(path==='/api/v1/computers'&&req.method==='GET')return json(res,{computers:[{id:'computer1',externalUserId:'imessage-keiki-+15555550111',os:'linux',status:'ready',mode:'agent'}]});
 if(path==='/api/v1/computers'&&req.method==='POST'){creates++;return json(res,{id:'computer1',status:'ready',mode:'agent'});}
 if(path.endsWith('/viewer'))return json(res,{url:fakeOrigin+'/computer/computer1?t=test-grant',expiresAt:new Date(Date.now()+600000).toISOString(),mode:body.mode});
 return json(res,{id:'computer1',status:'ready',mode:'agent'});
});
fake.listen(0,'127.0.0.1');await once(fake,'listening');const fakeOrigin='http://127.0.0.1:'+fake.address().port;
const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));const origin='http://127.0.0.1:'+port;
const call=async(path,input,session)=>{const r=await fetch(origin+path,{method:input===undefined?'GET':'POST',headers:{'content-type':'application/json',...(session?{'x-session':session}:{})},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,data:await r.json()};};
try{
 const vars={KEIKI_TOOL_SECRET:'test-tool',KEIKI_AGENT_ID:'test-agent',KEIKI_API_KEY:'fake-keiki',KEIKI_API_URL:fakeOrigin,MARITIME_TOKEN:'fake-maritime',MARITIME_API_URL:fakeOrigin};
 const envFile=join(temp,'.dev.vars');await writeFile(envFile,Object.entries(vars).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n'));
 const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js'),persist=join(temp,'state');
 execFileSync(process.execPath,[wrangler,'d1','execute','DB','--local','--persist-to',persist,'--file','migrations/0001_init.sql'],{cwd:root,stdio:'pipe'});
 child=spawn(process.execPath,[wrangler,'dev','--local','--persist-to',persist,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--env-file',envFile],{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)break;try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,'Worker failed to start: '+logs.slice(-2000));
 assert.equal((await call('/k/wrong/open',{userId:'+15555550111'})).status,403);
 const context={agentId:'test-agent',phone:'+15555550111'},opened=await call('/k/test-tool/open',{input:{},context});assert.equal(opened.status,200);assert.equal(opened.data.presentation.live,true);
 const url=new URL(opened.data.url),ref=url.pathname;let session;
 assert.equal((await call(ref+'/state')).status,401);
 const html=await(await fetch(origin+ref)).text();assert(html.includes('live-card'));assert(html.includes('card-glass.js'));
 const proof=randomBytes(32).toString('hex'),request=await call(ref+'/unlock/request',{proof});assert.equal(request.status,202);const id=request.data.requestId;
 assert.equal((await call('/k/test-tool/unlock',{input:{request_id:id},context})).status,403);
 assert.equal((await call('/k/test-tool/unlock',{input:{request_id:id},context:{...context,preflight:true}})).status,200);
 assert.equal((await call('/k/test-tool/unlock',{input:{request_id:id},context:{...context,approval:{actionId:'test-action',decidedVia:'chat'}}})).status,403);
 assert.equal((await call('/k/test-tool/unlock',{input:{request_id:id},context:{...context,approval:{actionId:'test-action',decidedVia:'keiki_vault'}}})).status,200);
 const unlocked=await call(ref+'/unlock/status',{requestId:id,proof});session=unlocked.data.session;assert(session);assert.equal((await call(ref+'/state',undefined,session)).status,200);
 assert.equal((await call(ref+'/viewer',{mode:'watch'},session)).status,200);assert.equal((await call(ref+'/viewer',{mode:'control'},session)).status,200);assert.equal((await call(ref+'/viewer',{mode:'watch'},session)).status,200);
 assert.equal((await call(ref+'/unlock/status',{requestId:id,proof:randomBytes(32).toString('hex')})).status,404);
 const other=await call('/k/test-tool/open',{input:{},context:{...context,phone:'+15555550222'}});assert.equal((await call(new URL(other.data.url).pathname+'/state',undefined,session)).status,401);
 console.log('PASS: standalone Worker, Keiki card, owner isolation, native approval enforcement and watch/control grants');
}finally{if(child){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);}fake.closeAllConnections();fake.close();await rm(temp,{recursive:true,force:true});}
