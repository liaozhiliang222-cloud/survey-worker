import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from '@playwright/test';

const source=fs.readFileSync('sw.js','utf8');const current=source.match(/research-toolbox-v\d+/)[0],old='research-toolbox-v'+(Number(current.split('-v')[1])-1);let upgraded=false,apiCount=0;
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/sw.js'){res.setHeader('Content-Type','application/javascript');res.end(upgraded?source:source.replace(current,old));}
 else if(req.url.startsWith('/api/research')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sequence:++apiCount}));}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>R3 worker acceptance</title>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CI ? {} : {channel:'chrome'});
try {
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{await caches.open('unrelated-app');await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.ok((await page.evaluate(()=>caches.keys())).includes(old));
 upgraded=true;
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await page.waitForFunction(async({current,old})=>{const keys=await caches.keys();return keys.includes(current)&&!keys.includes(old);},{current,old});
 assert.ok((await page.evaluate(()=>caches.keys())).includes('unrelated-app'));
 const values=await page.evaluate(async()=>[await (await fetch('/api/research/status')).json(),await (await fetch('/api/research/status')).json()]);
 assert.notEqual(values[0].sequence,values[1].sequence);
 assert.equal(await page.evaluate(async()=>!!(await caches.match('/api/research/status'))),false);
 console.log('R3 real Chrome: previous → current, unrelated cache retained, API bypass passed.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
