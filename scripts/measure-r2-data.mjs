import fs from 'node:fs';
import { SavWriter } from 'savfilewriter';
import { performance } from 'node:perf_hooks';
import { parseDatasetFile } from '../lib/project-file-parser.mjs';
import { profileTable } from '../lib/data-engine.mjs';
import { calculateRimWeights } from '../lib/data-weighting.mjs';

const results=[];
for(const rows of [1000,50000,100000]) {
  const fields=['GROUP','NPS',...Array.from({length:18},(_,i)=>`Q${i}`)];
  const csv=Buffer.from([fields.join(','),...Array.from({length:rows},(_,i)=>fields.map((f,j)=>j===0?(i%2?'A':'B'):i%11).join(','))].join('\n'));
  let start=performance.now();const workbook=await parseDatasetFile(csv.buffer.slice(csv.byteOffset,csv.byteOffset+csv.byteLength),{extension:'csv'});const parse_ms=performance.now()-start;
  start=performance.now();profileTable(workbook.selected,'benchmark');const profile_ms=performance.now()-start;
  start=performance.now();calculateRimWeights(workbook.selected.rows,[{variable:'GROUP',categories:[{value:'A',share:0.4},{value:'B',share:0.6}]}]);const weight_ms=performance.now()-start;
  results.push({format:'csv',rows,columns:fields.length,cells:rows*fields.length,bytes:csv.length,parse_ms:Math.round(parse_ms),profile_ms:Math.round(profile_ms),weight_ms:Math.round(weight_ms)});
}
const source=fs.readFileSync(new URL('../src/shared/export.js',import.meta.url),'utf8');
const {buildExcelWorkbookXlsxBytes}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const headers=['GROUP','Q1',...Array.from({length:18},(_,i)=>`V${i}`)];
const rows=Array.from({length:50000},(_,i)=>Object.fromEntries(headers.map((f,j)=>[f,j===0?(i%2?'A':'B'):i%11])));
for(const format of ['sav','xlsx']) {
 const bytes=format==='sav'?SavWriter.write({encoding:'UTF-8',sysvars:headers.map(name=>({name,type:name==='GROUP'?8:0,label:name==='Q1'?'推荐意愿':''}))},rows):buildExcelWorkbookXlsxBytes([{name:'Data',rows:[headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>({cells:r.map(value=>({value}))}))}]);
 const start=performance.now();await parseDatasetFile(bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{extension:format});
 results.push({format,rows:rows.length,columns:headers.length,cells:rows.length*headers.length,bytes:bytes.byteLength,parse_ms:Math.round(performance.now()-start)});
}
console.log(JSON.stringify({synthetic:true,runtime:process.version,measured_at:new Date().toISOString(),results},null,2));
