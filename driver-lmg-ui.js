(function (root) {
  'use strict';
  const L = root.DriverLMG, el = id => document.getElementById(id), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => v == null ? '—' : `${(100 * v).toFixed(1)}%`, num = (v, n = 3) => v == null ? '—' : Number(v).toFixed(n);
  const state = { scope: 'single', method: 'beta-abs', worker: null, sequence: 0, running: false, models: [], active: '', source: '', dataset: null };
  const methodName = () => state.method === 'lmg' ? 'LMG 解释力份额' : '标准化 β 绝对值占比';
  function selection() { return root.DriverAnalysisUI.getSelection(); }
  function refresh() {
    const d = root.DriverAnalysisUI?.getDataset(), matched = L.matchQuestionnaire(d);
    el('driverUseNpsPlan').disabled = !matched || state.running;
    el('driverDialogUseNpsPlan').hidden = !matched || !root.DriverAnalysisUI?.isStandard();
    el('driverLmgPlanStatus').textContent = state.scope === 'questionnaire' ? '已应用电商 NPS 0525 二级指标方案：默认展示完整11项权重，另保留平台 / 实际体验组结果；跳题不补 0。' : matched ? '已匹配电商 NPS 问卷。可应用完整11项二级指标及平台 / 实际体验分组方案。' : '使用当前变量计算系数型权重与 LMG 对照；可导入匹配问卷的数据进行平台 / 体验分组。';
    el('driverLmgScope').value = state.scope;
    el('driverWeightMethod').value = state.method;
    el('driverLmgScope').querySelector('[value="questionnaire"]').disabled = !matched;
    el('driverLmgCancel').hidden = !state.running;
    el('runDriverAnalysis').textContent = state.scope === 'questionnaire' ? '计算各平台 / 体验组权重' : '计算权重与 LMG 对照';
  }
  function cancel() {
    state.worker?.terminate(); state.worker = null; ++state.sequence; state.running = false;
    state.models = []; state.active = ''; el('driverLmgSummary').innerHTML = ''; el('driverLmgSummary').hidden = true; el('driverLmgGroupControls').hidden = true;
    el('driverLmgProgress').textContent = ''; projectDataBus.set('modelResults.driverLmgGroups', null); refresh();
  }
  function usePlan(close = true) {
    if (!L.matchQuestionnaire(root.DriverAnalysisUI.getDataset())) return;
    state.scope = 'questionnaire';
    root.DriverAnalysisUI.setSelection({ y: 'Q12__1', xs: L.INDICATORS.map(f => f.id) });
    if (close) el('driverVariableDialog').close();
    refresh();
  }
  function isGrouped() { return state.scope === 'questionnaire'; }
  function compatiblePlan() {
    const s = selection(); return L.matchQuestionnaire(root.DriverAnalysisUI.getDataset()) && s.y === 'Q12__1' && s.xs.length === 11 && L.INDICATORS.every(f => s.xs.includes(f.id));
  }
  function makeTable(d, jobs) {
    // Only selected scores and grouping codes enter the worker, never contacts.
    const ids = [...new Set(jobs.flatMap(j => [...j.xs, j.y, ...(j.filters || []).map(f => f.field)]))];
    return { name: d.name, headers: ids, variables: ids.map(id => { const f = d.fields.find(f => f.id === id); return { name: id, label: f.label, type: f.type, measure: f.measure, valueLabels: f.valueLabels, missing: f.missing }; }), rows: d.rows.map(row => ids.map(id => row[id])) };
  }
  function viewModel(m) {
    const lmg = state.method === 'lmg', formalWeights = lmg ? m.lmgFormalWeights : m.formalWeights;
    const results = m.results.map(r => ({ ...r, weight: lmg ? r.lmgWeight : r.weight, weightLow: lmg ? r.lmgWeightLow : r.weightLow, weightHigh: lmg ? r.lmgWeightHigh : r.weightHigh, firstRate: lmg ? r.lmgFirstRate : r.firstRate, comparisonWeight: lmg ? r.weight : r.lmgWeight }));
    if (m.hasWeights) results.sort((a, b) => b.weight - a.weight);
    return { ...m, method: methodName(), weightMethod: state.method, formalWeights, exploratory: m.hasWeights && !formalWeights, status: !m.hasWeights ? '无法估计权重' : formalWeights ? '可输出组内权重' : '探索性结果', reasons: lmg && m.hasWeights ? m.lmgReasons : m.reasons, results, rankStable: m.hasWeights && results[0].firstRate != null && results[0].firstRate >= .7, bootstrap: { ...m.bootstrap, maxWidth: lmg ? m.bootstrap.lmgMaxWidth : m.bootstrap.maxWidth } };
  }
  function saveResults() {
    if (!state.running) projectDataBus.set('modelResults.driverLmgGroups', { version: L.VERSION, sourceName: state.source, weightMethod: state.method, models: state.models });
  }
  function run() {
    const d = root.DriverAnalysisUI.getDataset(); if (!d) return;
    let jobs, extraMissing;
    try {
      extraMissing = root.DriverCore.missingCodes(el('driverMissingCodes').value);
      if (isGrouped() && !compatiblePlan()) state.scope = 'single';
      if (isGrouped()) jobs = L.questionnaireJobs(d);
      else { const s = selection(), check = root.DriverAnalysisUI.prepare(); if (check.errors.length) throw Error(check.errors.join(' ')); jobs = [{ id: 'single', label: '当前变量模型', y: s.y, xs: s.xs, filters: [] }]; }
    } catch (error) { invalidateDriverAnalysis(error.message); return; }
    invalidateDriverAnalysis('正在计算 B、β、系数型权重及 LMG 对照…');
    state.running = true; state.dataset = d; state.source = d.fileName || d.name; const sequence = ++state.sequence;
    refresh(); el('driverLmgProgress').textContent = `准备计算 ${jobs.length} 个模型，可随时取消。`;
    el('runDriverAnalysis').disabled = true;
    try {
      const worker = new Worker('./driver-lmg-worker.js?v=20261017-all11-1'); state.worker = worker;
      worker.onmessage = event => {
        const msg = event.data; if (sequence !== state.sequence || msg.id !== sequence || state.dataset !== root.DriverAnalysisUI.getDataset()) return;
        if (msg.type === 'progress') el('driverLmgProgress').textContent = `${msg.index + 1}/${msg.count} · ${msg.label} · ${msg.phase === 'bootstrap' ? `自助抽样 ${msg.current}/${msg.total}` : '交叉验证'}`;
        if (msg.type === 'result') { state.models.push(msg.result); if (!state.active) state.active = msg.result.id; renderOverview(); renderCurrent(); }
        if (msg.type === 'complete') {
          state.running = false; worker.terminate(); state.worker = null; refresh(); root.DriverAnalysisUI.refresh();
          saveResults(); renderOverview(); renderCurrent(); markWorkspaceStatus('models');
        }
        if (msg.type === 'error') fail(msg.message);
      };
      worker.onerror = error => { if (sequence === state.sequence) fail(error.message || '权重计算失败'); };
      worker.postMessage({ id: sequence, table: makeTable(d, jobs), jobs, extraMissing });
    } catch (error) { fail(error.message); }
  }
  function fail(message) { invalidateDriverAnalysis(`本次计算未完成：${message}。请重新计算，未导出部分结果。`); root.DriverAnalysisUI.refresh(); }
  function renderOverview() {
    const models = state.models.map(viewModel);
    if (!state.running && models.length) {
      const formal = models.filter(m => m.formalWeights).length, exploratory = models.filter(m => m.exploratory).length;
      el('driverLmgProgress').textContent = `已检查 ${models.length} 个模型：${formal} 个通过筛查，${exploratory} 个探索性结果，${models.length - formal - exploratory} 个无法估计。主权重：${methodName()}。`;
    }
    el('driverLmgSummary').hidden = models.length < 2;
    const platforms = [...new Set(models.map(m => m.platform))];
    el('driverLmgGroupControls').hidden = models.length < 2;
    el('driverViewAllIndicators').hidden = !state.models.some(m => m.id === 'all-secondary');
    const previous = el('driverLmgPlatform').value;
    el('driverLmgPlatform').innerHTML = platforms.map(p => `<option>${esc(p)}</option>`).join('');
    if (platforms.includes(previous)) el('driverLmgPlatform').value = previous;
    fillGroups();
    if (models.length < 2) { el('driverLmgSummary').innerHTML = ''; return; }
    el('driverLmgSummary').innerHTML = `<details><summary>各组样本与可靠性（${models.length} 个模型）</summary><p class="panel-note">主权重：${esc(methodName())}。体验为多选，组间有人群重叠；不同指标集合的权重不能直接拼接。均分采用各模型完整样本。</p><div class="driver-table-scroll"><table><thead><tr><th>平台 / 体验</th><th>有效 / 组内 N</th><th>因素</th><th>验证 R²</th><th>权重区间最大宽度</th><th>判定</th></tr></thead><tbody>${models.map(m => `<tr><td><button class="driver-text-button" data-lmg-model="${esc(m.id)}">${esc(m.label)}</button></td><td>${m.n} / ${m.total}</td><td>${m.k}</td><td>${num(m.cv?.mean)}</td><td>${m.bootstrap.maxWidth == null ? '未确认' : `${(m.bootstrap.maxWidth * 100).toFixed(1)} 个百分点`}</td><td>${esc(m.status)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function fillGroups() {
    const models = state.models.filter(m => m.platform === el('driverLmgPlatform').value);
    el('driverLmgGroup').innerHTML = models.map(m => `<option value="${esc(m.id)}">${esc(m.experience)} · N=${m.n}</option>`).join('');
    if (models.some(m => m.id === state.active)) el('driverLmgGroup').value = state.active;
  }
  function adapter(m) {
    return { ...m, sourceName: state.source, dvName: `${m.exploratory ? '探索性结果 · ' : ''}${m.label} · ${m.y} · ${m.method} · N=${m.n}`, warnings: m.reasons, results: m.results.map(r => ({ ...r, importance: r.weight, name: `${L.INDICATORS.find(f => f.id === r.id)?.name || r.name} · ${r.sign} · B=${num(r.rawB)} · β=${num(r.beta)}${r.direction === '方向未明确' ? '（方向未明确）' : ''}` })) };
  }
  const interval = (lo, hi, format = num) => lo == null || hi == null ? '区间未确认' : `[${format(lo)}, ${format(hi)}]`;
  function renderCurrent() {
    const original = state.models.find(m => m.id === state.active); if (!original) return;
    el('driverViewAllIndicators').disabled = state.active === 'all-secondary';
    const m = viewModel(original), title = r => L.INDICATORS.find(f => f.id === r.id)?.name || r.name;
    const bars = m.hasWeights ? `<div class="driver-lmg-bars">${m.results.map(r => `<div class="driver-result-bar"><span>${esc(title(r))}</span><div class="driver-bar-track"><div class="driver-bar-fill" style="width:${r.weight * 100}%"></div></div><span>${pct(r.weight)}</span></div>`).join('')}</div>` : '';
    const filters = m.filters.map(f => `${f.field} ∈ ${f.values.join('/')}`).join('，') || '当前导入样本';
    el('driverResults').innerHTML = `<article class="audit-issue driver-lmg-result" data-formal-weights="${m.formalWeights}" data-weight-method="${m.weightMethod}" data-has-weights="${m.hasWeights}"><div class="issue-head"><strong>${esc(m.label)}</strong><span class="issue-tag ${m.formalWeights ? 'low' : 'high'}">${esc(m.status)}</span></div>
      <p class="panel-note">分析目标 Y：${esc(root.DriverCore.fieldTitle(state.dataset.fields.find(f => f.id === m.y)))}</p>
      <p>${esc(state.source)} · 组内 ${m.total} 人 · 有效样本 N=${m.n} · 缺失排除 ${m.excluded} 人 · ${m.k} 个二级因素</p><p class="panel-note">${esc(filters)}。${esc(m.note)}</p>
      <p><strong>主权重：${esc(m.method)}</strong> · 同一批完整样本计算另一方法作为对照。</p>
      ${m.reasons.length ? `<div class="driver-check-warning" role="status"><strong>${m.hasWeights ? '探索性结果：保留估计值，请结合以下限制解读' : '无法估计：不生成零权重或平均权重'}</strong><ul>${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : `<p class="driver-lmg-success">可靠性筛查通过。权重仅在本组所选因素内合计 100%，不代表因果贡献。${m.rankStable ? '' : '首位不稳定，不能认定唯一第一。'}</p>`}
      <div class="driver-lmg-metrics"><span>训练 R² ${num(m.r2)}</span><span>交叉验证 R² ${num(m.cv?.mean)}</span><span>最大 VIF ${num(m.maxVif, 2)}</span><span>自助抽样 ${m.bootstrap.valid}/${m.bootstrap.requested}</span></div>${bars}
      <div class="driver-table-scroll"><table class="driver-lmg-coefficients"><thead><tr><th>二级指标 / 字段</th><th>${state.method === 'lmg' ? 'LMG 主权重' : '|β| / Σ|β| 权重'}</th><th>主权重 95% 区间</th><th>非标准化 B</th><th>标准化 β</th><th>正负方向 / 稳定性</th><th>${state.method === 'lmg' ? 'β 绝对值权重对照' : 'LMG 对照权重'}</th><th>建模样本均分<br>N=${m.n}</th><th>首位概率</th></tr></thead><tbody>${m.results.map(r => `<tr><td>${esc(title(r))}<small>${esc(r.id)}</small></td><td data-lmg-weight>${pct(r.weight)}</td><td>${interval(r.weightLow, r.weightHigh, pct)}</td><td data-driver-b>${num(r.rawB)}<small>${interval(r.rawBLow, r.rawBHigh)}</small></td><td data-driver-beta>${num(r.beta)}<small>${interval(r.betaLow, r.betaHigh)}</small></td><td>${esc(r.sign)}<small>${esc(r.direction)}</small></td><td data-driver-comparison>${pct(r.comparisonWeight)}</td><td>${num(r.mean, 2)}</td><td>${pct(r.firstRate)}</td></tr>`).join('')}</tbody></table></div>
      <p class="panel-note">B 表示其他因素不变时，该项增加 1 分对应的目标 Y 预测变化；β 为标准化系数。默认权重为 |β|/Σ|β|，只对权重取绝对值，B、β 的负号始终保留。LMG 分配模型解释力，与系数型权重含义不同，不能将两者混称为解释力贡献率。</p><p class="panel-note">区间均为 95% 自助区间；方向未明确表示区间跨 0 或无法可靠估计区间。首位概率反映重复抽样中该项权重最高的比例。探索性权重不能直接作为正式考核加分项。均分与权重使用相同建模样本，跳题未补 0。</p></article>`;
    publishDriverLmgResult(adapter(m), state.running);
  }
  function exportExcel() {
    if (state.running || !state.models.length) return;
    const rows = [['关键驱动分组权重与诊断'], ['数据来源', state.source], ['算法版本', L.VERSION], ['主权重方法', methodName()], ['计算口径', '默认 |β|/Σ|β|；非标准化B、标准化β保留原符号；LMG在同一完整样本上计算对照。权重数值为0–1，组内合计1；跳题不补0'], ['探索性结果', '样本偏少或筛查未通过时保留可估计的参考权重，并列出限制；无法估计时权重及系数留空。区间不足时不报告区间'], ['稳定性', '500次自助抽样95%百分位区间；10次重复5折交叉验证；经验筛查不代表外部有效性保证'], ['组间比较', '体验组重叠，指标集合可能不同，权重不得跨组拼接'], [], ['平台', '实际体验 / 模型', '分组条件', '组内 N', '有效 N', '缺失排除', '因素数', '判定', '限制原因', '训练 R²', '验证 R²', '最大 VIF', '二级指标', '字段', '主权重方法', '主权重', '主权重区间下限', '主权重区间上限', '非标准化 B', 'B 区间下限', 'B 区间上限', '标准化 β', 'β 区间下限', 'β 区间上限', '系数正负', '方向可靠性', 'β绝对值权重', 'β权重区间下限', 'β权重区间上限', 'LMG 权重', 'LMG区间下限', 'LMG区间上限', 'LMG判定', 'LMG限制原因', '建模样本均分', '首位概率', '有效自助次数', '截距 B0']];
    for (const original of state.models) {
      const m = viewModel(original);
      for (const r of m.results) {
        const raw = original.results.find(v => v.id === r.id);
        rows.push([m.platform, m.experience, JSON.stringify(m.filters), m.total, m.n, m.excluded, m.k, m.status, m.reasons.join('；'), m.r2, m.cv?.mean ?? '', m.maxVif, L.INDICATORS.find(f => f.id === r.id)?.name || r.name, r.id, m.method, r.weight ?? '', r.weightLow ?? '', r.weightHigh ?? '', r.rawB ?? '', r.rawBLow ?? '', r.rawBHigh ?? '', r.beta ?? '', r.betaLow ?? '', r.betaHigh ?? '', r.sign, r.direction, raw.weight ?? '', raw.weightLow ?? '', raw.weightHigh ?? '', raw.lmgWeight ?? '', raw.lmgWeightLow ?? '', raw.lmgWeightHigh ?? '', !original.hasWeights ? '无法估计' : original.lmgFormalWeights ? '筛查通过' : '探索性结果', original.lmgReasons.join('；'), r.mean ?? '', r.firstRate ?? '', m.bootstrap.valid, m.intercept ?? '']);
      }
    }
    downloadExcelFromRows('关键驱动分组权重与诊断.xlsx', rows);
  }
  el('driverUseNpsPlan').addEventListener('click', () => usePlan());
  el('driverDialogUseNpsPlan').addEventListener('click', () => usePlan());
  el('driverLmgScope').addEventListener('change', () => { if (el('driverLmgScope').value === 'questionnaire') usePlan(); else { state.scope = 'single'; invalidateDriverAnalysis(); root.DriverAnalysisUI.refresh(); } });
  el('driverWeightMethod').addEventListener('change', () => { state.method = el('driverWeightMethod').value; refresh(); renderOverview(); renderCurrent(); if (state.models.length) saveResults(); });
  el('driverLmgCancel').addEventListener('click', () => { invalidateDriverAnalysis('计算已取消，未生成本次权重。'); root.DriverAnalysisUI.refresh(); });
  el('driverLmgPlatform').addEventListener('change', () => { fillGroups(); state.active = el('driverLmgGroup').value; renderCurrent(); });
  el('driverLmgGroup').addEventListener('change', () => { state.active = el('driverLmgGroup').value; renderCurrent(); });
  el('driverViewAllIndicators').addEventListener('click', () => { state.active = 'all-secondary'; el('driverLmgPlatform').value = '全部样本'; fillGroups(); renderCurrent(); });
  el('driverLmgSummary').addEventListener('click', event => { const b = event.target.closest('[data-lmg-model]'); if (!b) return; const m = state.models.find(m => m.id === b.dataset.lmgModel); state.active = m.id; el('driverLmgPlatform').value = m.platform; fillGroups(); renderCurrent(); });
  document.addEventListener('driverdatachange', () => {
    state.scope = 'single'; state.method = 'beta-abs';
    const s = selection();
    if (L.matchQuestionnaire(root.DriverAnalysisUI.getDataset()) && (!s.y || compatiblePlan()) && root.DriverAnalysisUI.isStandard()) usePlan(false);
    refresh();
  });
  document.addEventListener('driverdialogchange', refresh);
  root.DriverLMGUI = { run, cancel, refresh, isGrouped, exportExcel, usePlan, isRunning: () => state.running };
  refresh();
})(window);
