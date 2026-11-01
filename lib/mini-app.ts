import {renderCard} from 'keiki-live-mini';
import {maritimeProvider} from 'keiki-live-mini-demo-adapters/maritime';
const adapter=maritimeProvider({});
export function page(binding:{ref:string}){return renderCard({ref:binding.ref,label:adapter.label,transport:adapter.transport,access:'face-id',readiness:adapter.readiness,capabilities:{...adapter.capabilities,cancel:false}});}
