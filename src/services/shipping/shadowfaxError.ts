export class ShadowfaxBookingError extends Error {
  constructor(message:string,public readonly rejected=false){super(message);this.name='ShadowfaxBookingError';}
}
export function shadowfaxErrorMessage(error:any):string {
  let value=error?.message||'Shadowfax request failed.';
  if(error?.response?.status)value=`Shadowfax HTTP ${error.response.status}. ${shadowfaxResponseErrors(error.response.data)||'Check carrier credentials, permissions and request data.'}`;
  return String(value).replace(/(?:Bearer|Token)\s+\S+/gi,'[credential hidden]').replace(/\b\d{10,}\b/g,'[number hidden]').slice(0,800);
}
export function shadowfaxResponseErrors(data:any):string {
  const messages:string[]=[];
  function read(value:any,path:string,depth:number){
    if(messages.length>=8||depth>4)return;
    if(typeof value==='string'){messages.push(`${path?path+': ':''}${value.slice(0,160)}`);return;}
    if(Array.isArray(value)){value.slice(0,8).forEach(v=>read(v,path,depth+1));return;}
    if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(!/token|secret|password|authorization|credential/i.test(key))read(v,[path,key].filter(Boolean).join('.'),depth+1);}
  }
  read(data?.errors,'',0);if(!messages.length)read(data?.error,'',0);
  return messages.join('; ');
}
