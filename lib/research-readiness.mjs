// Shared, browser-safe presentation contracts. Never infer unknown legacy metadata.
const object = value => { if(value && typeof value === 'object')return value;try{return JSON.parse(value || '{}');}catch{return {};}};
const excluded = e => [true,1,'1'].includes(e.excluded);
export function datasetExplanation(dataset, analyses = []) {
 const m=object(dataset.metadata),d=m.weighting?.diagnostics || {};
 const weighted=dataset.type==='weighted'||m.weight_status==='weighted';
 const known=m.schema_version===1;
 const results=analyses.filter(a=>a.dataset_id===dataset.id).flatMap(a=>object(a.result).results || []);
 const bases=results.map(r=>({variable:r.variable || r.name || '',metric:r.metric || r.type || '',base:r.base ?? null}));
 return {schema_version:1,dataset_id:dataset.id,sample_count:dataset.row_count ?? null,
  weighted,weight_label:weighted?'已加权':known?'未加权':'加权状态待复核',
  convergence:weighted?(d.converged===true?'converged':d.converged===false?'not_converged':'unknown'):'not_applicable',
  convergence_label:weighted?(d.converged===true?'最终权重已收敛':d.converged===false?'最终权重未收敛':'收敛状态待复核'):'无需收敛检查',
  effective_n:weighted?(d.effective_n ?? null):null,sheet_name:m.sheet_name || null,
  parent_version:dataset.parent_dataset_id || m.parent_version || null,source_sha256:m.source_version?.sha256 || null,
  missing_policy:known?'空白及声明的用户缺失值按题剔除；真实 0 保留；NPS 仅纳入 0–10。':'旧版缺失口径未记录，请复核或重新分析。',
  base_note:'有效 base 按题目和分组计算，不等于总行数；加权有效样本量也不等于有效 base。',
  bases,needs_review:!known || (weighted && d.converged!==true)};
}
export function artifactPreflight(artifact, evidence = []) {
 const content=object(artifact?.content),issues=[];
 if(!artifact)return {status:'blocked',can_generate:false,issues:[{code:'missing_script',message:'请先生成页面脚本。'}]};
 if(artifact.freshness?.status==='stale')issues.push({code:'needs_update',message:'来源已变化，请基于当前版本派生更新；旧版仅用于历史复查。'});
 else if(artifact.freshness?.status==='needs_review')issues.push({code:'source_review',message:'旧版来源快照不完整，请先复核。'});
 const usable=new Set(evidence.filter(e=>!excluded(e)).map(e=>e.id));
 for(const page of content.pages || []) {
  if(page.data_points?.length || page.page_type==='data_insight')issues.push({code:'unsupported_chart',page_id:page.id,message:'当前定性 PPT 不支持定量图表，请使用 Excel 导出。'});
  if(!['cover','section_intro','navigation'].includes(page.page_type) && !(page.evidence_ids || []).some(id=>usable.has(id)))issues.push({code:'insufficient_evidence',page_id:page.id,message:'页面缺少可用证据，请补充或重新分析。'});
 }
 const blocked=issues.some(i=>['unsupported_chart','insufficient_evidence'].includes(i.code));
 return {status:blocked?'blocked':issues.length?'needs_review':'ready',can_generate:!blocked,issues};
}
export function projectReadiness({files=[],datasets=[],evidence=[],artifacts=[],jobs=[],workflows=[]}={}) {
 const active=jobs.filter(j=>['pending','running'].includes(j.status));
 const failed=jobs.filter(j=>j.status==='failed');
 const stale=artifacts.filter(a=>a.freshness?.status==='stale');
 const usable=evidence.filter(e=>!excluded(e));
 let stage='materials',label='准备材料',next='上传研究材料或原始数据。',target='files';
 if(files.length||datasets.length){stage='analysis';label='分析材料';next='选择数据版本或访谈材料，生成可追溯证据。';target='data';}
 if(usable.length){stage='outline';label='组织报告';next='基于可用证据生成报告大纲。';target='artifacts';}
 if(artifacts.some(a=>a.type==='report_outline'&&a.freshness?.status!=='stale')){stage='script';label='编写页面';next='选择报告大纲，生成页面脚本。';target='artifacts';}
 if(artifacts.some(a=>a.type==='ppt_script')){stage='delivery';label='检查交付';next='预览页面并处理生成前检查，再导出报告。';target='artifacts';}
 if(stale.length){label='成果待更新';next='来源发生变化，先复核或派生更新受影响成果。';target='artifacts';}
 if(active.length){label='任务处理中';next='可离开页面，任务记录会保留；在数据任务区查看进度。';target='data';}
 if(!active.length&&failed.length){label='数据任务失败';next='查看错误原因，再使用任务列表中的重试操作。';target='data';}
 const latestWorkflow=new Map();for(const w of workflows)if(!latestWorkflow.has(w.task_type))latestWorkflow.set(w.task_type,w);
 const generationFailures=[...latestWorkflow.values()].filter(w=>w.status==='failed');
 if(!active.length&&!failed.length&&generationFailures.length){label='成果生成失败';next='查看研究任务中的错误原因，调整材料或要求后重新生成。';target='chat';}
 const degraded=artifacts.filter(a=>{const c=object(a.content);return c.renderer?.fallback || c.renderer?.mode==='compatibility_fallback' || c.metadata?.renderer?.mode==='compatibility_fallback';}).length;
 return {schema_version:1,stage,label,next,target,counts:{usable_evidence:usable.length,stale_artifacts:stale.length,active_jobs:active.length,failed_jobs:failed.length,failed_generations:generationFailures.length,degraded_reports:degraded}};
}
export async function readProjectReadiness(store, projectId) {
 const [files,datasets,evidence,artifacts,jobs,analyses,workflows]=await Promise.all([store.listFiles(projectId),store.listDatasets(projectId),store.listEvidence(projectId),store.listArtifacts(projectId),store.listDataJobs(projectId),store.listAnalysisResults(projectId),store.listWorkflows(projectId)]);
 return {...projectReadiness({files,datasets,evidence,artifacts,jobs,workflows}),datasets:datasets.map(d=>datasetExplanation(d,analyses)),reports:artifacts.filter(a=>a.type==='ppt_script').map(a=>({artifact_id:a.id,...artifactPreflight(a,evidence)}))};
}
