import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const names=['questionPrefix','getHeaderInfo','groupQuestionHeaders','isBinaryMentionValue','isBinaryOptionColumn','normalizeConditionValue','rawValueMatches','pivotKey','crosstabQuestionKeyCandidates','decodeSavText','parseSavMultipleResponseSets','isMultiResponseMention','isOpenEndedHeader','inferSingleColumnType'];
const context=vm.createContext({TextDecoder,Uint8Array,lastCrosstabDataContext:null,questionDisplayTitle:(_key,title)=>title});
for(const name of names){const start=source.indexOf(`function ${name}(`);const end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);}
const headers=['Q7__1 咨询店员','Q7__2 购买产品','Q7_1A 影响程度','Q7_1B__1 原因甲','Q7_1B__2 原因乙','Q7_1C__1 因素甲','Q7_1C__2 因素乙'];
const rows=[Object.fromEntries(headers.map(h=>[h,'是'])),Object.fromEntries(headers.map(h=>[h,'否']))];
const groups=context.groupQuestionHeaders(headers,rows);
assert.equal(groups.length,4);
assert.deepEqual(Array.from(groups,g=>g.key),['Q7','Q7_1A 影响程度','Q7_1B','Q7_1C']);
const used=Array.from(groups).flatMap(g=>Array.from(g.headers));assert.equal(new Set(used).size,headers.length);assert.equal(used.length,headers.length);
assert.equal(context.questionPrefix('Q27_2__1__open'),'Q27_2');
assert.equal(context.questionPrefix('Q7_1D 平台'),'Q7_1D');
assert.ok(context.crosstabQuestionKeyCandidates('Q7_1B__2').includes('Q7_1B'));
for(const code of ['1','2','3','4','5','6'])assert.equal(context.rawValueMatches(code,'1/R2/R3/R4/R5/R6'),true);
for(const code of ['','7','11'])assert.equal(context.rawValueMatches(code,'1/R2/R3/R4/R5/R6'),false);
assert.notEqual(context.pivotKey({sourceKey:'Q7',title:'相同题干',type:'多选题'}),context.pivotKey({sourceKey:'Q7_1B',title:'相同题干',type:'多选题'}));
console.log('Crosstab grouping passed: letter suffixes, no reused fields, stable keys, OR banner codes');

const encode = value => new TextEncoder().encode(value);
const label = '离店沟通原因';
const definition = `$Q49_2_4=D1 2 ${encode(label).length} ${label} v469_a v470_a\n`;
const sets = context.parseSavMultipleResponseSets(encode(definition));
assert.equal(sets[0].label,label);assert.equal(sets[0].countedValue,'2');
assert.throws(()=>context.parseSavMultipleResponseSets(encode('$x=D1 1 99 short a b')));
const c = context.parseSavMultipleResponseSets(encode('$category=C 0  a b\n'));
assert.equal(c[0].type,'C');
const e = context.parseSavMultipleResponseSets(encode('$e=E 1 1 2 0  a b\n'));
assert.equal(e[0].countedValue,'2');
context.lastCrosstabDataContext={multipleResponseSets:sets,headerInfos:[{sourceHeader:'V469_A',title:'V469_A 不礼貌',options:{1:'否',2:'是'}},{sourceHeader:'V470_A',title:'V470_A 不会主动联系',options:{1:'否',2:'是'}}]};
const explicit=context.groupQuestionHeaders(['V469_A 不礼貌','V470_A 不会主动联系'],[]);
assert.equal(explicit.length,1);assert.equal(explicit[0].key,'Q49_2_4');assert.equal(explicit[0].declaredMulti,true);
assert.equal(context.isMultiResponseMention({'V469_A 不礼貌':'是'},'V469_A 不礼貌',explicit[0]),true);
assert.equal(context.isMultiResponseMention({'V469_A 不礼貌':'否'},'V469_A 不礼貌',explicit[0]),false);
console.log('SAV MRSETS passed: Chinese byte lengths, D/E metadata, generic variable names, counted values, empty samples');

context.lastCrosstabDataContext.headerInfos.push({sourceHeader:'V476_A',title:'V476_A',longName:'Q49_2_4__8__open'});
assert.equal(context.inferSingleColumnType('V476_A',['其他回答/含斜杠']), 'open');

for (const name of ['forwardFillRow','isHeaderConditionCell','cleanCrosstabGroupCell','cleanCrosstabConditionCell','rowNonEmptyCount','rowConditionCount','isMostlyNumericHeaderRow','findCrosstabHeaderRows','parseCrosstabHeaderRows','normalizeConditionVariable','parseHeaderCondition']) {
 const start=source.indexOf(`function ${name}(`);const rest=source.slice(start);const boundary=rest.slice(1).search(/\n(?:async )?function /);vm.runInContext(boundary<0?rest:rest.slice(0,boundary+1),context);
}
const twoRows=context.parseCrosstabHeaderRows([['总体','四类','',''],['','QCL_3=1','QCL_3=2','QCL_3=3']]);
assert.equal(twoRows[1].condition,'QCL_3=1');assert.equal(twoRows[2].label,'QCL_3=2');assert.equal(twoRows[3].parts[0].variable,'QCL_3');assert.equal(twoRows[0].condition,'');
const threeRows=context.parseCrosstabHeaderRows([['总体','品牌',''],['总体','品牌甲','品牌乙'],['','Q5_1=R1','Q5_1=R2']]);assert.equal(threeRows[1].label,'品牌甲');assert.equal(threeRows[2].condition,'Q5_1=R2');
assert.throws(()=>context.cleanCrosstabConditionCell('Q1>=1'));
console.log('Banner import passed: two-row cluster headers, named columns, legacy three-row headers, invalid conditions');

// Closed attitude statements must not exclude an entire matrix question.
assert.equal(context.isOpenEndedHeader('A7__5 5.我对各类智能家居产品持开放态度，愿意尝试'), false);
for (const label of ['A8 开放题', 'A8 开放式问题', 'A8 开放性问题', 'A8 其他请注明']) {
  assert.equal(context.isOpenEndedHeader(label), true, label);
}
console.log('Open-ended detection passed: open attitude is retained, explicit free-text questions excluded');

for (const name of ['conditionPartMatches']) {
 const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);
}
for (const variable of ['Q7_1B','QCL_3','V469_A','Q1.2','@GROUP','$SEG','#TYPE','人群分类']) {
 assert.equal(context.parseHeaderCondition(`[${variable}]=R1`)[0].variable,variable.toUpperCase());
 assert.equal(context.conditionPartMatches({[variable]:'1'},[variable],context.parseHeaderCondition(`[${variable}]=R1`)[0]),true);
}
assert.equal(context.parseHeaderCondition('ｑｃｌ＿３＝１')[0].variable,'QCL_3');
assert.equal(context.parseHeaderCondition('BRAND=1')[0].variable,'BRAND');
assert.equal(context.parseHeaderCondition('BRAND=1 And Q2!=2').length,2);
assert.equal(context.parseHeaderCondition('Q2<>2')[0].operator,'ne');
assert.equal(context.rawValueMatches('1.0','R1'),true);
assert.equal(context.rawValueMatches('Retail','etail'),false);
assert.equal(context.conditionPartMatches({'Q1_2':'1'},['Q1_2'],context.parseHeaderCondition('q1-2=1')[0]),true);
assert.equal(context.conditionPartMatches({'Q1-2':'1','Q1_2':'2'},['Q1-2','Q1_2'],context.parseHeaderCondition('Q1-2=1')[0]),true);
assert.throws(()=>context.conditionPartMatches({},['Q2'],context.parseHeaderCondition('Q1=1')[0]));
for (const bad of ['Q1=','Q1>=2','Q1=1 且 无效','Q1=1 &','Q1==1']) assert.throws(()=>context.parseHeaderCondition(bad));
console.log('Banner compatibility: Unicode, punctuation, fullwidth, brackets, inequality, AND boundaries and strict errors passed');

// Every Latin prefix follows the same import and filtering contract.
{
 const name='filterRowsByConditionParts',start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
 vm.runInContext(source.slice(start,end),context);
 for (const prefix of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const variable=prefix+'12_1B';
  const data={rawHeaders:[variable],rawRows:[{[variable]:'1'},{[variable]:'2'}],rows:[{id:1},{id:2}]};
  const plan=context.parseCrosstabHeaderRows([['总体','测试分组'],['总体','人群1'],['',`${variable.toLowerCase()}=R2`]]);
  assert.equal(plan[1].parts[0].variable,variable);
  const matched=context.filterRowsByConditionParts(data,plan[1].parts);
  assert.equal(matched.length,1);assert.equal(matched[0].id,2);
 }
}
console.log('A-Z banner prefixes: three-row import and actual row filtering passed for all 26 letters');

for (const name of ['crosstabOptionSortKey','orderCrosstabOptions','isRepeatedCrosstabSection','normalizedQuestionType','buildWorkbookLineDescriptors']) {
 const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);
}
const bands=['1001-1500元','1501-2000元','3000元以上','500-1000元','500元以下','暂无确定预算'];
assert.deepEqual(Array.from(context.orderCrosstabOptions(bands.map(label=>({label}))),r=>r.label),['500元以下','500-1000元','1001-1500元','1501-2000元','3000元以上','暂无确定预算']);
assert.deepEqual(Array.from(context.orderCrosstabOptions(['其他，请说明','[S9-97]','品牌A','品牌B'].map(label=>({label}))),r=>r.label),['品牌A','品牌B','其他，请说明','[S9-97]']);
assert.equal(context.isRepeatedCrosstabSection('S13 S13.请问您最近购买的产品？【单选】','S13. 请问您最近购买的产品？'),true);
const matrix={title:'A7.态度',rows:[{label:'A7.态度',frequencies:[{label:'1'}]},{label:'子项2',frequencies:[{label:'2'}]}]};
assert.equal(context.buildWorkbookLineDescriptors(matrix).filter(d=>d.kind==='section').length,2);
assert.equal(context.buildWorkbookLineDescriptors({title:'S13.产品？',rows:[{label:'S13 S13.产品？【单选】',frequencies:[{label:'AIR'}]}]}).filter(d=>d.kind==='section').length,0);
console.log('Crosstab presentation: bands, tail choices, repeated stems, matrix subquestions passed');

// 合并多选拆列以样本为单位 OR 去重，所有请求编码必须存在。
{
 const rawHeaders=['B7_3__1','B7_3__2','B7_3__3','B7__3__1','Q1'];
 const rawRows=[
  {'B7_3__1':1,'B7_3__2':0,'Q1':1},
  {'B7_3__1':1,'B7_3__2':1,'Q1':2},
  {'B7_3__1':0,'B7_3__2':1,'Q1':1},
  {'B7_3__1':0,'B7_3__2':0,'Q1':1},
  {'B7_3__1':null,'B7_3__2':null,'Q1':1}
 ];
 const data={rawHeaders,rawRows,rows:rawRows};
 const select=condition=>context.filterRowsByConditionParts(data,context.parseHeaderCondition(condition));
 assert.equal(select('B7_3=R1/R2').length,3);
 assert.equal(select('B7_3=R1/R1/R2').length,3);
 assert.equal(select('B7_3=R1/R2 且 Q1=1').length,2);
 assert.equal(select('B7_3!=R1/R2').length,2);
 assert.equal(select('B7_3=R1').length,2);
 assert.throws(()=>select('B7_3=R1/R99'),/99/);
 assert.equal(context.conditionPartMatches({S7_1:0,S7_2:1},['S7_1','S7_2'],context.parseHeaderCondition('S7=R1/R2')[0]),true);
 assert.equal(context.conditionPartMatches({B7_3:2,'B7_3__1':0},['B7_3','B7_3__1'],context.parseHeaderCondition('B7_3=R1/R2')[0]),true);
}
console.log('Merged multi-select banner passed: OR, deduplication, AND, inequality, exact prefix and missing-code rejection');
