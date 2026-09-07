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
