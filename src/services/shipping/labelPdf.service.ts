import https from 'node:https';
import {promises as dns} from 'node:dns';
import {isIP,BlockList} from 'node:net';

const blocked=new BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,prefix,'ipv4');
export function publicLabelAddress(ip:string){return isIP(ip)===4&&!blocked.check(ip,'ipv4');}
export function labelDownloadUrl(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw Error('Carrier returned an unsafe label URL.');
  return url;
}
export function validateLabelPdf(bytes:Buffer){
  if(bytes.length>10*1024*1024)throw Error('Carrier label exceeds the 10 MB limit.');
  if(bytes.subarray(0,5).toString()!=='%PDF-'||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw Error('Carrier did not return a complete PDF. Generate the label again for this shipment; do not rebook.');
  return bytes;
}

// Call only with a URL returned by the saved shipment's carrier. No credentials
// are forwarded. Every redirect resolves and pins a public IPv4 to stop SSRF.
export async function downloadLabelPdf(value:string,redirects=0,deadline=Date.now()+20000):Promise<Buffer>{
  if(redirects>3)throw Error('Carrier label redirected too many times.');
  const url=labelDownloadUrl(value),remaining=deadline-Date.now();
  if(remaining<=0)throw Error('Carrier label download timed out.');
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([
    isIP(url.hostname)?Promise.resolve([url.hostname]):dns.lookup(url.hostname,{family:4,all:true}).then(rows=>rows.map(row=>row.address)),
    new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('Carrier label DNS lookup timed out.')),remaining)})
  ]).catch(()=>{throw Error('The API server could not resolve the carrier PDF host. Open the carrier label link below, or correct the server DNS/network settings and retry.');}).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(ip=>!publicLabelAddress(ip)))throw Error('Carrier label host must resolve to a public IPv4 address.');
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const fail=(error:Error)=>{clearTimeout(timer);reject(error)};
    const request=https.get(url,{agent:false,family:4,lookup:((_host:any,options:any,callback:any)=>options?.all?callback(null,[{address:addresses[0],family:4}]):callback(null,addresses[0],4)) as any,headers:{Accept:'application/pdf','Accept-Encoding':'identity'}},response=>{
      if([301,302,303,307,308].includes(response.statusCode||0)&&response.headers.location){
        const location=response.headers.location;response.destroy();clearTimeout(timer);
        try{downloadLabelPdf(new URL(location,url).href,redirects+1,deadline).then(resolve,reject)}catch(e){reject(e)}return;
      }
      if(response.statusCode!==200){response.destroy();fail(Error(`Carrier label download failed (HTTP ${response.statusCode}). Generate the label again; the link may have expired.`));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>10*1024*1024)request.destroy(Error('Carrier label exceeds the 10 MB limit.'));else chunks.push(chunk)});
      response.on('error',()=>fail(Error('Carrier label download was interrupted. Retry this shipment label.')));
      response.on('end',()=>{clearTimeout(timer);try{resolve(validateLabelPdf(Buffer.concat(chunks)))}catch(e){reject(e)}});
    });
    timer=setTimeout(()=>request.destroy(Error('Carrier label download timed out.')),Math.max(1,deadline-Date.now()));
    request.on('error',()=>fail(Error('Unable to download carrier PDF. Check API network access and regenerate the label for the same shipment.')));
  });
}
