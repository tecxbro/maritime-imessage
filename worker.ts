import {handleService} from './lib/service';
export default {async fetch(request:Request,_env:Cloudflare.Env,ctx:ExecutionContext){return await handleService(request,ctx)??new Response('Open a live card through your Keiki tool.',{status:404});}};
