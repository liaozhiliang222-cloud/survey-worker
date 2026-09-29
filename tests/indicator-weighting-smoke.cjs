const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../indicator-weighting.js');
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const scale={min:0,max:10,low:6,high:9,metric:'net'};
const dim=(items=[{field:'a',value:1},{field:'b',value:1}])=>C.normalizeDimension({name:'服务',items,scale},['a','b']);
test('net uses each item base, distinguishes zero, missing and neutral',()=>{
 const rows=[{a:10,b:9},{a:0,b:null},{a:8,b:10},{a:null,b:8}];
 const r=C.calculate(rows,dim());
 close(r.items[0].value,0);close(r.items[1].value,200/3);close(r.value,100/3);
 assert.equal(r.nAny,4);assert.equal(r.nAll,2);assert.equal(r.nMin,3);
});
test('all missing stays null; missing whole item renormalizes with coverage',()=>{
 const r=C.calculate([{a:10},{a:8}],dim());close(r.value,50);close(r.coverage,.5);assert.equal(r.nAll,0);
 const empty=C.calculate([],dim());assert.equal(empty.value,null);assert.equal(empty.nAny,0);assert.equal(empty.coverage,0);
});
test('sample weights and indicator weights are applied independently',()=>{
 const r=C.calculate([{a:10,b:6,w:2},{a:6,b:10,w:1}],dim([{field:'a',value:3},{field:'b',value:1}]),'w');
 close(r.value,100/6);assert.equal(r.items[0].n,2);assert.equal(r.items[0].base,3);
 assert.throws(()=>C.calculate([{a:10,w:-1}],dim(),'w'),/样本权重/);
});
test('zero sample weight does not enter effective N; explicit missing and reversal',()=>{
 const d=dim([{field:'a',value:1,reverse:true,missing:[5]}]);
 const r=C.calculate([{a:0,w:1},{a:5,w:1},{a:10,w:0}],d,'w');assert.equal(r.value,100);assert.equal(r.nAny,1);
});
test('negative, duplicate, zero-sum and missing field fail closed',()=>{
 for(const items of [[{field:'a',value:-1}],[{field:'a',value:0}],[{field:'a',value:null}],[{field:'a',value:1},{field:'a',value:2}],[{field:'missing',value:1}]])assert.throws(()=>dim(items));
 assert.throws(()=>C.validateScale({...scale,low:9,high:6}));
 assert.throws(()=>C.normalizeScheme({dimensions:[]},[]));
});
test('CSV multiline, quoted comma and percent coefficients',()=>{
 assert.deepEqual(C.parseCsv('维度,变量,系数\r\n"服务,体验",a,25%\r\n"多\n行",b,75%'),[['维度','变量','系数'],['服务,体验','a','25%'],['多\n行','b','75%']]);
 assert.equal(C.coefficient('25%').value,.25);assert.equal(C.number(''),null);assert.equal(C.number('1bad'),null);
 const imported=C.importRows([[],['服务','a','.2'],['服务','b','.8']],{start:2,end:3,dimensionCol:0,variableCol:1,valueCol:2,labelCol:-1},[{id:'a'},{id:'b'}]);
 assert.equal(imported[0].sourceRow,2);assert.equal(imported[0].confirmed,true);
});
test('name and suffix matches are suggestions, ambiguous labels are not resolved',()=>{
 assert.deepEqual(C.suggestField('an','',[{id:'a',label:'态度'}]),{field:'a',confirmed:false});
 assert.equal(C.suggestField('','态度',[{id:'a',label:'态度'},{id:'b',label:'态度'}]).field,'');
});
function modelRows(){return [-2,-1,0,1,2].flatMap(a=>[-1,0,1].flatMap(b=>[-1,1].map(e=>({a,b,y:4+2*a+3*b+.2*e}))));}
const model={name:'试验',y:'y',items:[{field:'a'},{field:'b'}],scale:{min:-20,max:20,metric:'mean'}};
test('OLS B, intercept, beta, standard error and t probability match orthogonal analytic model',()=>{
 const r=C.regress(modelRows(),model);assert.equal(r.n,30);assert.equal(r.df,27);
 close(r.intercept,4);close(r.coefficients[0].B,2);close(r.coefficients[1].B,3);
 close(r.coefficients[0].se,Math.sqrt((1.2/27)/60));close(r.coefficients[1].se,Math.sqrt((1.2/27)/20));
 close(r.dimension.items[0].weight,.4);close(r.dimension.items[1].weight,.6);close(C.tProbability(1,1),.5,1e-12);
 close(C.tProbability(0,10),1);assert.ok(r.coefficients[0].p<1e-15);
});
test('rank deficient, constant, insufficient and negative models do not invent weights',()=>{
 const rows=modelRows();assert.throws(()=>C.regress(rows.map(r=>({...r,b:r.a*2})),model),/秩不足/);
 assert.throws(()=>C.regress(rows.map(r=>({...r,y:1})),model),/零方差/);
 assert.throws(()=>C.regress(rows.slice(0,3),model),/自由度/);
 const r=C.regress(rows.map(r=>({...r,y:4+2*r.a-3*r.b})),model);assert.equal(r.usable,false);assert.equal(r.dimension.items[0].weight,null);
});
test('model drops only its own missing cases; imported weights do not require Y',()=>{
 const rows=modelRows().map(r=>({...r,unrelated:null}));rows[0].y=null;
 assert.equal(C.regress(rows,model).n,29);
 assert.equal(C.calculate([{a:10}],dim([{field:'a',value:1}])).value,100);
});
test('WLS agrees with OLS for constant weights',()=>{
 const a=C.regress(modelRows(),model),b=C.regress(modelRows().map(r=>({...r,w:2})),model,'w');
 a.coefficients.forEach((c,i)=>{close(c.B,b.coefficients[i].B);close(c.se,b.coefficients[i].se);});
});

test("truncated labels only suggest a unique long prefix",()=>{
 const fields=[{id:"x",label:"宣传形式吸睛(如直播/视频/…"}];
 assert.deepEqual(C.suggestField("宣传形式吸睛(如直播/视频/图文","",fields),{field:"x",confirmed:false});
 assert.equal(C.suggestField("宣传形式吸睛(如直播/视频/图文","",[...fields,{id:"z",label:fields[0].label}]).field, "");
});
