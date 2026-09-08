/* Progressive configuration for supplemental crosstab models. */
(function(root) {
  "use strict";
  let rendered=false;
  let key=null, config={kano:[],psm:[],warnings:[]}, fields=[];
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function read() {
    if(!rendered)return;
    for(const kind of ["kano","psm"]) {
      config[kind]=Array.from(document.querySelectorAll(`[data-model-kind="${kind}"]`)).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('[data-model-field]')).map(input=>[input.dataset.modelField,input.value])));
    }
  }
  function selector(label,field,value,choices) {
    const list=choices||[["","请选择字段"],...fields.map(h=>[h,h])];
    return `<label>${esc(label)}<select data-model-field="${field}">${list.map(([v,t])=>`<option value="${esc(v)}" ${v===value?"selected":""}>${esc(t)}</option>`).join("")}</select></label>`;
  }
  function render() {
    if(!el('crosstabModelEditor'))return;
    el('crosstabModelSummary').textContent=`KANO ${config.kano.length} 组 · PSM ${config.psm.length} 组；生成全部题目表时一并计算`;
    el('crosstabModelWarnings').textContent=config.warnings.join(" ");
    if(!el('crosstabModelPanel').open){el('crosstabModelEditor').innerHTML='';rendered=false;return;}
    rendered=true;
    el('crosstabModelEditor').innerHTML=["kano","psm"].map(kind=>config[kind].map((s,i)=>`<div class="crosstab-model-spec" data-model-kind="${kind}">
      <label>${kind==='kano'?'KANO 功能名称':'PSM 题组名称'}<input data-model-field="name" value="${esc(s.name)}"></label>
      ${kind==='kano'?selector('正向题（具备功能）','functional',s.functional)+selector('反向题（不具备功能）','dysfunctional',s.dysfunctional)+selector('回答编码','scale',s.scale,[["labels","按回答文字识别"],["standard","纯数字：1 喜欢 → 5 不喜欢"],["reverse","纯数字：5 喜欢 → 1 不喜欢"]]):root.CrosstabModels.priceKeys.map((k,j)=>selector(root.CrosstabModels.priceLabels[j],k,s[k])).join("")+selector('有效样本口径','validation',s.validation,[["ordered","四问完整，且价格由低到高（允许相等）"],["complete","四问完整，保留价格顺序异常样本"]])}
      <button class="secondary-btn mini" type="button" data-remove-model="${kind}:${i}">移除此题组</button>
    </div>`).join("")).join("")||'<p class="panel-note">尚未配对专项题。可重新识别，或手动添加题组；普通交叉表照常计算。</p>';
  }
  function detect(data) {
    fields=data.headers;
    const metadata=typeof lastCrosstabDataContext!=="undefined"?lastCrosstabDataContext?.headerInfos||[]:[];
    const infos=fields.map(h=>{const info=metadata.find(i=>i.title===h||i.sourceHeader===h)||{};const mapped=typeof resolveQuestionTitleFromMap==="function"?resolveQuestionTitleFromMap(info.sourceHeader||h):"";return {...info,title:h,variableLabel:[info.variableLabel||h,mapped].filter(Boolean).join(" ")};});
    config=root.CrosstabModels.detectModels(fields,data.rows,infos);
    key=JSON.stringify(fields);render();
  }
  function sync(data) {
    if(key!==JSON.stringify(data.headers))detect(data);
  }
  function getConfig(data) {
    sync(data);read();root.CrosstabModels.validateModels(config,data.headers);
    return JSON.parse(JSON.stringify(config));
  }
  el('crosstabModelPanel')?.addEventListener('toggle',()=>{if(!el('crosstabModelPanel').open)read();render();});
  el('crosstabModelPanel')?.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    const data=getWorkingCrosstabData();sync(data);read();
    if(button.id==='crosstabDetectModels'){detect(data);return;}
    if(button.dataset.addModel){const kind=button.dataset.addModel;config[kind].push(kind==='kano'?{name:`功能 ${config.kano.length+1}`,functional:'',dysfunctional:'',scale:'labels'}:{name:`PSM ${config.psm.length+1}`,validation:'ordered'});}
    if(button.dataset.removeModel){const [kind,index]=button.dataset.removeModel.split(':');config[kind].splice(Number(index),1);}
    render();
  });
  root.CrosstabModelUI={sync,getConfig,reset(){key=null;}};
})(window);
