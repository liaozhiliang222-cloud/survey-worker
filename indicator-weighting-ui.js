(function (root) {
  'use strict';
  const C = root.IndicatorWeighting, el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = v => JSON.parse(JSON.stringify(v));
  const KEY = 'indicatorWeighting.v1';
  let state = { schemes: [], active: '', enabled: false, selected: [] }, scope = '', sheets = [], fileName = '', draft = [], source = {}, models = [], fitted = [], busy = false;
  let lastResult = null, revision = 0, importSequence = 0;
  const num = v => v === null || v === undefined ? '—' : Number(v).toFixed(4);
  function projectKey() { return workspaceProject?.id || projectDataBus._currentProjectId || 'unassigned'; }
  function data() {
    const d = getWorkingCrosstabData();
    const raw = { headers: d.rawHeaders || d.headers, rows: d.rawRows || d.rows };
    const infos = lastCrosstabDataContext?.headerInfos || [];
    raw.fields = raw.headers.map((h, i) => ({ id: h, label: infos.find(x => x.sourceHeader === h)?.optionLabel || infos.find(x => x.sourceHeader === h)?.parentTitle || d.headers[i] || h }));
    return raw;
  }
  function persist() {
    localStorage.setItem(`${KEY}:${projectKey()}`, JSON.stringify(state));
    projectDataBus.set(KEY, clone(state), { schemes: state.schemes.length });
  }
  function restore(force = false) {
    const next = projectKey();
    if (!force && next === scope) return;
    scope = next;
    revision++; importSequence++;
    try { state = JSON.parse(localStorage.getItem(`${KEY}:${scope}`)) || { schemes: [], active: '', enabled: false, selected: [] }; }
    catch (_) { state = { schemes: [], active: '', enabled: false, selected: [] }; }
    draft = []; sheets = []; models = []; fitted = []; fileName = ''; lastResult = null;
    if(el('indicatorDriverPanel'))el('indicatorDriverPanel').innerHTML='';
    render(); renderModels();
  }
  function notice(message, error = false) {
    const node = el('iwMessage'); if (node) { node.textContent = message; node.className = error ? 'iw-message iw-error' : 'iw-message'; }
  }
  function invalidate(message = '设置已变更，请重新计算预览或导出。') {
    revision++;
    lastResult = null;
    const preview = el('iwResults'); if (preview) preview.innerHTML = `<p class="panel-note">${esc(message)}</p>`;
  }
  function selectOptions(fields, selected = '', blank = '不使用') {
    return `<option value="">${blank}</option>` + (selected && !fields.some(f=>f.id===selected) ? `<option selected value="${esc(selected)}">${esc(selected)}（当前数据缺失）</option>` : '') + fields.map(f => `<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${esc(f.id)} · ${esc(f.label)}</option>`).join('');
  }
  function scaleControls(prefix, scale = {}) {
    const s = { metric: 'net', min: 0, max: 10, low: 6, high: 9, missing: [], ...scale };
    return `<div class="iw-grid"><label>表现方式<select id="${prefix}Metric"><option value="net" ${s.metric === 'net' ? 'selected' : ''}>净满意度</option><option value="mean" ${s.metric === 'mean' ? 'selected' : ''}>原始均值</option></select></label>
      ${[['Min','量表最小值',s.min],['Max','量表最大值',s.max],['Low','不满意上限（含）',s.low],['High','满意下限（含）',s.high]].map(([k,l,v])=>`<label>${l}<input id="${prefix}${k}" type="number" step="any" value="${esc(v)}"></label>`).join('')}
      <label>额外缺失码（逗号分隔）<input id="${prefix}Missing" value="${esc(s.missing.join(','))}" placeholder="例如98,99"></label></div>`;
  }
  function readScale(prefix) {
    return C.validateScale({ metric: el(`${prefix}Metric`).value, min: el(`${prefix}Min`).value, max: el(`${prefix}Max`).value,
      low: el(`${prefix}Low`).value, high: el(`${prefix}High`).value, missing: el(`${prefix}Missing`).value });
  }
  function render() {
    const host = el('indicatorWeightPanel'); if (!host) return;
    const d = data(), active = state.schemes.find(s => s.id === state.active);
    host.innerHTML = `<div class="section-heading compact"><h3>指标加权（可选）</h3><label class="iw-toggle"><input type="checkbox" id="iwEnabled" aria-controls="iwConfiguration" aria-expanded="${state.enabled}" ${state.enabled ? 'checked' : ''}> 启用指标加权</label></div>
      <div id="iwConfiguration" ${state.enabled ? '' : 'hidden'}>
      <p class="panel-note">导入各维度的权重系数，或选用关键驱动分析保存的方案。按题项表现加权形成二级指标；与受访者样本加权分开设置。</p>
      <div class="button-row"><label class="secondary-btn" for="iwFile">导入权重文件</label><input id="iwFile" type="file" accept=".xlsx,.csv" class="iw-file"><button class="secondary-btn" id="iwTemplate" type="button">下载权重模板</button><button class="secondary-btn" id="iwCleaned" type="button">使用项目清洗后数据</button><button class="secondary-btn" type="button" data-jump="driver-analysis">前往关键驱动分析</button></div>
      <div class="iw-grid"><label>当前权重方案<select id="iwScheme"><option value="">请选择已保存方案</option>${state.schemes.map(s=>`<option value="${esc(s.id)}" ${s.id===state.active?'selected':''}>${esc(s.name)} · ${esc(s.versionLabel)}</option>`).join('')}</select></label>
      <label>表现汇总的样本权重<select id="iwSampleWeight">${selectOptions(d.fields, active?.sampleWeight || '', '不使用（每人权重为1）')}</select></label>
      <label>建模/汇总样本筛选<input id="iwFilter" value="${esc(active?.filter || '')}" placeholder="例如 Q6=1；留空为全部样本"></label></div>
      <p class="panel-note">筛选条件支持变量=值与“且”。回归只在主动运行时估计权重；切换交叉分组不会重跑模型。</p>
      ${scaleControls('iw', active?.dimensions?.[0]?.scale)}
      <div id="iwDimensions">${active ? '<p>应用的二级指标（可多选）</p>' + active.dimensions.map(dim=>`<label class="iw-choice"><input type="checkbox" data-iw-dimension="${esc(dim.name)}" ${state.selected.includes(dim.name)?'checked':''}>${esc(dim.name)} <small>${dim.items.length}题 · ${esc(dim.source?.kind==='regression'?'回归B':dim.source?.fileName||'导入权重')}</small></label>`).join('') : '<p class="panel-note">尚未选择方案，可先导入文件；有现成系数时无需提供总体题Y。</p>'}</div>
      <div class="button-row"><button id="iwPreview" class="primary-btn" type="button">计算加权指标预览</button><button id="iwExport" class="secondary-btn" type="button">导出加权指标 Excel</button><button id="iwSaveSettings" class="secondary-btn" type="button">另存当前设置</button><button id="iwCombine" class="secondary-btn" type="button" ${active?'':'disabled'}>编辑 / 合并为新方案</button></div>
      <p id="iwMessage" class="iw-message" role="status"></p><div id="iwImport"></div><div id="iwResults"></div><datalist id="iwFields">${d.fields.map(f=>`<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</datalist></div>`;
    if (sheets.length) renderImport();
    if (draft.length) renderDraft();
  }
  function columnName(i) { let s=''; for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s; }
  function renderImport() {
    const rows=sheets[source.sheetIndex || 0]?.rows || [], count=Math.max(0,...rows.map(r=>r.length));
    const choice=(id,label,value,optional=false)=>`<label>${label}<select id="${id}">${optional?'<option value="-1">不指定</option>':''}${Array.from({length:count},(_,i)=>`<option value="${i}" ${i===value?'selected':''}>${columnName(i)} 列</option>`).join('')}</select></label>`;
    el('iwImport').innerHTML=`<details open class="iw-editor"><summary>导入配置：${esc(fileName)}</summary><div class="iw-grid">
      <label>工作表<select id="iwSheet">${sheets.map((s,i)=>`<option value="${i}" ${i===(source.sheetIndex||0)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>数据起始行<input id="iwStart" type="number" min="1" value="${source.start||2}"></label><label>数据结束行<input id="iwEnd" type="number" min="1" value="${source.end||rows.length}"></label>
      ${choice('iwDimCol','二级指标列',source.dimensionCol??0,true)}${choice('iwVarCol','变量 / 题项列',source.variableCol??1)}${choice('iwLabelCol','题项名称列',source.labelCol??-1,true)}${choice('iwValueCol','权重 / 系数列',source.valueCol??2)}
      <label>数值含义<select id="iwValueType"><option value="coefficient">系数 / 相对分值</option><option value="local">维度内部权重</option><option value="global">三级全局权重</option></select></label>
      <label>未指定二级列时的名称<input id="iwDimName" value="综合指标"></label></div>
      <p class="panel-note">行号与原Excel对应。请选择题项明细区域，排除表头、截距和汇总行；公式必须在原文件中有已保存的计算结果。</p>
      <div class="table-wrap iw-file-preview"><table><thead><tr><th>行</th>${Array.from({length:count},(_,i)=>`<th>${columnName(i)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,80).map((r,i)=>`<tr><td>${i+1}</td>${Array.from({length:count},(_,j)=>`<td>${esc(r[j]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <button class="secondary-btn" type="button" id="iwReadRows">匹配并预览权重</button><div id="iwDraft"></div></details>`;
  }
  function groupDraft() {
    const grouped=new Map();
    draft.forEach(i=>{if(!grouped.has(i.dimension))grouped.set(i.dimension,[]);grouped.get(i.dimension).push(i);});
    return [...grouped].map(([name,items])=>({name,items,scale:readScale('iw'),source:{...source,kind:'import',fileName},y:items[0]?.y,diagnostics:items.some(i=>i.origin?.kind==='manual')?undefined:items[0]?.diagnostics}));
  }
  function renderDraft() {
    let node=el('iwDraft');
    if(!node){el('iwImport').innerHTML='<div class="iw-editor"><div id="iwDraft"></div></div>';node=el('iwDraft');}
    const grouped=new Map(); draft.forEach(i=>grouped.set(i.dimension,(grouped.get(i.dimension)||0)+(i.value||0)));
    node.innerHTML=`<h4>核对题项与最终权重</h4><p class="panel-note">名称及后缀匹配只是建议，请核对变量。可移除不属于本方案的行；保存时对保留的完整维度重新归一化。</p>
      <div class="table-wrap iw-draft-table"><table><thead><tr><th>来源行</th><th>二级指标</th><th>三级指标</th><th>样本变量</th><th>输入系数</th><th>归一权重</th><th>反向题</th><th></th></tr></thead><tbody>${draft.map((i,j)=>`<tr>
      <td>${i.sourceRow??'模型'}</td><td><input aria-label="二级指标" data-iw-edit="dimension" data-index="${j}" value="${esc(i.dimension)}"></td><td>${esc(i.label)}${i.confirmed===false?'<small>（建议匹配，请核对）</small>':''}</td>
      <td><input aria-label="匹配变量" list="iwFields" data-iw-edit="field" data-index="${j}" value="${esc(i.field)}" class="${i.field?'':'iw-invalid'}"></td>
      <td><input aria-label="输入系数" data-iw-edit="value" data-index="${j}" value="${esc(i.value??i.input)}"></td><td>${i.value!==null&&grouped.get(i.dimension)>0?num(i.value/grouped.get(i.dimension)*100)+'%':'待核'}</td>
      <td><input aria-label="反向题" type="checkbox" data-iw-edit="reverse" data-index="${j}" ${i.reverse?'checked':''}></td><td><button type="button" class="secondary-btn mini" data-iw-remove="${j}">移除</button></td></tr>`).join('')}</tbody></table></div>
      <label>新方案名称<input id="iwDraftName" value="${esc(fileName || '组合权重方案')}"></label><div class="button-row"><button id="iwSaveDraft" class="primary-btn" type="button">确认映射并保存应用</button><button id="iwMergeDraft" class="secondary-btn" type="button">加入当前方案后预览</button></div>`;
  }
  function activeConfig() {
    restore();
    if(!state.enabled)return null;
    const saved=state.schemes.find(s=>s.id===state.active);
    if(!saved)throw Error('请先选择或导入指标权重方案。');
    const scale=readScale('iw');
    return C.normalizeScheme({...clone(saved),filter:el('iwFilter').value.trim(),sampleWeight:el('iwSampleWeight').value,
      dimensions:saved.dimensions.filter(d=>state.selected.includes(d.name)).map(d=>({...d,scale}))},data().headers);
  }
  function addScheme(scheme) {
    const normalized=C.normalizeScheme(scheme,data().headers), now=new Date();
    normalized.id=crypto.randomUUID();normalized.versionLabel=now.toLocaleString('zh-CN');normalized.createdAt=now.toISOString();
    normalized.dataset={fileName:typeof crosstabSourceFilename==='string'?crosstabSourceFilename:'',fields:data().headers,rows:data().rows.length};
    state.schemes.push(normalized);state.active=normalized.id;state.selected=normalized.dimensions.map(d=>d.name);state.enabled=true;
    persist();invalidate();sheets=[];draft=[];fileName='';render();notice(`已保存「${normalized.name}」，${normalized.dimensions.length}个维度。`);
  }
  function filterData(d, condition) {
    return filterRowsByHeaderCondition({headers:d.headers,rows:d.rows,rawHeaders:d.headers,rawRows:d.rows},condition);
  }
  async function compute(plan = activeCrosstabHeaderPlan()) {
    const startedScope=projectKey(), startedRevision=revision;
    const scheme=activeConfig();if(!scheme)return null;
    const d=data(),rows=filterData(d,scheme.filter||'');
    const local={...d,rows}, columns=plan.slice();
    if(!columns.some(c=>!c.condition&&!c.parts?.length))columns.unshift({group:'总体',label:'总体',condition:''});
    const groups=columns.map(b=>filterRowsByConditionParts({rows,rawRows:rows,rawHeaders:d.headers},b.parts||parseHeaderCondition(b.condition)));
    const results=[];
    for(const dim of scheme.dimensions){ results.push({dimension:dim,groups:groups.map(g=>C.calculate(g,dim,scheme.sampleWeight))});await nextUiTick(); if(startedScope!==projectKey()||startedRevision!==revision)throw Error('数据或设置已变更，请重新计算。'); }
    return {scheme,plan:columns,results,sampleN:local.rows.length,createdAt:new Date().toISOString()};
  }
  function renderResults(result) {
    if(!result){el('iwResults').innerHTML='<p class="panel-note">指标加权已关闭，普通交叉分析照常使用。</p>';return;}
    const head=result.plan.map(b=>`<th>${esc([b.group,b.label].filter(Boolean).join(' / '))}</th>`).join('');
    el('iwResults').innerHTML=`<p class="panel-note">方案：${esc(result.scheme.name)} · ${esc(result.scheme.versionLabel)}；净满意度为−100至100分；缺失显示—。修改设置后须重新计算。</p>
      <div class="table-wrap"><table><thead><tr><th>二级指标 / 统计量</th>${head}</tr></thead><tbody>${result.results.map(r=>`<tr><th>${esc(r.dimension.name)} · ${r.dimension.scale.metric==='net'?'加权净满意度':'加权均值'}</th>${r.groups.map(g=>`<td>${num(g.value)}</td>`).join('')}</tr><tr><td>至少1项有效N / 全题有效N</td>${r.groups.map(g=>`<td>${g.nAny} / ${g.nAll}</td>`).join('')}</tr><tr><td>题项N范围 / 有效权重覆盖</td>${r.groups.map(g=>`<td>${g.nMin}–${g.nMax} / ${num(g.coverage*100)}%</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <details><summary>三级题项表现与基数</summary><div class="table-wrap"><table><thead><tr><th>维度 / 题项</th><th>内部权重</th>${head}</tr></thead><tbody>${result.results.flatMap(r=>r.dimension.items.map((item,i)=>`<tr><td>${esc(r.dimension.name+' / '+item.label)}</td><td>${num(item.weight*100)}%</td>${r.groups.map(g=>`<td>${num(g.items[i].value)}（N=${g.items[i].n}，base=${num(g.items[i].base)}）</td>`).join('')}</tr>`)).join('')}</tbody></table></div></details>`;
  }
  function workbookSheets(result) {
    if(!result)return [];
    const typed=v=>v===null||v===undefined?'':{value:v,type:'number'};
    const row=(...cells)=>({cells}), banner=['指标 / 统计量',...result.plan.map(b=>[b.group,b.label].filter(Boolean).join(' / '))];
    const summary=[row('二级加权指标'),row(`方案：${result.scheme.name}；版本：${result.scheme.versionLabel}`),row(`样本筛选：${result.scheme.filter||'全部'}；样本权重：${result.scheme.sampleWeight||'无'}；导出时按当前设置重算（详细口径见指标权重方案）`),row(...banner)];
    const detail=[row('二级指标','三级变量','三级指标','内部权重','人群','表现值','有效N','加权base','满意人数','中立人数','不满意人数')];
    const weights=[row('二级指标','变量','三级指标','输入值','内部权重','来源','原文件/方法','来源行','表现方式','最小值','最大值','不满意上限','满意下限','缺失码','反向题')];
    const diagnosis=[row('维度','样本N','排除N','R²','调整R²','变量','B','Beta','标准误','t','p','VIF','诊断','总体题Y','Y反向计分','模型方法','回归样本权重','建模样本筛选','截距','残差自由度')];
    for(const r of result.results){
      for(const [label,fn] of [[r.dimension.name+' · '+(r.dimension.scale.metric==='net'?'加权净满意度':'加权均值'),g=>g.value],['至少1项有效N',g=>g.nAny],['全部题有效N',g=>g.nAll],['题项最小N',g=>g.nMin],['题项最大N',g=>g.nMax],['有效权重覆盖率',g=>g.coverage]]) summary.push(row(label,...r.groups.map(g=>typed(fn(g)))));
      r.dimension.items.forEach((item,j)=>{
        const s=r.dimension.scale,src=r.dimension.source||{};
        weights.push(row(r.dimension.name,item.field,item.label,typed(item.value),typed(item.weight),src.kind||'外部',src.fileName||src.method||'',item.sourceRow||'',s.metric,typed(s.min),typed(s.max),typed(s.low),typed(s.high),s.missing.join(','),item.reverse?'是':'否'));
        r.groups.forEach((g,k)=>{const t=g.items[j];detail.push(row(r.dimension.name,item.field,item.label,typed(item.weight),banner[k+1],typed(t.value),typed(t.n),typed(t.base),typed(t.positiveN),typed(t.neutralN),typed(t.negativeN)));});
      });
      const model=r.dimension.diagnostics;
      if(model)model.coefficients.forEach(c=>diagnosis.push(row(r.dimension.name,typed(model.n),typed(model.excluded),typed(model.r2),typed(model.adjustedR2),c.field,typed(c.B),typed(c.beta),typed(c.se),typed(c.t),typed(c.p),typed(c.vif),model.warnings.join('；'),r.dimension.y||'',r.dimension.yOptions?.reverse?'是':'否',r.dimension.source?.method||'',r.dimension.source?.weightField||'无',r.dimension.source?.filter||'全部',typed(model.intercept),typed(model.df))));
      else diagnosis.push(row(r.dimension.name,'外部权重，未提供模型诊断'));
    }
    summary.push(row('各题使用各自有效base后加权；缺失不填0。N_any并非所有题共同分母。未进行显著性检验。'));
    return [{name:'二级加权指标',rows:summary},{name:'三级指标表现',rows:detail},{name:'指标权重方案',rows:weights},{name:'指标模型诊断',rows:diagnosis}].map((sheet,index)=>{
      const count=Math.max(...sheet.rows.map(r=>r.cells.length));
      sheet.columnCount=count; sheet.columns=Array.from({length:count},(_,i)=>({index:i+1,width:i===0?240:160}));
      sheet.rows.forEach((r,i)=>{const header=index===0?i===3:i===0;r.cells=r.cells.map(c=>typeof c==='object'?c:{value:c});if(header)r.cells=r.cells.map(c=>({...c,format:'crosstabHeaderBottom'}));if(index===0&&(i<3||i===sheet.rows.length-1)){r.cells[0].mergeAcross=count-1;r.cells[0].format=i===0?'crosstabCaption':'crosstabRowLabel';r.height=36;}});
      return sheet;
    });
  }
  async function readWorkbook(file) {
    if(/\.csv$/i.test(file.name))return [{name:'CSV',rows:C.parseCsv(await file.text())}];
    if(!/\.xlsx$/i.test(file.name))throw Error('请上传.xlsx或.csv文件。');
    const buffer=await file.arrayBuffer(), xml=await readZipText(buffer,'xl/workbook.xml'), rel=await readZipText(buffer,'xl/_rels/workbook.xml.rels');
    if(!xml)throw Error('不是有效的XLSX工作簿。');
    const shared=sharedStringsFromXml(await readZipText(buffer,'xl/sharedStrings.xml')||''), output=[];
    for(const sheet of getWorkbookSheets(xml,rel)){
      const sheetXml=await readZipText(buffer,sheet.path), doc=new DOMParser().parseFromString(sheetXml,'application/xml'), rows=[];
      for(const rowNode of doc.getElementsByTagNameNS('*','row')){
        const r=Number(rowNode.getAttribute('r'));if(r>10000)throw Error('权重文件超过10000行，请仅保留指标配置。');
        const cells=[];
        for(const c of rowNode.getElementsByTagNameNS('*','c')){
          const ref=c.getAttribute('r'), index=columnIndexFromRef(ref), v=c.getElementsByTagNameNS('*','v')[0]?.textContent||'', t=c.getAttribute('t');
          cells[index]=t==='s'?shared[Number(v)]||'':t==='inlineStr'?Array.from(c.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join(''):v;
        }
        rows[r-1]=cells;
      }
      output.push({name:sheet.name,rows:Array.from({length:rows.length},(_,i)=>rows[i]||[])});
    }
    return output;
  }
  function importConfig() {
    return {sheetIndex:Number(el('iwSheet').value),start:Number(el('iwStart').value),end:Number(el('iwEnd').value),dimensionCol:Number(el('iwDimCol').value),variableCol:Number(el('iwVarCol').value),labelCol:Number(el('iwLabelCol').value),valueCol:Number(el('iwValueCol').value),dimensionName:el('iwDimName').value,valueType:el('iwValueType').value};
  }
  function defaultSource() {
    const rows=sheets[source.sheetIndex||0].rows;
    const header=rows.findIndex(r=>r.some(v=>/^(权重或系数|权重|Estimate)$/i.test(String(v))));
    source={...source,start:header>=0?header+2:2,end:rows.length,dimensionCol:0,variableCol:1,valueCol:2,labelCol:-1};
    if(header>=0&&rows[header].some(v=>v==='Estimate')){
      source.dimensionCol=5;source.variableCol=0;source.valueCol=1;source.labelCol=6;
      let end=header+1;while(end<rows.length&&rows[end]?.[5]&&rows[end]?.[6]&&C.number(rows[end][1])!==null)end++;source.end=end;
    }
  }
  async function click(event) {
    const b=event.target.closest('button');if(!b||busy)return;
    try{
      if(b.id==='iwTemplate'){downloadTextFile('指标权重模板.csv','二级指标,三级变量名,权重或系数,三级指标名称\n服务体验,Q1,0.4,服务态度\n服务体验,Q2,0.35,响应速度\n服务体验,Q3,0.25,问题解决\n','text/csv;charset=utf-8');return;}
      if(b.id==='iwCleaned'){
        const d=projectDataBus.get('cleanedData');if(!d?.rows?.length)throw Error('当前项目没有清洗后数据，请先导入样本文件。');
        lastCrosstabDataContext=null;renderCrosstabImportState([d.headers,...d.rows.map(r=>d.headers.map(h=>r[h]??''))].map(r=>r.map(csvCell).join(',')).join('\n'),'项目清洗后数据');render();return;
      }
      if(b.id==='iwReadRows'){
        source=importConfig();draft=C.importRows(sheets[source.sheetIndex].rows,source,data().fields);
        if(draft.some(i=>i.percent)&&draft.some(i=>!i.percent))throw Error('所选系数列混用了百分号文本与普通数值，请先统一单位后导入。');
        source.sheetName=sheets[source.sheetIndex].name;renderDraft();notice('请核对匹配变量、来源行与归一权重，再保存。');return;
      }
      if(b.dataset.iwRemove!==undefined){draft.splice(Number(b.dataset.iwRemove),1);renderDraft();return;}
      if(b.id==='iwCombine'){
        const s=activeConfig();if(!s)throw Error('请先启用并选择方案。');
        draft=s.dimensions.flatMap(d=>d.items.map(i=>({...clone(i),dimension:d.name,origin:d.source,diagnostics:d.diagnostics,y:d.y})));sheets=[];fileName=s.name+'（副本）';source={kind:'combined'};render();return;
      }
      if(b.id==='iwMergeDraft'){
        const old=state.schemes.find(s=>s.id===state.active);if(!old)throw Error('请先选择要合并的已保存方案。');
        const selectedDims=old.dimensions.filter(d=>state.selected.includes(d.name));if(!selectedDims.length)throw Error('请先选择要加入的维度。');const names=new Set(draft.map(i=>i.dimension));if(selectedDims.some(d=>names.has(d.name)))throw Error('维度重名，请先改名或移除重复维度，再合并。');
        draft.push(...selectedDims.map(d=>d.items.map(i=>({...clone(i),dimension:d.name,origin:d.source,diagnostics:d.diagnostics,y:d.y}))).flat());renderDraft();return;
      }
      if(b.id==='iwSaveDraft'){
        const dimensions=groupDraft().map(d=>({...d,source:d.items.some(i=>i.origin?.kind==='manual')?{kind:'manual',method:'经手动调整的权重'}:d.items[0]?.origin||d.source}));
        addScheme({name:el('iwDraftName').value.trim()||'导入权重方案',dimensions,filter:el('iwFilter').value.trim(),sampleWeight:el('iwSampleWeight').value});return;
      }
      if(b.id==='iwSaveSettings'){const s=activeConfig();if(!s)throw Error('请先启用指标加权。');addScheme({...s,name:s.name+'（新设置）'});return;}
      if(b.id==='iwPreview'||b.id==='iwExport'){
        busy=true;b.disabled=true;notice('正在按固定权重计算各人群的三级表现和二级指标…');
        lastResult=await compute();renderResults(lastResult);
        if(b.id==='iwExport'&&lastResult)await downloadExcelWorkbookXml('二级加权指标.xlsx',workbookSheets(lastResult));
        notice(lastResult?'计算完成。可展开三级题项查看有效N和base。':'指标加权未启用。');
      }
    }catch(error){notice(error.message,true);}finally{busy=false;b.disabled=false;}
  }
  async function change(event) {
    const target=event.target;
    try{
      if(target.id==='iwFile'){
        const file=target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('权重文件请控制在20MB以内。');
        const started=projectKey(), sequence=++importSequence;notice('正在读取权重文件…');const parsed=await readWorkbook(file);if(started!==projectKey()||sequence!==importSequence)return;
        sheets=parsed;fileName=file.name;source={sheetIndex:0};draft=[];defaultSource();renderImport();notice('请选择明细区域和数值列。');return;
      }
      if(target.id==='iwSheet'){source={sheetIndex:Number(target.value)};draft=[];defaultSource();renderImport();return;}
      if(target.dataset.iwEdit){const i=draft[Number(target.dataset.index)],k=target.dataset.iwEdit;i.origin={...i.origin,kind:'manual',method:'手动调整后的权重'};delete i.diagnostics;i[k]=k==='value'?C.coefficient(target.value).value:k==='reverse'?target.checked:target.value;renderDraft();return;}
      if(target.id==='iwEnabled'){state.enabled=target.checked;el('iwConfiguration').hidden=!state.enabled;target.setAttribute('aria-expanded',String(state.enabled));persist();invalidate();}
      if(target.id==='iwScheme'){invalidate();state.active=target.value;state.selected=(state.schemes.find(s=>s.id===state.active)?.dimensions||[]).map(d=>d.name);persist();render();}
      if(target.dataset.iwDimension){state.selected=Array.from(el('iwDimensions').querySelectorAll('input:checked')).map(i=>i.dataset.iwDimension);persist();invalidate();}
      if(/^iw(Metric|Min|Max|Low|High|Missing|Filter|SampleWeight)$/.test(target.id))invalidate();
    }catch(error){notice(error.message,true);}
  }
  function renderModels() {
    const host=el('indicatorDriverPanel');if(!host)return;const d=data();
    const settings=Object.fromEntries(Array.from(host.querySelectorAll('[id^=iwModel]')).filter(n=>n.matches('input,select')).map(n=>[n.id,n.value]));
    host.innerHTML=`<h3>满意度分层加权</h3><p class="panel-note">复用交叉分析中导入的原始样本。每维度独立选择总体题Y和下属题X，使用非标准化B归一化；也可以直接在交叉分析导入现成权重。</p>
      <p>当前数据：${d.rows.length}行、${d.headers.length}个字段。</p><div class="button-row"><button type="button" class="secondary-btn" data-jump="crosstab-analysis">前往交叉分析导入样本</button><button type="button" class="secondary-btn" id="iwAddModel">添加二级维度</button><button type="button" class="secondary-btn" id="iwModelsFromScheme">从当前权重方案建立维度</button></div>
      <div id="iwModelRows">${models.map((m,i)=>`<div class="iw-model" data-model-index="${i}"><label>二级指标名称<input data-model-prop="name" value="${esc(m.name)}"></label><label>本维度总体题Y<select data-model-prop="y">${selectOptions(d.fields,m.y,'请选择总体题')}</select></label><label>三级题X（可多选）<select multiple size="6" data-model-prop="xs">${d.fields.map(f=>`<option value="${esc(f.id)}" ${m.items.some(x=>x.field===f.id)?'selected':''}>${esc(f.id+' · '+f.label)}</option>`).join('')}</select></label><button type="button" class="secondary-btn mini" data-model-remove="${i}">移除此维度</button><details style="grid-column:1/-1"><summary>题目方向（默认高分更满意）</summary><label class="iw-choice"><input type="checkbox" data-model-prop="reverseY" ${m.yOptions?.reverse?'checked':''}>总体题Y反向计分</label><label>反向计分的三级题（可多选，只对已选X生效）<select multiple size="3" data-model-prop="reverseXs">${d.fields.map(f=>`<option value="${esc(f.id)}" ${m.items.some(x=>x.field===f.id&&x.reverse)?'selected':''}>${esc(f.id+' · '+f.label)}</option>`).join('')}</select></label></details></div>`).join('')}</div>
      <div class="iw-grid"><label>建模筛选<input id="iwModelFilter" placeholder="例如Q6=1"></label><label>回归样本权重<select id="iwModelWeight">${selectOptions(d.fields)}</select></label><label>方案名称<input id="iwModelName" value="满意度回归权重"></label></div>
      ${scaleControls('iwModel')}<p class="panel-note">量表、方向与缺失规则用于原始评分回归；表现方式和阈值用于后续交叉统计。质控题请勿选入X。</p>
      <div class="button-row"><button type="button" id="iwFitModels" class="primary-btn">计算各维度回归</button><button type="button" id="iwApplyModels" class="secondary-btn" disabled>保存权重并应用到交叉分析</button></div><div id="iwModelResults" aria-live="polite"></div>`;
    for(const [id,value] of Object.entries(settings))if(el(id))el(id).value=value;
  }
  function readModels(){models=Array.from(el('iwModelRows').children).map(row=>{const i=Number(row.dataset.modelIndex);return {...models[i],name:row.querySelector('[data-model-prop="name"]').value.trim(),y:row.querySelector('[data-model-prop="y"]').value,yOptions:{...(models[i]?.yOptions||{}),reverse:row.querySelector('[data-model-prop="reverseY"]').checked},items:Array.from(row.querySelector('[data-model-prop="xs"]').selectedOptions).map(o=>({...(models[i]?.items.find(x=>x.field===o.value)||{}),field:o.value,reverse:Array.from(row.querySelector('[data-model-prop="reverseXs"]').selectedOptions).some(v=>v.value===o.value),label:data().fields.find(f=>f.id===o.value)?.label||o.value}))};});}
  async function modelClick(event){
    const b=event.target.closest('button');if(!b||busy)return;
    try{
      readModels();
      if(b.id==='iwAddModel'){models.push({name:`维度${models.length+1}`,y:'',items:[]});renderModels();return;}
      if(b.dataset.modelRemove!==undefined){models.splice(Number(b.dataset.modelRemove),1);renderModels();return;}
      if(b.id==='iwModelsFromScheme'){const s=state.schemes.find(s=>s.id===state.active);if(!s)throw Error('请先在交叉分析选择方案。');models=clone(s.dimensions);renderModels();return;}
      if(b.id==='iwFitModels'){
        if(!models.length)throw Error('请先添加二级维度。');busy=true;b.disabled=true;fitted=[];el('iwApplyModels').disabled=true;
        const startedScope=projectKey(), startedRevision=revision, training={filter:el('iwModelFilter').value,weight:el('iwModelWeight').value,name:el('iwModelName').value,scope:projectKey()};
        const d=data(),scale=readScale('iwModel'),rows=filterData(d,el('iwModelFilter').value),w=el('iwModelWeight').value;
        el('iwModelResults').textContent='正在拟合各维度…';
        for(const model of models){try{const result=C.regress(rows,{...model,scale},w);result.dimension.diagnostics={...result,dimension:undefined};fitted.push({name:model.name,result});}catch(error){fitted.push({name:model.name,error:error.message});}await nextUiTick();if(startedScope!==projectKey()||startedRevision!==revision){fitted=[];throw Error('数据或建模设置已变更，请重新拟合。');}}
        el('iwModelResults').innerHTML=fitted.map((f,i)=>f.error?`<p class="iw-error">${esc(f.name)}：${esc(f.error)}</p>`:`<details open><summary><label><input type="checkbox" data-fit-index="${i}" ${f.result.usable?'checked':'disabled'}> ${esc(f.name)}</label> N=${f.result.n}，R²=${num(f.result.r2)}，排除${f.result.excluded}人</summary><p class="iw-error">${esc(f.result.warnings.join(' '))}</p><div class="table-wrap"><table><thead><tr><th>变量</th><th>B</th><th>Beta</th><th>标准误</th><th>t</th><th>p</th><th>VIF</th></tr></thead><tbody>${f.result.coefficients.map(c=>`<tr><td>${esc(c.field)}</td>${['B','beta','se','t','p','vif'].map(k=>`<td>${num(c[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`).join('');
        el('iwApplyModels').disabled=!fitted.some(f=>f.result?.usable);
        // Freeze the settings that produced these coefficients; later edits require a refit.
        fitted.forEach(f=>{f.training=training;});
      }
      if(b.id==='iwApplyModels'){
        const selected=Array.from(el('iwModelResults').querySelectorAll('input:checked')).map(i=>fitted[Number(i.dataset.fitIndex)]).filter(f=>f.result?.usable);
        if(!selected.length)throw Error('请勾选至少一个可用模型。');
        if(selected.some(f=>f.training.scope!==projectKey()))throw Error('项目已切换，请重新拟合。');
        addScheme({name:selected[0].training.name||'回归权重方案',dimensions:selected.map(f=>({...f.result.dimension,source:{...f.result.dimension.source,filter:f.training.filter}})),filter:selected[0].training.filter,sampleWeight:'',trainingWeight:selected[0].training.weight});
        document.querySelector('[data-view="crosstab-analysis"]')?.click();location.hash='crosstab-analysis';
      }
    }catch(error){el('iwModelResults').textContent=error.message;}finally{busy=false;b.disabled=false;}
  }
  el('indicatorWeightPanel')?.addEventListener('click',click);
  el('indicatorWeightPanel')?.addEventListener('change',change);
  el('indicatorDriverPanel')?.addEventListener('click',modelClick);
  el('indicatorDriverPanel')?.addEventListener('change',event=>{if(!event.target.matches('[data-fit-index]')){revision++;el('iwApplyModels').disabled=true;}});
  projectDataBus.onChange(k=>{if(k==='__project__')restore(true);else if(k===KEY&&!localStorage.getItem(`${KEY}:${projectKey()}`)){const saved=projectDataBus.get(KEY);if(saved?.schemes){state=clone(saved);invalidate();render();}}});
  el('crosstabData')?.addEventListener('input',()=>{lastCrosstabDataContext=null;invalidate('样本数据已修改，请重新识别字段并计算。');el('iwApplyModels').disabled=true;});
  root.IndicatorWeightUI={invalidate,sync(){restore();render();invalidate('样本数据已更新，请核对变量并重新计算。');renderModels();},getConfig:activeConfig,compute,workbookSheets,
    async buildSheets(plan){const result=await compute(plan);return workbookSheets(result);}};
  restore(true);
})(window);
