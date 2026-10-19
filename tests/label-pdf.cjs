const assert=require('node:assert/strict'),https=require('node:https'),dns=require('node:dns'),{EventEmitter}=require('node:events');
const {downloadLabelPdf,publicLabelAddress,validateLabelPdf}=require('../dist/services/shipping/labelPdf.service');
const pdf=Buffer.from('%PDF-1.4\nmock label content\n%%EOF\n');let calls=0,scenario='pdf',lookup;
dns.promises.resolve4=async()=>{throw Error('queryA ECONNREFUSED storage.googleapis.com')};
dns.promises.lookup=async host=>[{address:host==='private.example'?'127.0.0.1':'8.8.8.8',family:4}];
https.get=(url,options,callback)=>{
 calls++;lookup=options.lookup;const req=new EventEmitter();req.destroy=e=>req.emit('error',e);
 queueMicrotask(()=>{const res=new EventEmitter();res.destroy=()=>{};res.headers={};res.statusCode=200;
 if(scenario==='redirect'){res.statusCode=302;res.headers.location='https://private.example/secret'}
 if(scenario==='expired')res.statusCode=403;
 callback(res);if(res.statusCode===200){res.emit('data',scenario==='html'?Buffer.from('<html>expired</html>'):scenario==='large'?Buffer.alloc(10*1024*1024+1):pdf);res.emit('end')}});
 return req;
};
(async()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','100.64.1.1','192.168.0.1','172.16.1.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicLabelAddress(ip),false,ip);
 assert.equal(publicLabelAddress('8.8.8.8'),true);
 assert.deepEqual(await downloadLabelPdf('https://carrier.example/label.pdf'),pdf);
 lookup('carrier.example',{all:true},(e,a)=>assert.equal(a[0].address,'8.8.8.8'));
 for(const url of ['http://carrier.example/a','https://user:pass@carrier.example/a','https://carrier.example:3011/a','https://private.example/a'])await assert.rejects(downloadLabelPdf(url));
 scenario='redirect';const before=calls;await assert.rejects(downloadLabelPdf('https://carrier.example/a'),/public IPv4/);assert.equal(calls,before+1);
 scenario='expired';await assert.rejects(downloadLabelPdf('https://carrier.example/a'),/HTTP 403/);
 scenario='html';await assert.rejects(downloadLabelPdf('https://carrier.example/a'),/complete PDF/);
 scenario='large';await assert.rejects(downloadLabelPdf('https://carrier.example/a'));
 assert.throws(()=>validateLabelPdf(Buffer.from('%PDF-incomplete')),/complete PDF/);
 await assert.rejects(downloadLabelPdf('https://carrier.example/a',0,Date.now()-1),/timed out/);
 console.log('Carrier PDF: public DNS pinning, unsafe URLs/IPs, redirect, expiry, HTML, truncation, size and deadline checks passed (network mocked).');
})().catch(e=>{console.error(e);process.exitCode=1});
