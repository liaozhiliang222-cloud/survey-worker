(function initQuestionnaireWorkflow(root) {
  'use strict';
  const quality = typeof module !== 'undefined' && module.exports ? require('./questionnaire-quality.js') : root.QuestionnaireQuality;
  const clone = value => JSON.parse(JSON.stringify(value));

  function blocks(input) {
    const text = quality.stripReport(input).replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const questions = quality.parseQuestions(text);
    const seen = new Set();
    return questions.map((q, index) => {
      if (seen.has(q.id)) throw new Error(`题号 ${q.id} 重复，不能安全定位局部修订。`);
      seen.add(q.id);
      const start = q.line - 1;
      let end = index + 1 < questions.length ? questions[index + 1].line - 1 : lines.length;
      for (let i = start + 1; i < end; i++) {
        if (/^\s*(?:#{1,6}\s|```|(?:[一二三四五六七八九十]+[、.．]\s*)?(?:原始研究需求|研究需求原文|质量自查|质量检查|编程规则|模块[A-Z一二三四五六七八九十]))/.test(lines[i])) { end = i; break; }
      }
      while (end > start && !lines[end - 1].trim()) end--;
      return { ...q, start, end, text: lines.slice(start, end).join('\n') };
    });
  }

  function targets(input, selection) {
    const all = blocks(input);
    const tokens = String(selection || '').toUpperCase().split(/[\s,，、;；]+/).filter(Boolean);
    if (!tokens.length) throw new Error('请输入题号或模块前缀，例如 D2、F1A 或 D*。');
    const selected = new Set();
    for (const token of tokens) {
      const found = /^[A-Z]+\*$/.test(token) ? all.filter(q => q.id.match(/^[A-Z]+/)[0] === token.slice(0, -1)) : all.filter(q => q.id === token);
      if (!found.length) throw new Error(`未找到 ${token}，请使用现有题号；模块使用 D* 这样的前缀。`);
      found.forEach(q => selected.add(q.id));
    }
    return all.filter(q => selected.has(q.id));
  }

  function applyPatch(input, selection, response) {
    const selected = targets(input, selection);
    const raw = String(response).trim();
    const fenced = raw.match(/^```(?:json|questionnaire-patch)\s*\n([\s\S]*?)\n```$/);
    let patch;
    try { patch = JSON.parse(fenced ? fenced[1] : raw); } catch { throw new Error('局部修订返回格式无效，当前版本未变更。'); }
    if (!patch || patch.version !== 1 || !Array.isArray(patch.replacements) || Object.keys(patch).some(k => !['version', 'replacements'].includes(k))) throw new Error('局部修订结构无效，当前版本未变更。');
    const byId = new Map();
    for (const entry of patch.replacements) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string' || Object.keys(entry).some(k => !['id','text'].includes(k))) throw new Error('局部修订条目无效。');
      const id = entry.id.toUpperCase();
      if (byId.has(id) || !selected.some(q => q.id === id)) throw new Error(`返回了重复或范围外的题号 ${id}，未应用修改。`);
      const text = entry.text.trim().replace(/\r\n/g, '\n');
      const parsed = blocks(text);
      if (parsed.length !== 1 || parsed[0].id !== id || parsed[0].text !== text || /```|<!--|questionnaire-rules/.test(text)) throw new Error(`${id} 必须是单道完整题目，不得夹带模块、规则或其他正文。`);
      const controlLines = value => value.split('\n').filter(line => /显示条件|跳至|跳到|跳过|终止|入组|资格|配额|不显示|参与.{0,12}显示/.test(line)).map(line => line.trim()).sort().join('\n');
      if (controlLines(text) !== controlLines(selected.find(q => q.id === id).text)) throw new Error(`${id} 的路径或资格备注发生改变，请使用整卷修订。`);
      byId.set(id, text);
    }
    if (byId.size !== selected.length) throw new Error('返回题目不完整，当前版本未变更。');
    const lines = quality.stripReport(input).replace(/\r\n/g, '\n').split('\n');
    for (const q of [...selected].reverse()) lines.splice(q.start, q.end - q.start, byId.get(q.id));
    return lines.join('\n');
  }

  function patchPrompt(input, selection, instruction, config) {
    const selected = targets(input, selection);
    return [
      { role: 'system', content: '你是问卷研究设计师。仅修订指定题目，保持题号、显示条件、跳题目标、资格规则与适用人群不变。不得增加或删除题目；若要求需要改变路径或资格，请在当前题目的备注中标记待人工整体修订，不编造新规则。只输出严格JSON：{"version":1,"replacements":[{"id":"D2","text":"D2. 完整题目\\n题型及全部选项和备注"}]}。每道目标题恰好一次，不得夹带模块标题或编程规则。\n' + quality.designRules() + '\n局部修订输出格式以上述JSON为准，不输出整卷或questionnaire-rules。' },
      { role: 'user', content: `来源：\n${quality.sourceContext(config)}\n修改要求：${instruction}\n唯一允许替换的题号：${selected.map(q => q.id).join('、')}\n目标题：\n${selected.map(q => q.text).join('\n\n')}\n上下文仅供参考，不得输出：\n${quality.stripReport(input)}` }
    ];
  }

  function diff(before, after) {
    const left = blocks(before), right = blocks(after);
    const changes = [];
    for (const q of left) {
      const next = right.find(r => r.id === q.id);
      if (!next || next.text !== q.text) changes.push({ id: q.id, kind: next ? '修改' : '删除', before: q.text, after: next?.text || '' });
    }
    for (const q of right) if (!left.some(r => r.id === q.id)) changes.push({ id: q.id, kind: '新增', before: '', after: q.text });
    const residual = (input, items) => {
      const lines = quality.stripReport(input).replace(/\r\n/g, '\n').split('\n');
      for (const q of [...items].reverse()) lines.splice(q.start, q.end - q.start);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };
    if (residual(before, left) !== residual(after, right)) changes.push({ id: '说明与编程规则', kind: '修改', before: residual(before, left), after: residual(after, right) });
    if (left.map(q => q.id).join('|') !== right.map(q => q.id).join('|')) changes.push({ id: '题目顺序', kind: '顺序变化', before: left.map(q => q.id).join(' → '), after: right.map(q => q.id).join(' → ') });
    return changes;
  }

  function preview(input, config, routeId) {
    const audit = quality.audit(input, config);
    const questions = audit.questions;
    const route = audit.routes.find(r => r.id === routeId);
    if (audit.routes.length && !route) return { state: '待选择', questions: [], conditions: [], notes: ['请选择已记录的路径。'] };
    const indexOf = id => questions.findIndex(q => q.id === String(id).toUpperCase());
    const notes = ['这是结构预览，不执行答案级显示条件，也不认证受访者资格或配额。'];
    if (!route) return { state: '未验证的顺序预览', questions, conditions: [], notes: [...notes, '没有结构化分支记录；按正文顺序展示，不能推定为无分支。'] };
    const conditions = route.ruleIds.map(id => audit.rules.find(r => r.id === id)).filter(Boolean);
    const start = indexOf(route.entry), end = indexOf(route.exit), next = indexOf(route.next);
    const ranges = audit.routes.map(r => [indexOf(r.entry), indexOf(r.exit)]);
    const invalid = start < 0 || end < start || next <= end || next < 0 || ranges.some(([a,b]) => a < 0 || b < a) || ranges.some(([a,b], i) => ranges.some(([c,d], j) => i !== j && a <= d && c <= b)) || audit.issues.some(i => ['ROUTE_CROSSES_BRANCH','DUPLICATE_ID','DUPLICATE_ROUTE'].includes(i.code));
    if (invalid) return { state: '路径结构错误', questions: [], conditions, notes: [...notes, '存在题号缺失、回跳、分支交叠或跨分支返回，请先修正。'] };
    const firstBranch = Math.min(...ranges.map(([a]) => a));
    const selected = questions.filter((q,i) => i < firstBranch || i >= start && i <= end || i >= next && !ranges.some(([a,b]) => i >= a && i <= b));
    const verified = conditions.length === route.ruleIds.length && conditions.length > 0 && conditions.every(r => r.kind === 'eligibility' && r.status === 'confirmed' && r.sourceVerified);
    return { state: verified ? '资格含义待复核' : '资格依据待确认', questions: selected, conditions, route, notes };
  }

  function pilotSummary(records) {
    const groups = [];
    for (const route of new Set(records.map(r => r.route))) {
      const all = records.filter(r => r.route === route);
      const values = all.filter(r => r.outcome === 'completed').map(r => r.minutes).sort((a,b) => a-b);
      const quantile = p => { const n = (values.length - 1) * p, lo = Math.floor(n); return values.length ? values[lo] + (values[Math.ceil(n)] - values[lo]) * (n - lo) : null; };
      groups.push({ route, n: values.length, excluded: all.length - values.length, median: quantile(.5), p75: quantile(.75), preliminary: values.length < 5 });
    }
    return groups;
  }

  function createSession() {
    const versions = [], pilots = [];
    let nextPilotId = 1;
    return {
      record(text, config, label) {
        const version = { id: versions.length + 1, text, config: clone(config), label, createdAt: new Date().toISOString() };
        versions.push(version); return clone(version);
      },
      versions: () => clone(versions),
      current: () => versions.length ? clone(versions[versions.length - 1]) : null,
      get: id => clone(versions.find(v => v.id === Number(id)) || null),
      addPilot(input) {
        const version = versions.find(v => v.id === Number(input.version));
        if (!version) throw new Error('试访所属版本不存在。');
        const routes = quality.audit(version.text, version.config).routes;
        if (!(routes.length ? routes.some(r => r.id === input.route) : input.route === '全卷')) throw new Error('请选择该版本中的实际试访路径。');
        const minutes = Number(input.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('请输入大于0且不超过1440的实际分钟数。');
        if (!['completed','interrupted','terminated'].includes(input.outcome)) throw new Error('请选择试访完成状态。');
        const question = String(input.question || '').trim().toUpperCase();
        if (question && !quality.parseQuestions(version.text).some(q => q.id === question)) throw new Error('反馈题号不属于该版本。');
        const record = { id: nextPilotId++, version: version.id, route: input.route, minutes, outcome: input.outcome, question, feedback: String(input.feedback || '').trim().slice(0,4000), createdAt: new Date().toISOString() };
        pilots.push(record); return clone(record);
      },
      pilots: version => clone(pilots.filter(p => p.version === Number(version))),
      removePilot: id => { const index = pilots.findIndex(p => p.id === Number(id)); if (index >= 0) pilots.splice(index,1); },
      export: () => ({ format: 'questionnaire-workflow', version: 1, versions: clone(versions), pilots: clone(pilots) })
    };
  }
  const api = { blocks, targets, applyPatch, patchPrompt, diff, preview, pilotSummary, createSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuestionnaireWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
