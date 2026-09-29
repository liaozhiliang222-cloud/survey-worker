// Private fixture is supplied by the operator; never commit respondent records.
const fs=require('node:fs'),assert=require('node:assert/strict'),C=require('../indicator-weighting.js');
const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),headers=Object.keys(f.rows[0]);
const dims=[...new Set(f.analysis.mapping.map(m=>m['二级指标']))].map(name=>({name,y:f.analysis.mapping.find(m=>m['二级指标']===name)['Y变量'],
 scale:{min:0,max:10,low:6,high:9,metric:'net'},items:f.weight.weights.filter(w=>w['二级指标']===name).map(w=>({field:w['变量'],label:w['三级指标'],value:w['来源数值']}))}));
const scheme=C.normalizeScheme({dimensions:dims},headers),official=f.rows.filter(r=>r.Q6===1);
let coefficients=0,maxB=0,maxP=0,leaf=0,parent=0,maxScore=0,blank=0;
for(const d of scheme.dimensions){
 if(d.name==='售后服务')continue;
 const model=C.regress(official,d);
 for(const c of model.coefficients){const original=f.weight.coefficients.find(w=>w['X变量']===c.field);maxB=Math.max(maxB,Math.abs(c.B-original['原B']));maxP=Math.max(maxP,Math.abs(c.p-original['原p值']));assert.ok(Math.abs(c.se-original['原标准误'])<1e-10);assert.ok(Math.abs(c.t-original['原t'])<1e-8);coefficients++;}
}
const colName=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
for(let block=0;block<3;block++)for(let brand=0;brand<7;brand++){
 const col=colName(7+block*7+brand),rows=official.filter(r=>(!brand||r.Q5_1===brand)&&(block===0||(block===1?[1,2,3,4,5,6,7,16]:[8,9,10,11]).some(i=>r['A3__'+i]===1)));
 scheme.dimensions.forEach((d,i)=>{
  const result=C.calculate(rows,d),expected=f.analysis.checks.find(c=>c['原单元格']===col+(73+i));
  if(expected['原表值']==null){assert.equal(result.value,null);blank++;}else{maxScore=Math.max(maxScore,Math.abs(result.value-expected['原表值']));parent++;}
  result.items.forEach(item=>{const m=f.analysis.mapping.find(m=>m['X变量']===item.field),e=f.analysis.checks.find(c=>c['原单元格']===col+m['原表行']);if(e['原表值']==null){assert.equal(item.value,null);blank++;}else{maxScore=Math.max(maxScore,Math.abs(item.value-e['原表值']));leaf++;}});
 });
}
assert.ok(maxB<1e-10);assert.ok(maxP<1e-9);assert.ok(maxScore<1e-9);
console.log(JSON.stringify({coefficients,leaf,parent,blank,maxB,maxP,maxScore},null,2));
