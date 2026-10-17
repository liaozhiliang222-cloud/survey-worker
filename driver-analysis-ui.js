(function (root) {
  'use strict';
  const C = root.DriverCore, el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { dataset: null, tables: [], fileName: '', sheet: 0, selection: { y: '', xs: [] }, draft: { y: '', xs: [] }, mode: 'standard', step: 1, sequence: 0, busy: false, target: null, standardDraft: null, crosstabValid: true, picker: null };
  const dialog = el('driverVariableDialog');
  const pickerDialog = el('driverFieldDialog');
  function status(message, error = false) { el('driverImportStatus').textContent = message; el('driverImportStatus').classList.toggle('driver-error', error); }
  function persist() {
    if (state.dataset) projectDataBus.set('driverInput', { dataset: state.dataset, selection: state.selection, missing: el('driverMissingCodes').value });
  }
  function invalidate(message = '数据或分析设置已变更，请重新分析。') {
    invalidateDriverAnalysis(message);
  }
  function prepare(selection = state.selection) {
    try { return C.prepare(state.dataset, selection, C.missingCodes(el('driverMissingCodes').value)); }
    catch (error) { return { errors: [error.message], warnings: [], n: 0, excluded: 0, total: state.dataset?.rows.length || 0 }; }
  }
  function checksMarkup(checks) {
    const summary = checks.data ? `<p>导入 ${checks.total} 个样本 · 所选变量完整样本 <strong>${checks.n}</strong> 个 · 缺失排除 ${checks.excluded} 个</p>` : '';
    return summary + checks.errors.map(s => `<p class="driver-error">${esc(s)}</p>`).join('') + checks.warnings.map(s => `<p class="driver-warning">${esc(s)}</p>`).join('');
  }
  function renderSummary() {
    const d = state.dataset, sel = state.selection;
    el('driverSourceSummary').textContent = d ? `${d.fileName || '项目已有数据'} · ${d.name} · ${d.rows.length} 个样本 / ${d.headers.length} 个字段` : '尚未导入数据。先上传文件，也可以载入示例体验操作。';
    el('driverPreview').disabled = !d || state.busy;
    el('driverChooseVariables').disabled = !d || state.busy;
    el('driverChooseVariables').textContent = sel.y ? '修改分析变量' : '选择分析变量';
    el('driverSelectionSummary').innerHTML = sel.y && d ? `<p><strong>分析目标 Y：</strong>${esc(C.fieldTitle(d.fields.find(f => f.id === sel.y)))}</p><p><strong>影响因素 X（${sel.xs.length} 项）：</strong>${sel.xs.map(id => esc(C.fieldTitle(d.fields.find(f => f.id === id)))).join('、') || '尚未选择'}</p>` : '选择一个想解释的结果（Y），再选择可能影响它的因素（X）。';
    const checks = prepare();
    const grouped = root.DriverLMGUI?.isGrouped();
    el('driverPreflight').innerHTML = grouped ? '<p>按各组适用的二级指标分别检查有效样本，不要求同一位受访者经历全部服务；跳题不补 0。</p>' : d && sel.y ? checksMarkup(checks) : '';
    el('runDriverAnalysis').disabled = state.busy || !d || (!grouped && checks.errors.length > 0);
    el('driverUpload').disabled = state.busy;
    el('driverUseProject').disabled = state.busy;
    el('loadDriverExample').disabled = state.busy;
    el('driverDetectPaste').disabled = state.busy;
  }
  function setDataset(tableIndex, save = true) {
    const table = state.tables[tableIndex]; if (!table) throw Error('文件中没有可读取的样本明细。');
    const parsed = table.text !== undefined ? C.parseDelimited(table.text) : table;
    const dataset = C.normalizeTable(parsed, state.fileName);
    state.dataset = dataset; state.sheet = tableIndex;
    state.selection = { y: '', xs: [] }; state.draft = { y: '', xs: [] };
    el('driverMissingCodes').value = '';
    invalidate('数据已更新，请选择分析目标和影响因素。');
    if (save) persist();
    renderSummary();
    document.dispatchEvent(new CustomEvent('driverdatachange'));
  }
  function loadWorkbook(tables, fileName, open = true) {
    const previous = { tables: state.tables, fileName: state.fileName };
    state.tables = tables; state.fileName = fileName;
    try {
      const preferred = tables.findIndex(s => /^data$|^数据$|^样本/i.test(s.name));
      setDataset(preferred >= 0 ? preferred : 0);
    } catch (error) { state.tables = previous.tables; state.fileName = previous.fileName; throw error; }
    status('数据读取完成。先检查样本，再选择分析变量。');
    if (open) openDialog(1);
  }
  function loadText(text, name = '粘贴数据') {
    try { ++state.sequence; loadWorkbook([{ ...C.parseDelimited(text), name: 'Data' }], name); }
    catch (error) { status(error.message, true); }
  }
  async function importFile(file) {
    if (!file) return;
    const sequence = ++state.sequence;
    state.busy = true; invalidate('正在读取新数据，完成后请重新确认变量。'); status(`正在读取 ${file.name}…`); renderSummary();
    try {
      const parser = await import('./src/shared/driver-import.mjs');
      const tables = await parser.readDriverFile(file, xlsxToWorkbookSheets);
      if (sequence !== state.sequence) return;
      state.busy = false;
      loadWorkbook(tables, file.name);
    } catch (error) { if (sequence === state.sequence) status(error.message || '数据导入失败，请检查文件。', true); }
    finally { if (sequence === state.sequence) { state.busy = false; renderSummary(); } }
  }
  function projectTable() {
    const current = state.crosstabValid ? getWorkingCrosstabData() : { rows: [] };
    if (current.rows?.length) {
      const headers = current.rawHeaders || current.headers, rows = current.rawRows || current.rows;
      const infos = lastCrosstabDataContext?.headerInfos || [];
      const variables = headers.map(id => {
        const info = infos.find(f => f.sourceHeader === id);
        return { name: id, label: info?.variableLabel || '', type: info?.type, missing: info?.missing, valueLabels: Object.entries(info?.options || {}).map(([value, label]) => ({ value, label })) };
      });
      return { name: '项目当前样本', headers, rows, variables };
    }
    const saved = projectDataBus.get('cleanedData') || projectDataBus.get('rawData');
    if (saved?.rows?.length && saved.headers?.length) return { ...saved, name: '项目已有样本' };
    return null;
  }
  function useProject(open = true) {
    try {
      const table = projectTable();
      if (!table) throw Error('项目尚无样本数据，请在本页上传 SAV、Excel 或 CSV。');
      ++state.sequence; loadWorkbook([table], '项目已有数据', open); return true;
    } catch (error) { status(error.message, true); return false; }
  }
  function renderPreview() {
    const d = state.dataset;
    el('driverSheetSelect').innerHTML = state.tables.map((t, i) => `<option value="${i}" ${state.sheet === i ? 'selected' : ''}>${esc(t.name || `工作表 ${i + 1}`)}</option>`).join('');
    el('driverSheetSelect').disabled = state.tables.length < 2;
    el('driverDialogDataSummary').textContent = `${d.rows.length} 个样本、${d.fields.length} 个字段，其中 ${d.fields.filter(f => f.eligible).length} 个字段可用于评分回归。`;
    const fields = d.fields.slice(0, 8);
    el('driverDataPreview').innerHTML = `<table><thead><tr>${fields.map(f => `<th>${esc(C.fieldTitle(f))}</th>`).join('')}</tr></thead><tbody>${d.rows.slice(0, 8).map(r => `<tr>${fields.map(f => `<td>${esc(r[f.id] ?? '缺失')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    el('driverDataNotices').textContent = [...d.notices, '若此表是汇总交叉表，请改为导入每行一位受访者的样本明细。'].join(' ');
  }
  function missingDescription(spec) {
    if (['discrete', 'strings'].includes(spec.kind)) return (spec.values || []).join('、');
    if (['range', 'range+discrete'].includes(spec.kind)) return `${spec.lo} 至 ${spec.hi}${spec.kind === 'range+discrete' ? `，以及 ${spec.value}` : ''}`;
    return '未声明额外缺失码';
  }
  function selectionChip(id, removeAttribute) {
    const field = state.dataset.fields.find(f => f.id === id);
    return `<span class="driver-selection-chip"><span>${esc(C.fieldTitle(field))}</span><button type="button" ${removeAttribute}="${esc(id)}" aria-label="移除 ${esc(C.fieldTitle(field))}">×</button></span>`;
  }
  function renderRoleSummary() {
    const d = state.dataset, s = state.draft;
    const targets = C.candidateFields(d, 'y', s), factors = C.candidateFields(d, 'x', s);
    el('driverCandidateSummary').textContent = `已识别 ${d.fields.length} 个字段，推荐 ${targets.recommended.length} 个目标候选、${factors.recommended.length} 个因素候选。${d.fields.filter(f => !f.eligible).length} 个不适用字段已收起。`;
    el('driverChosenY').innerHTML = s.y ? `<strong>${esc(C.fieldTitle(d.fields.find(f => f.id === s.y)))}</strong>` : '<span class="driver-muted">尚未选择分析目标</span>';
    el('driverChosenXs').innerHTML = s.xs.length ? s.xs.map(id => selectionChip(id, 'data-driver-remove')).join('') : '<span class="driver-muted">尚未添加影响因素</span>';
    el('driverPickY').textContent = s.y ? '修改分析目标' : '选择分析目标';
    el('driverPickX').textContent = s.xs.length ? `修改影响因素（${s.xs.length}）` : '添加影响因素';
    renderDialogChecks();
    document.dispatchEvent(new CustomEvent('driverdialogchange'));
  }
  function pickerCandidates() { return C.candidateFields(state.dataset, state.picker.role, state.picker); }
  function visiblePickerFields() {
    const query = el('driverFieldSearch').value.trim().toLowerCase(), group = el('driverPickerGroup').value;
    return pickerCandidates()[state.picker.tab].filter(f => (!group || C.variableGroup(f) === group) && (!query || `${f.id} ${f.label} ${f.valueLabels.map(v => v.label).join(' ')}`.toLowerCase().includes(query)));
  }
  function renderPickerList() {
    if (!state.picker) return;
    const p = state.picker, candidates = pickerCandidates(), fields = visiblePickerFields(), recommended = new Map(candidates.recommended.map(f => [f.id, f.recommendationReason]));
    const names = { recommended: '推荐候选', available: '全部可用', excluded: '不适用字段' };
    el('driverPickerTabs').querySelectorAll('[data-picker-tab]').forEach(button => {
      const tab = button.dataset.pickerTab; button.textContent = `${names[tab]}（${candidates[tab].length}）`; button.setAttribute('aria-pressed', String(p.tab === tab));
    });
    el('driverPickerListCount').textContent = `${fields.length} 个匹配字段`;
    el('driverSelectVisible').hidden = p.role !== 'x' || p.tab === 'excluded';
    el('driverSelectVisible').disabled = fields.length === 0;
    el('driverFieldRows').innerHTML = fields.map(f => {
      const title = C.fieldTitle(f), disabled = !f.eligible || (p.role === 'x' && f.id === p.y);
      const reason = f.id === p.y && p.role === 'x' ? '当前分析目标，不能同时作为影响因素' : f.reason;
      const note = recommended.get(f.id) || (f.missingCount / state.dataset.rows.length > .5 ? '有效回答不足一半，请核对适用样本' : f.unique === 2 && f.min === 0 && f.max === 1 ? '0/1 编码字段，请核对业务用途' : '');
      const checked = p.role === 'y' ? p.y === f.id : p.xs.includes(f.id);
      return `<article class="driver-field-option ${checked ? 'driver-field-selected' : ''} ${disabled ? 'driver-option-disabled' : ''}"><label><input type="${p.role === 'y' ? 'radio' : 'checkbox'}" ${p.role === 'y' ? 'name="driverTargetY"' : ''} data-driver-${p.role}="${esc(f.id)}" aria-label="${esc(title)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="driver-option-content"><span class="driver-option-title">${esc(f.label || f.id)}</span><span class="driver-option-id">${esc(f.id)} · ${f.type === 'numeric' ? `数值 ${f.min}–${f.max}` : f.type === 'date' ? '日期' : '文本'} · 缺失 ${(100 * f.missingCount / state.dataset.rows.length).toFixed(1)}%</span><span class="driver-option-reason">${esc([reason || note, !disabled && f.measureNotice].filter(Boolean).join('；'))}</span></span></label><details class="driver-field-details"><summary>查看样例与值标签</summary><p>有效 ${f.valid} / 缺失 ${f.missingCount}；${f.unique} 种有效值。</p><p>样例：${f.examples.map(v => esc(v)).join('、') || '无'}</p>${f.valueLabels.length ? `<p>${f.valueLabels.map(v => esc(`${v.value}＝${v.label}`)).join('<br>')}</p>` : ''}${f.missing.kind !== 'none' ? `<p>声明的缺失值：${esc(missingDescription(f.missing))}</p>` : ''}</details></article>`;
    }).join('') || `<div class="driver-picker-empty">${p.tab === 'recommended' && !el('driverFieldSearch').value && !el('driverPickerGroup').value ? '暂未找到明确的推荐候选，可以切换“全部可用”自行选择。' : '没有匹配字段，请调整搜索或题组。'}</div>`;
    el('driverFieldRows').scrollTop = 0;
    renderPickerSelection();
  }
  function renderPickerSelection() {
    const p = state.picker; if (!p) return;
    const selected = p.role === 'y' ? p.y ? [p.y] : [] : p.xs;
    el('driverPickerSelectedTitle').textContent = p.role === 'y' ? '当前目标' : `已选因素（${selected.length}）`;
    el('driverPickerSelected').innerHTML = selected.length ? selected.map(id => selectionChip(id, 'data-picker-remove')).join('') : '<p class="driver-muted">点击候选添加，已选变量会保留在这里。</p>';
    el('driverPickerSelectionCount').textContent = p.role === 'y' ? `已选 ${selected.length} 个分析目标` : `已选 ${selected.length} 个影响因素`;
    el('driverClearXs').hidden = p.role !== 'x' || !selected.length;
    el('driverPickerApply').disabled = !selected.length || selected.length > 100;
    el('driverPickerApply').textContent = p.role === 'y' ? '使用此目标' : `确认 ${selected.length} 个因素`;
    el('driverPickerNotice').textContent = selected.length > 100 ? '单次最多选择 100 个因素，请减少已选变量。' : '';
    el('driverFieldRows').querySelectorAll('input').forEach(input => {
      const id = input.dataset.driverY || input.dataset.driverX;
      input.checked = selected.includes(id); input.closest('.driver-field-option').classList.toggle('driver-field-selected', input.checked);
    });
  }
  function openPicker(role) {
    if (!state.dataset || !dialog.open) return;
    state.picker = { role, tab: 'recommended', y: state.draft.y, xs: [...state.draft.xs] };
    el('driverPickerRole').textContent = role === 'y' ? '分析目标 Y · 单选' : '影响因素 X · 多选';
    el('driverPickerTitle').textContent = role === 'y' ? '你想解释哪个结果？' : '添加影响因素';
    el('driverPickerHint').textContent = role === 'y' ? '优先展示总体评价、推荐意愿等题目；根据题意确认一个目标，也可以在“全部可用”中查找。' : pickerCandidates().factorLevel === 'dimension' ? 'NPS 分析优先推荐模块总体评分，请对照问卷确认二级指标。跳题较多的模块仍保留，并提示有效回答比例；三级细项可在“全部可用”中查找。质控、联系方式和编号已排除。' : '优先展示体验或量表评分、有效回答不少于一半的字段。编号、文本、无变化字段已收起；其他可用变量可以手动添加。';
    el('driverFieldSearch').value = '';
    const groups = new Map(); pickerCandidates().available.forEach(f => { const group = C.variableGroup(f); if (group) groups.set(group, (groups.get(group) || 0) + 1); });
    el('driverPickerGroup').innerHTML = '<option value="">全部题组</option>' + [...groups].filter(([, count]) => count > 1).map(([group, count]) => `<option value="${esc(group)}">${esc(group)}（${count} 项）</option>`).join('');
    el('driverPickerGroupLabel').hidden = role !== 'x' || groups.size === 0;
    renderPickerList(); pickerDialog.showModal(); el('driverFieldSearch').focus();
  }
  function applyPicker() {
    const p = state.picker; if (!p || el('driverPickerApply').disabled) return;
    if (p.role === 'y') { state.draft.y = p.y; state.draft.xs = state.draft.xs.filter(id => id !== p.y); }
    else state.draft.xs = [...p.xs];
    invalidate('变量选择已修改，请确认后重新分析。');
    pickerDialog.close(); state.picker = null; renderRoleSummary();
  }
  function renderDialogChecks() {
    const checks = prepare(state.draft);
    el('driverDialogSelectionSummary').textContent = `已选目标 ${state.draft.y ? 1 : 0} 个 / 因素 ${state.draft.xs.length} 个${checks.data ? ` · 可用样本 ${checks.n}` : ''}`;
    el('driverDialogChecks').innerHTML = state.step === 2 && (state.draft.y || state.draft.xs.length) ? checksMarkup(checks) : '';
    el('driverDialogSave').disabled = checks.errors.length > 0;
    el('driverDialogRun').disabled = checks.errors.length > 0;
  }
  function setStep(step) {
    state.step = step;
    el('driverDataStep').hidden = step !== 1; el('driverVariableStep').hidden = step !== 2;
    el('driverDialogBack').hidden = step !== 2; el('driverDialogNext').hidden = step !== 1;
    el('driverDialogSave').hidden = step !== 2; el('driverDialogRun').hidden = step !== 2 || Boolean(state.target) || state.mode === 'hierarchical';
    el('driverDialogStep').textContent = `步骤 ${step} / 2`;
    el('driverDialogTitle').textContent = step === 1 ? '检查导入数据' : state.target ? '选择本维度的总体题和下属题' : '选择分析目标和影响因素';
    if (step === 1) renderPreview(); else renderRoleSummary();
    renderDialogChecks();
  }
  function openDialog(step = 2, target = null) {
    if (state.busy || !state.dataset) return;
    state.target = target;
    if (target) { state.standardDraft = state.draft; state.draft = { y: target.y || '', xs: [...(target.xs || [])] }; }
    setStep(step);
    if (!dialog.open) dialog.showModal();
  }
  function saveSelection(run) {
    const checks = prepare(state.draft); if (checks.errors.length) return;
    const selection = { y: state.draft.y, xs: [...state.draft.xs] };
    invalidate();
    if (state.target) { state.target.onSave(selection); state.draft = state.standardDraft; }
    else {
      state.selection = selection; persist();
      if (state.mode === 'hierarchical') root.IndicatorWeightUI?.setModelVariables(selection);
    }
    state.target = null; state.standardDraft = null; dialog.close(); renderSummary();
    if (run) renderDriverAnalysis();
  }
  function setMode(mode) {
    state.mode = mode;
    for (const name of ['standard', 'hierarchical']) {
      const standard = name === 'standard', active = mode === name;
      el(standard ? 'driverStandardPanel' : 'driverHierarchicalPanel').hidden = !active;
      const tab = el(standard ? 'driverStandardTab' : 'driverHierarchicalTab');
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    if (mode === 'hierarchical') root.IndicatorWeightUI?.refreshModels();
  }
  function reset() {
    ++state.sequence; state.busy = false; state.dataset = null; state.tables = []; state.fileName = ''; state.crosstabValid = false;
    state.selection = { y: '', xs: [] }; state.draft = { y: '', xs: [] }; state.target = null; state.picker = null;
    pickerDialog.close(); dialog.close(); el('driverData').value = ''; el('driverMissingCodes').value = '';
    status(''); invalidate('上传数据并选择变量后，即可开始分析。'); setMode('standard'); renderSummary();
    document.dispatchEvent(new CustomEvent('driverdatachange'));
  }
  el('driverUpload').addEventListener('click', () => { el('driverFileInput').value = ''; el('driverFileInput').click(); });
  el('driverFileInput').addEventListener('change', event => importFile(event.target.files[0]));
  el('driverUseProject').addEventListener('click', () => useProject());
  el('crosstabData').addEventListener('input', () => { state.crosstabValid = true; });
  el('driverDetectPaste').addEventListener('click', () => loadText(el('driverData').value));
  el('driverData').addEventListener('input', () => invalidate('粘贴内容已修改，请点击“识别粘贴数据”重新导入。'));
  el('driverChooseVariables').addEventListener('click', () => openDialog(2));
  el('driverPreview').addEventListener('click', () => openDialog(1));
  el('driverDialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { pickerDialog.close(); state.picker = null; if (state.target) { state.draft = state.standardDraft; state.target = null; state.standardDraft = null; } });
  el('driverDialogNext').addEventListener('click', () => setStep(2));
  el('driverDialogBack').addEventListener('click', () => setStep(1));
  el('driverDialogSave').addEventListener('click', () => saveSelection(false));
  el('driverDialogRun').addEventListener('click', () => saveSelection(true));
  el('driverSheetSelect').addEventListener('change', event => { try { setDataset(Number(event.target.value)); renderPreview(); renderDialogChecks(); } catch (error) { status(error.message, true); event.target.value = state.sheet; } });
  el('driverPickY').addEventListener('click', () => openPicker('y'));
  el('driverPickX').addEventListener('click', () => openPicker('x'));
  el('driverPickerClose').addEventListener('click', () => pickerDialog.close());
  pickerDialog.addEventListener('close', () => { state.picker = null; });
  el('driverPickerApply').addEventListener('click', applyPicker);
  el('driverFieldSearch').addEventListener('input', renderPickerList);
  el('driverPickerGroup').addEventListener('change', renderPickerList);
  el('driverPickerTabs').addEventListener('click', event => { const tab = event.target.closest('[data-picker-tab]'); if (tab) { state.picker.tab = tab.dataset.pickerTab; renderPickerList(); } });
  el('driverFieldRows').addEventListener('change', event => {
    const t = event.target, p = state.picker; if (!p) return;
    if (t.dataset.driverY) p.y = t.dataset.driverY;
    else if (t.dataset.driverX) p.xs = t.checked ? [...new Set([...p.xs, t.dataset.driverX])] : p.xs.filter(id => id !== t.dataset.driverX);
    else return;
    renderPickerSelection();
  });
  el('driverSelectVisible').addEventListener('click', () => { state.picker.xs = [...new Set([...state.picker.xs, ...visiblePickerFields().filter(f => f.eligible && f.id !== state.picker.y).map(f => f.id)])]; renderPickerSelection(); });
  el('driverClearXs').addEventListener('click', () => { state.picker.xs = []; renderPickerSelection(); });
  el('driverPickerSelected').addEventListener('click', event => {
    const remove = event.target.closest('[data-picker-remove]'); if (!remove || !state.picker) return;
    if (state.picker.role === 'y') state.picker.y = ''; else state.picker.xs = state.picker.xs.filter(id => id !== remove.dataset.pickerRemove);
    renderPickerSelection();
  });
  el('driverChosenXs').addEventListener('click', event => { const remove = event.target.closest('[data-driver-remove]'); if (remove) { state.draft.xs = state.draft.xs.filter(id => id !== remove.dataset.driverRemove); invalidate('变量选择已修改，请确认后重新分析。'); renderRoleSummary(); } });
  el('driverMissingCodes').addEventListener('input', () => { invalidate(); renderSummary(); persist(); });
  document.querySelectorAll('[data-driver-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.driverMode)));
  document.querySelector('.driver-mode-tabs').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setMode(state.mode === 'standard' ? 'hierarchical' : 'standard'); el(state.mode === 'standard' ? 'driverStandardTab' : 'driverHierarchicalTab').focus(); } });
  document.addEventListener('click', event => { if (event.target.closest('#indicatorWeightPanel [data-jump="driver-analysis"]')) setMode('hierarchical'); });
  el('driverDropZone').addEventListener('dragover', event => { event.preventDefault(); el('driverDropZone').classList.add('driver-dragging'); });
  el('driverDropZone').addEventListener('dragleave', () => el('driverDropZone').classList.remove('driver-dragging'));
  el('driverDropZone').addEventListener('drop', event => { event.preventDefault(); el('driverDropZone').classList.remove('driver-dragging'); importFile(event.dataTransfer.files[0]); });
  projectDataBus.onChange(key => {
    if (key === '__project__') reset();
    if (key === 'driverInput' && !state.dataset) {
      const saved = projectDataBus.get(key); if (!saved?.dataset) return;
      state.dataset = C.normalizeTable(saved.dataset, saved.dataset.fileName); state.tables = [state.dataset]; state.fileName = saved.dataset.fileName;
      state.selection = saved.selection || { y: '', xs: [] }; state.draft = { y: state.selection.y, xs: [...state.selection.xs] };
      el('driverMissingCodes').value = saved.missing || ''; renderSummary(); document.dispatchEvent(new CustomEvent('driverdatachange'));
    }
  });
  root.DriverAnalysisUI = { prepare, loadText, loadWorkbook, importFile, reset, getDataset: () => state.dataset,
    getSelection: () => ({ y: state.selection.y, xs: [...state.selection.xs] }), refresh: renderSummary, isStandard: () => state.mode === 'standard' && !state.target,
    setSelection(s) { invalidate(); state.selection = { y: s.y, xs: [...s.xs] }; state.draft = { y: s.y, xs: [...s.xs] }; persist(); renderSummary(); },
    hasProjectSamples: () => state.crosstabValid, markProjectSamples() { state.crosstabValid = true; },
    openVariables(target) { if (!state.dataset && !useProject(false)) return; openDialog(2, target); } };
  renderSummary();
})(window);
