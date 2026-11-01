import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw new Error('Storage unavailable');return env.DB;}
export async function get<T>(namespace:string,key:string):Promise<T|null>{const row=await database().prepare('SELECT value FROM mini_records WHERE namespace=? AND key=?').bind(namespace,key).first<{value:string}>();return row?JSON.parse(row.value):null;}
