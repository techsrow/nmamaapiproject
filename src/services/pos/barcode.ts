// Internal EAN-13 identifiers; prefix 20 is store-internal, not a GS1 GTIN allocation.
export function checkDigit(value: string): string {
 if (!/^\d{12}$/.test(value)) throw new Error('EAN-13 requires twelve data digits.');
 return String((10 - [...value].reduce((s,c,i)=>s+Number(c)*(i%2?3:1),0)%10)%10);
}
export function barcodeForVariant(id: number): string {
 if (!Number.isSafeInteger(id) || id<=0 || id>9999999999) throw new Error('Invalid variant ID.');
 const data='20'+String(id).padStart(10,'0');return data+checkDigit(data);
}
const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const PARITY=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
export function barcodePattern(code: string): string {
 if (!/^\d{13}$/.test(code)||checkDigit(code.slice(0,12))!==code[12]) throw new Error('A valid EAN-13 barcode is required for this label.');
 let bits='101';for(let i=1;i<=6;i++)bits+=(PARITY[Number(code[0])][i-1]==='L'?L:G)[Number(code[i])];
 bits+='01010';for(let i=7;i<13;i++)bits+=L[Number(code[i])].replace(/[01]/g,c=>c==='0'?'1':'0');bits+='101';
 return bits;
}
export function barcodeSvg(code: string): string {
 const bits=barcodePattern(code);
 const bars=[...bits].map((b,i)=>b==='1'?`<rect x="${11+i}" y="4" width="1" height="45"/>`:'').join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 117 62" width="58.5mm" height="31mm"><rect width="117" height="62" fill="white"/><g fill="black">${bars}<text x="58.5" y="58" text-anchor="middle" font-family="monospace" font-size="8">${code}</text></g></svg>`;
}
