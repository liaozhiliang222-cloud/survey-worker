import {calculateRimWeights} from './data-weighting.mjs';
import {loadDatasetTable} from './data-engine.mjs';
const obj=v=>{if(v&&typeof v==='object')return v;try{return JSON.parse(v||'{}');}catch{return {};}};
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw Object.assign(new Error(message),{code:'RECIPE_INCOMPATIBLE'});};
function missingRule(value){
 const m=obj(value),kind=m.kind||'none';
 if(kind==='none')return {kind};
 if(['discrete','strings'].includes(kind)&&Array.isArray(m.values)&&m.values.every(v=>kind==='strings'?typeof v==='string':Number.isFinite(v)))return {kind,values:m.values};
 if(['range','range+discrete'].includes(kind)&&Number.isFinite(m.lo)&&Number.isFinite(m.hi)&&m.lo<=m.hi&&(kind==='range'||Number.isFinite(m.value)))return {kind,lo:m.lo,hi:m.hi,...(kind==='range+discrete'?{value:m.value}:{})};
 fail('缺失值规则无效');
}
function outsideDomain(value, domain) {
 const v=String(value??'').trim();
 if(!v)return false;
 return domain.kind==='category' ? !domain.values.includes(v)
  : !Number.isFinite(Number(v)) || Number(v)<domain.min || Number(v)>domain.max || (domain.integer&&!Number.isInteger(Number(v)));
}
export function describeRecipeDomain(domain) {
 return domain.kind==='numeric' ? `${domain.min}–${domain.max}${domain.integer?'（整数）':'（允许小数）'}` : domain.values.join('、');
}
const families=['satisfaction_nps','ua','concept'];
const metricTypes=['distribution','mean','nps'];
export function validateRecipe(value){
 const r=clone(value);if(r.schema_version!=='surveykit.analysis_recipe.v1'||!families.includes(r.family)||typeof r.name!=='string'||!r.name.trim()||r.name.length>120)fail('配方格式、名称或类型无效');
 if(!Array.isArray(r.fields)||!r.fields.length||r.fields.length>100||!Array.isArray(r.variables)||!r.variables.length||!Array.isArray(r.banners)||r.banners.length>3)fail('配方字段或分群数量无效');
 const keys=new Set();for(const f of r.fields){if(!f.key||typeof f.key!=='string'||keys.has(f.key)||['__proto__','constructor','prototype'].includes(f.key))fail('配方字段重复或无效');keys.add(f.key);if(!['numeric','category'].includes(f.domain?.kind))fail('缺少值域');if(f.domain.kind==='numeric'&&(!Number.isFinite(f.domain.min)||!Number.isFinite(f.domain.max)||f.domain.min>f.domain.max))fail('量表上下限无效');if(f.domain.kind==='category'&&(!Array.isArray(f.domain.values)||!f.domain.values.length||f.domain.values.length>200||f.domain.values.some(v=>typeof v!=='string'||!v.trim()||v!==v.trim())||new Set(f.domain.values).size!==f.domain.values.length))fail('类别值域无效');}
 if([...r.variables,...r.banners].some(k=>!keys.has(k))||r.variables.some(k=>r.banners.includes(k)))fail('分析字段或分群映射无效');
 if(r.variables.some(k=>!metricTypes.includes(r.metrics?.[k])))fail('指标须为频数分布、均值或 NPS');
 for(const key of r.variables){const f=r.fields.find(f=>f.key===key),metric=r.metrics[key];if(metric!=='distribution'&&f.domain.kind!=='numeric')fail('均值和 NPS 需要数值字段');if(metric==='nps'&&(f.domain.min!==0||f.domain.max!==10||!f.domain.integer))fail('NPS 必须为 0–10 整数量表');}
 if(new Set([...r.variables,...r.banners]).size!==r.variables.length+r.banners.length)fail('分析字段不能重复');
 const trim=r.weighting?.trim;if(trim&&(Object.keys(trim).some(k=>!['min','max'].includes(k))||Object.values(trim).some(v=>!Number.isFinite(v)||v<=0)||(trim.min!=null&&trim.min>1)||(trim.max!=null&&trim.max<1)||(trim.min!=null&&trim.max!=null&&trim.min>=trim.max)))fail('权重截尾范围无效');
 if(!['none','rim'].includes(r.weighting?.mode))fail('权重设置无效');
 if(r.weighting.mode!=='none'&&(!Array.isArray(r.weighting.targets)||!r.weighting.targets.length))fail('缺少权重目标');
 for(const t of r.weighting.targets||[]){if(!keys.has(t.variable)||!Array.isArray(t.categories)||!t.categories.length||t.categories.some(c=>typeof c.value!=='string'||!Number.isFinite(c.share)||c.share<=0)||Math.abs(t.categories.reduce((s,c)=>s+c.share,0)-1)>1e-6)fail('权重目标字段或比例无效');}
 // Export only methodological fields, never rows, results, claims or prior source identifiers.
 const recipe={schema_version:r.schema_version,name:r.name,family:r.family,fields:r.fields.map(f=>({key:f.key,domain_source:['declared','fixed'].includes(f.domain_source)?f.domain_source:'observed',label:String(f.label||''),missing:missingRule(f.missing),value_labels:Array.isArray(f.value_labels)?f.value_labels.map(v=>({value:String(v.value),label:String(v.label||'')})):[],domain:f.domain.kind==='numeric'?{kind:'numeric',min:f.domain.min,max:f.domain.max,integer:!!f.domain.integer}:{kind:'category',values:f.domain.values}})),variables:r.variables,banners:r.banners,metrics:Object.fromEntries(r.variables.map(k=>[k,r.metrics[k]])),weighting:{mode:r.weighting.mode,...(r.weighting.mode==='none'?{}:{targets:r.weighting.targets.map(t=>({variable:t.variable,categories:t.categories.map(c=>({value:c.value,share:c.share}))})),trim:r.weighting.trim||null})},page_plan:r.variables.map(k=>({kind:'comparison',variable:k,banners:[...r.banners]}))};
 if(JSON.stringify(recipe).length>150000)fail('配方过大');return recipe;
}
export async function captureRecipe({store,fileStorage,projectId,datasetId,input}){
 const dataset=await store.getDataset(projectId,datasetId);const table=await loadDatasetTable({store,fileStorage,projectId,dataset});
 const metadata=obj(dataset.metadata);if(dataset.type==='weighted'&&!Object.hasOwn(metadata.weighting||{},'trim')){const result=(await store.listAnalysisResults(projectId)).find(r=>r.dataset_id===datasetId&&r.type==='data_weight');if(!result)fail('旧加权版本缺少参数记录，请重新加权后保存配方');metadata.weighting={...metadata.weighting,trim:obj(result.input).trim||null};}const weighting=dataset.type==='weighted'?{mode:'rim',targets:metadata.weighting?.targets||[],trim:metadata.weighting?.trim||null}:{mode:'none'};
 const variables=input.variables||[],banners=input.banners||[],keys=[...new Set([...variables,...banners,...(weighting.targets||[]).map(t=>t.variable)])];
 const fields=keys.map(key=>{if(!table.headers.includes(key)||key==='__weight')fail(`字段不可用：${key}`);const meta=(table.variables||[]).find(v=>v.name===key)||{};const values=[...new Set(table.rows.map(row=>String(row[key]??'').trim()).filter(Boolean))];if(!values.length)fail(`字段 ${key} 没有有效值，无法建立值域`);const numeric=values.every(v=>Number.isFinite(Number(v)));return {key,label:meta.label||'',missing:meta.missing||{kind:'none'},value_labels:meta.value_labels||[],domain:numeric?{kind:'numeric',min:input.metrics?.[key]==='nps'?0:values.reduce((m,v)=>Math.min(m,Number(v)),Infinity),max:input.metrics?.[key]==='nps'?10:values.reduce((m,v)=>Math.max(m,Number(v)),-Infinity),integer:values.every(v=>Number.isInteger(Number(v)))}:{kind:'category',values}};});
 const domains=input.domains||{};
 if(typeof domains!=='object'||Array.isArray(domains)||Object.keys(domains).some(key=>!keys.includes(key)))fail('量表设置包含未使用的字段');
 for(const field of fields){
  field.domain_source=input.metrics?.[field.key]==='nps'?'fixed':'observed';
  if(Object.hasOwn(domains,field.key)){field.domain=domains[field.key];field.domain_source='declared';}
 }
 const recipe=validateRecipe({schema_version:'surveykit.analysis_recipe.v1',name:input.name,family:input.family,variables,banners,fields,metrics:input.metrics,weighting});
 for(const field of recipe.fields){if(table.rows.some(row=>outsideDomain(row[field.key],field.domain)))fail(`${field.key} 的当前数据超出所设范围 ${describeRecipeDomain(field.domain)}，请核对量表或先清洗数据`);}
 return recipe;
}
export async function validateRecipeTarget({store,fileStorage,projectId,datasetId,recipe,mapping={}}){
 const r=validateRecipe(recipe),dataset=await store.getDataset(projectId,datasetId);
 const table=await loadDatasetTable({store,fileStorage,projectId,dataset});
 const errors=[],field_checks=[];
 const resolved=Object.fromEntries(r.fields.map(f=>[f.key,Object.hasOwn(mapping,f.key)?mapping[f.key]:f.key]));
 if(new Set(Object.values(resolved)).size!==r.fields.length)errors.push('不同角色不能映射到同一字段');
 for(const field of r.fields){
  const target=resolved[field.key],meta=(table.variables||[]).find(v=>v.name===target)||{};
  const check={field:field.key,target,expected:describeRecipeDomain(field.domain),domain_source:field.domain_source,valid:true,issues:[],invalid_count:0};
  const issue=message=>{check.valid=false;check.issues.push(message);errors.push(`${field.key} → ${target||'未选择'}：${message}`);};
  if(!table.headers.includes(target))issue('缺字段，请选择对应字段');
  else {
   if(Object.values(resolved).filter(value=>value===target).length>1)issue('该字段被多个角色重复使用');
   if(JSON.stringify(missingRule(meta.missing))!==JSON.stringify(field.missing)||JSON.stringify(meta.value_labels||[])!==JSON.stringify(field.value_labels))issue('值标签或缺失规则改变，请核对后另建配方');
   if(field.label!==(meta.label||''))issue('题目标签改变，请人工核对后另建配方');
   check.invalid_count=table.rows.reduce((count,row)=>count+Number(outsideDomain(row[target],field.domain)),0);
   if(check.invalid_count)issue(`有 ${check.invalid_count} 条回答超出允许范围 ${check.expected}`);
  }
  field_checks.push(check);
 }
 const targets=(r.weighting.targets||[]).map(t=>({...t,variable:resolved[t.variable]}));
 if(r.weighting.mode==='none'&&dataset.type==='weighted')errors.push('配方未加权，目标却已加权');
 if(r.weighting.mode==='rim'&&dataset.type==='weighted')errors.push('请选择原始或清洗版本，按配方重新校准权重');
 for(const t of targets){const values=new Set(table.rows.map(row=>String(row[t.variable]??'').trim()).filter(Boolean));if(t.categories.some(c=>!values.has(c.value))||[...values].some(v=>!t.categories.some(c=>c.value===v)))errors.push(`${t.variable} 的权重类别与新数据不一致`);}
 if(!errors.length&&r.weighting.mode==='rim'){try{const calculated=calculateRimWeights(table.rows,targets,{trim:r.weighting.trim});if(!calculated.diagnostics.converged)errors.push('新数据在该权重目标及截尾范围下未收敛');}catch(error){errors.push(error.message);}}
 return {valid:!errors.length,errors,field_checks,recipe:r,mapping:resolved,args:{dataset_id:datasetId,variables:r.variables.map(k=>resolved[k]),banner:r.banners.map(k=>resolved[k]),metrics:Object.fromEntries(r.variables.map(k=>[resolved[k],r.metrics[k]])),weighting:{...r.weighting,targets},page_plan:r.page_plan.map(p=>({...p,variable:resolved[p.variable],banners:p.banners.map(k=>resolved[k])}))}};
}
export async function runRecipe({store,fileStorage,projectId,datasetId,recipe,mapping,execute,scope}){
 const checked=await validateRecipeTarget({store,fileStorage,projectId,datasetId,recipe,mapping});if(!checked.valid)fail(checked.errors.join('；'));
 const args=checked.args;let target=datasetId;
 if(args.weighting.mode==='rim'){const weighted=await execute({agentToolId:'data_weight',scope,args:{dataset_id:datasetId,targets:args.weighting.targets,trim:args.weighting.trim,confirmed:true}});target=weighted.result.weighted_dataset_id;}
 const result=await execute({agentToolId:'crosstab',scope,args:{...args,dataset_id:target}});
 result.compact.recipe_name=checked.recipe.name;result.compact.page_plan=args.page_plan;return result;
}
