import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const a=app.indexOf('function nextUiTick('),b=app.indexOf('\nfunction ',a+1),source=app.slice(a,b);
for(const native of [true,false]){
 let calls=0;
 const context=vm.createContext({MessageChannel,window:{setTimeout(){throw Error('Background timer must not gate computation');}},...(native?{scheduler:{yield(){calls++;return new Promise(resolve=>setImmediate(resolve));}}}:{})});
 vm.runInContext(source,context);
 await Promise.race([(async()=>{for(let i=0;i<100;i++)await context.nextUiTick();})(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Yield stalled')),2000);timer.unref();})]);
 if(native)assert.equal(calls,100);
}
assert.doesNotMatch(app,/setTimeout\(generateQuestionPivot/);
console.log('Background scheduling passed: native and MessageChannel fallback continue with timers unavailable');
