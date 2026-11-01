import {env} from 'cloudflare:workers';
import {createLiveMini,LiveError,verifyKeikiWebhook,type LiveProvider,type LiveRecord} from 'keiki-live-mini';
import {D1Store,cloudflareRuntime} from 'keiki-live-mini/cloudflare';
import {database,get} from './store';
import {sessionRef} from './pairing';
import {validProof,requestUnlock,notifyUnlock,unlockForOwner,approveUnlock,unlockStatus} from './unlock';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** Small compatibility host; sessions, provider lifecycle, assets and viewer are SDK-owned. */
export function workerHost(provider:LiveProvider,access:'link'|'face-id') {
 return async function handleService(request:Request,ctx:ExecutionContext):Promise<Response|null> {
  const url=new URL(request.url),store=new D1Store(database());
  const live=createLiveMini({origin:url.origin,providers:[provider],store,runtime:cloudflareRuntime(ctx),access,
   authorize:async(req,record)=>await sessionRef(req.headers.get('x-session'),true)===record.ref,
   ...(env.KEIKI_WEBHOOK_SECRET?{webhook:{secret:env.KEIKI_WEBHOOK_SECRET,resolveOwner:(context:any)=>{
    if(typeof context?.phone!=='string'||(env.KEIKI_AGENT_ID&&context.agentId!==env.KEIKI_AGENT_ID))throw new LiveError('Trusted sender required',403);
    return context.phone;
   }}}:{})});
  try {
   if(url.pathname==='/healthz')return json({ok:true});
   const tool=/^\/k\/([^/]+)\/(open|interactive|browser-use|unlock|state|task|cancel)$/.exec(url.pathname);
   if(tool){
    if(request.method!=='POST')return json({error:'method'},405);
    if(!env.KEIKI_TOOL_SECRET||tool[1]!==env.KEIKI_TOOL_SECRET)return json({error:'bad key'},403);
    const raw=await request.text();if(raw.length>65536)return json({error:'Request too large'},413);
    if(env.KEIKI_WEBHOOK_SECRET&&!await verifyKeikiWebhook(request,raw,env.KEIKI_WEBHOOK_SECRET))return json({error:'Invalid Keiki signature'},401);
    const envelope=JSON.parse(raw),context=envelope.context,input=envelope.input??{};
    if(!context||typeof context.phone!=='string'||(env.KEIKI_AGENT_ID&&context.agentId!==env.KEIKI_AGENT_ID))return json({error:'trusted sender required'},403);
    const owner=context.phone;
    if(tool[2]==='unlock'){
     if(access!=='face-id')return json({error:'Unlock unavailable'},409);
     const record=typeof input.request_id==='string'&&await unlockForOwner(input.request_id,owner);
     if(!record)return json({error:'Unlock request not owned or expired'},403);
     if(context.preflight===true)return json({status:'ready'});
     if(context.approval?.decidedVia!=='keiki_vault'||typeof context.approval.actionId!=='string'||!context.approval.actionId)return json({error:'Face ID approval required'},403);
     const ok=await approveUnlock(record,context.approval.actionId);return json({ok,status:ok?'unlocked':'rejected'},ok?200:409);
    }
    if(['open','interactive','browser-use'].includes(tool[2]))return json(await live.open({owner,providerId:provider.id,sessionKey:'default',intentId:input.intentId??context.toolCallId??crypto.randomUUID(),live:tool[2]!=='interactive'&&input.live!==false}));
    const record=await live.attach({owner,providerId:provider.id,sessionKey:'default',managed:true,access});
    if(tool[2]==='state')return json(await live.state(owner,record.ref));
    return json(await live.action(owner,record.ref,tool[2]==='cancel'?'cancel':'task',input));
   }
   const unlock=/^\/vm\/([A-Za-z0-9_]+)\/unlock\/(request|status)$/.exec(url.pathname);
   if(unlock){
    if(access!=='face-id')return json({error:'Unlock unavailable'},409);
    if(request.method!=='POST')return json({error:'method'},405);
    const record=await store.get<LiveRecord>('liveSessions',unlock[1]);if(!record)return json({error:'not found'},404);
    const raw=await request.text();if(raw.length>65536)return json({error:'Request too large'},413);const input=JSON.parse(raw);
    if(!validProof(input.proof))return json({error:'Invalid proof'},400);
    if(unlock[2]==='status'){const status=await unlockStatus(record.ref,input.requestId,input.proof);return status?json(status):json({error:'not found'},404);}
    const pending=await requestUnlock(record.ref,record.owner,input.proof,input.sheet===true);
    if(!pending)return json({error:'Please wait before requesting another unlock'},429);
    if(pending.created)ctx.waitUntil(notifyUnlock(pending.id));return json({requestId:pending.id,expiresAt:pending.expiresAt},202);
   }
   return live.fetch(request);
  }catch(error){return error instanceof LiveError?json({error:error.message,code:error.code},error.status):json({error:'Live session unavailable'},502);}
 };
}
