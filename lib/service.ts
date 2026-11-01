import {env} from 'cloudflare:workers';
import {cloudflareRuntime} from 'keiki-live-mini/cloudflare';
import {maritimeProvider} from 'keiki-live-mini-demo-adapters/maritime';
import {workerHost} from './host';
export function handleService(request:Request,ctx:ExecutionContext){return workerHost(maritimeProvider({apiKey:env.MARITIME_TOKEN,apiUrl:env.MARITIME_API_URL}),'face-id')(request,ctx);}
