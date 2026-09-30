(function initQuestionnaireReviewUI(root) {
  'use strict';
  const workflow = root.QuestionnaireWorkflow;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const round = value => value === null ? '暂无' : `${Math.round(value * 10) / 10} 分钟`;
  function routeOptions(current, selected) {
    const routes = root.QuestionnaireQuality.audit(current.text, current.config).routes;
    return routes.length ? routes.map(r => `<option value="${escape(r.id)}" ${r.id===selected?'selected':''}>${escape(r.id)}：${escape(r.entry)} → ${escape(r.exit)} → ${escape(r.next)}</option>`).join('') : '<option value="全卷">全卷（无结构化分支记录）</option>';
  }
  function pathHtml(current, route) {
    const preview = workflow.preview(current.text, current.config, route);
    return `<p><strong>${escape(preview.state)}</strong></p>${preview.notes.map(n => `<p class="panel-note">${escape(n)}</p>`).join('')}
      <ul>${preview.conditions.map(r => `<li>${escape(r.id)}：${escape(r.condition)}；依据：${escape(r.source?.quote || '待确认')}</li>`).join('')}</ul>
      <ol class="workflow-path">${preview.questions.map(q => `<li><strong>${escape(q.id)}</strong> ${escape(q.title)}${q.lines.filter(line => /显示|跳至|跳过|适用|终止/.test(line)).map(line => `<small>${escape(line)}</small>`).join('')}</li>`).join('')}</ol>`;
  }
  function diffHtml(previous, current) {
    if (!previous) return '<p>当前只有一个版本；完成修订后可比较。</p>';
    try {
      const changes = workflow.diff(previous.text, current.text);
      return `<p>V${previous.id} → V${current.id}：${changes.length}项差异。题目顺序、说明和编程规则单独列出。</p>${changes.map(c => `<details><summary>${escape(c.id)} · ${escape(c.kind)}</summary><div class="workflow-diff"><div><strong>原版本</strong><pre>${escape(c.before || '无')}</pre></div><div><strong>当前版本</strong><pre>${escape(c.after || '无')}</pre></div></div></details>`).join('') || '<p>问卷内容相同，仍保留操作记录。</p>'}`;
    } catch (error) { return `<p role="alert">无法可靠比较：${escape(error.message)}</p>`; }
  }
  function pilotHtml(session, current) {
    const records = session.pilots(current.id), groups = workflow.pilotSummary(records);
    return `<p>仅统计当前 V${current.id} 的完整完成记录；中断、甄别终止不计入完成时长，各路径分别计算。总时长只用于本版本与同一路径，不能推算新版本或单题耗时。</p>
      ${groups.map(g => `<p><strong>${escape(g.route)}</strong>：完整完成 n=${g.n}；未计入 ${g.excluded}；中位数 ${round(g.median)}；P75 ${round(g.p75)}。${g.preliminary ? '样本少于5份，仅作初步参考。' : '实测描述统计，不代表总体保证时长。'}</p>`).join('') || '<p>尚无试访记录，暂不提供实测时长。</p>'}
      <ul class="ai-risk-list questionnaire-quality-list">${records.map(r => `<li><strong>#${r.id} · ${escape(r.route)} · ${r.minutes}分钟 · ${escape({completed:'完整完成',interrupted:'中断',terminated:'甄别终止'}[r.outcome])}</strong><span>${escape(r.question)} ${escape(r.feedback)}</span>${r.feedback ? `<button type="button" class="secondary-btn" data-workflow-action="feedback" data-record="${r.id}">带入修订要求</button>` : ''}<button type="button" class="secondary-btn" data-workflow-action="remove-pilot" data-record="${r.id}">删除误录</button></li>`).join('')}</ul>`;
  }
  function render(session) {
    const current = session.current();
    if (!current) return '';
    const versions = session.versions();
    const previous = versions[versions.length - 2];
    const firstRoute = session.view?.().route || root.QuestionnaireQuality.audit(current.text, current.config).routes[0]?.id;
    return `<article class="audit-issue questionnaire-workflow" data-workflow>
      <div class="issue-head"><strong>预览、版本与试访</strong><span class="issue-tag">V${current.id}</span></div>
      <p class="panel-note">当前项目已记录 ${versions.length} 个版本；保存状态见上方。可下载档案迁移到其他浏览器。恢复旧稿会创建新版本，原记录保留。</p>
      <p data-workflow-message role="status"></p>
      <details><summary>作答路径预览</summary><label>选择待核对路径<select data-workflow-route>${routeOptions(current,firstRoute)}</select></label><div class="workflow-content" data-workflow-path>${pathHtml(current,firstRoute)}</div></details>
      <details><summary>版本差异与恢复</summary><label>与当前 V${current.id} 比较<select data-workflow-compare>${versions.filter(v=>v.id!==current.id).map(v=>`<option value="${v.id}" ${v.id===previous?.id?'selected':''}>V${v.id} · ${escape(v.label)}</option>`).join('') || '<option value="">暂无旧版</option>'}</select></label><div class="workflow-content" data-workflow-diff>${diffHtml(previous,current)}</div><button type="button" class="secondary-btn" data-workflow-action="restore" ${previous?'':'disabled'}>将所选旧稿恢复为新版本</button></details>
      <details><summary>试访反馈与实测时长</summary><label>试访所属版本<select data-workflow-pilot-version>${versions.map(v=>`<option value="${v.id}" ${v.id===current.id?'selected':''}>V${v.id} · ${escape(v.label)}</option>`).join('')}</select></label><div data-workflow-pilot>${pilotHtml(session,current)}</div>
        <form data-workflow-pilot-form class="workflow-form">
          <label>实际路径<select name="route">${routeOptions(current)}</select></label>
          <label>实际总时长（分钟）<input name="minutes" type="number" min="0.01" max="1440" step="any" required></label>
          <label>完成状态<select name="outcome"><option value="completed">完整完成</option><option value="interrupted">中断</option><option value="terminated">甄别终止</option></select></label>
          <label>反馈题号（可选）<input name="question" placeholder="例如 D2"></label>
          <label class="workflow-wide">试访反馈（可选）<textarea name="feedback" maxlength="4000" placeholder="记录不理解的词、缺少的选项、跳转问题等，不填写受访者身份信息。"></textarea></label>
          <button type="submit" class="secondary-btn">保存到所选版本</button>
        </form>
      </details><button type="button" class="secondary-btn" data-workflow-action="export">下载版本与试访档案</button>
    </article>`;
  }
  function bind(container, callbacks) {
    const { session } = callbacks;
    const message = text => { const node = container.querySelector('[data-workflow-message]'); if (node) node.textContent = text; };
    container.addEventListener('change', event => {
      if (event.target.matches('[data-workflow-route]')) {session.setView?.({route:event.target.value});container.querySelector('[data-workflow-path]').innerHTML = pathHtml(session.current(), event.target.value);}
      if (event.target.matches('[data-workflow-compare]')) container.querySelector('[data-workflow-diff]').innerHTML = diffHtml(session.get(event.target.value),session.current());
    });
    container.addEventListener('change', event=>{
      if(!event.target.matches('[data-workflow-pilot-version]'))return;
      const version=session.get(event.target.value);if(!version)return;
      container.querySelector('[data-workflow-pilot]').innerHTML=pilotHtml(session,version);
      const form=container.querySelector('[data-workflow-pilot-form]');form.reset();form.querySelector('[name="route"]').innerHTML=routeOptions(version);
    });
    const pilotVersion=()=>session.get(container.querySelector('[data-workflow-pilot-version]')?.value) || session.current();
    container.addEventListener('submit', event => {
      if (!event.target.matches('[data-workflow-pilot-form]')) return;
      event.preventDefault();
      if (callbacks.busy()) return;
      try {
        session.addPilot({ ...Object.fromEntries(new FormData(event.target)), version: pilotVersion().id });
        container.querySelector('[data-workflow-pilot]').innerHTML = pilotHtml(session,pilotVersion());
        event.target.reset(); message(session.status?.().state==='failed'?'记录已加入所选版本，但保存失败，仅本次会话。':'已记录到所选版本。');
      } catch (error) { message(error.message); }
    });
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-workflow-action]');
      if (!button || callbacks.busy()) return;
      try {
        const action = button.dataset.workflowAction;
        if (action === 'restore') callbacks.restore(session.get(container.querySelector('[data-workflow-compare]').value));
        if (action === 'export') callbacks.download(session.export());
        if (action === 'remove-pilot') { session.removePilot(button.dataset.record); container.querySelector('[data-workflow-pilot]').innerHTML = pilotHtml(session,pilotVersion()); message('已删除误录。'); }
        if (action === 'feedback') {
          const record = session.pilots(pilotVersion().id).find(r=>r.id===Number(button.dataset.record));
          if(record?.version!==session.current().id){message('此反馈属于旧版本，请先恢复该版本为新稿并核对题号，再修订。');return;}
          callbacks.feedback(record); message('已带入修订要求，尚未改动问卷；请审阅后点击修改。');
        }
      } catch (error) { message(error.message); }
    });
  }
  root.QuestionnaireReviewUI = { render, bind };
})(globalThis);
