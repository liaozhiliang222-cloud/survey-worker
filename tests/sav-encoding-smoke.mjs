import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const a=app.indexOf('function decodeSavText('),b=app.indexOf('\nfunction savPad',a);const ctx=vm.createContext({TextDecoder,Uint8Array});vm.runInContext(app.slice(a,b),ctx);
const shared=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../src/shared/file-parser.js',import.meta.url))).toString('base64'));
for(const decode of [ctx.decodeSavText,shared.decodeSavText]){
 const bytes=new TextEncoder().encode('为了了解您的需求');
 assert.equal(decode(bytes),'为了了解您的需求');
 assert.equal(decode(bytes.slice(0,-1)),'为了了解您的需…');
 assert.equal(decode(bytes.slice(0,-1),'UTF-8'),'为了了解您的需…');
 assert.equal(decode(new Uint8Array([0xd6,0xd0,0xce,0xc4])),'中文');
 assert.equal(decode(new Uint8Array([0xd6,0xd0,0xce,0xc4]),'gb18030'),'中文');
 assert.equal(decode(new Uint8Array([65,255,66]),'utf-8'),'A�B');
}
console.log('SAV encoding: shared + classic parser, UTF-8 truncation, explicit encoding and legacy GBK passed');

// The last instruction block can contain values with no following literal bytes.
for (const path of ['../app.js', '../src/shared/file-parser.js']) {
 const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const start=source.indexOf('  let savInstructionQueue = [];');
 const end=source.indexOf('\n  const displayHeaders',start);
 const run=(bytes)=>vm.runInNewContext(source.slice(start,end)+'; Array.from({length: 6}, () => nextUnit())', {bytes:new Uint8Array(bytes),offset:0,compression:1,bias:100,Uint8Array});
 const units=run([101,102,103,104,105,252,0,0]);
 assert.deepEqual(Array.from(units.slice(0,5), u=>u.number),[1,2,3,4,5]);
 assert.equal(units[5].eof,true);
 const literal=new Uint8Array(8);new DataView(literal.buffer).setFloat64(0,42,true);
 const mixed=run([253,103,104,105,252,0,0,0,...literal]);
 assert.equal(new DataView(mixed[0].bytes.buffer).getFloat64(0,true),42);
 assert.deepEqual(Array.from(mixed.slice(1,4),u=>u.number),[3,4,5]);
 assert.equal(mixed[4].eof,true);
}
console.log('SAV compressed tail: queued values survive physical EOF in both parsers');
