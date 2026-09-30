(function initQuestionnaireDelivery(root) {
  'use strict';
  const quality = typeof module !== 'undefined' && module.exports ? require('./questionnaire-quality.js') : root.QuestionnaireQuality;
  const plain = line => line.replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, '').replace(/\*\*/g, '').trim();
  const questionHeading = line => /^[A-Za-z]+\d+[A-Za-z]?(?:[_-]\d+)?[.．、:：\s]+/.test(plain(line));
  const section = line => /^\s*#{1,6}\s+/.test(line) || /^(?:[一二三四五六七八九十]+[、.．]|模块[A-Z一二三四五六七八九十])/.test(plain(line)) || /^\s*\*\*[^*]+\*\*[:：（(]?/.test(line);
  const internalTitle = /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:编程(?:通用)?(?:规则|约定|说明)|设计思路|设计依据|设计说明|问卷设计思路|研究设计说明|思考过程|分析过程|甄别逻辑说明|样本条件表|资格分流表|需求[—\-与及、].*(?:映射|核对)|需求覆盖核对|系统规则检查|质量自查|质量检查|待复核|待确认(?:事项|清单)|原始研究需求|研究需求原文|内部(?:检查|规则|说明)|注意力(?:检测|测试|检查))/;
  function isAttention(q) {
    if (!/注意力(?:检测|测试|检查|题)/.test(q.title) && /请(?:选择|选)(?:您|你|所有|符合|最常|最重要)/.test(q.title)) return false;
    return /注意力(?:检测|测试|检查|题)|(?:本题|此题|这道题).{0,16}请(?:选|选择)|为(?:确保|保证).{0,15}(?:认真|质量).{0,12}请(?:选|选择)/.test(q.title) || /^QC\d/.test(q.id) && /正确答案|本题请选|本题请选择|注意力/.test(q.lines.join('\n'));
  }
  function prepare(input) {
    let text = quality.stripReport(input).replace(/\r\n/g, '\n');
    const lines = text.split('\n'), questions = quality.parseQuestions(text);
    const removed = new Set();
    const spans = [];
    questions.forEach((q, index) => {
      if (!isAttention(q)) return;
      removed.add(q.id);
      const start = q.line - 1;
      let end = index + 1 < questions.length ? questions[index + 1].line - 1 : lines.length;
      for (let i = start + 1; i < end; i++) {
        if (section(lines[i]) && !/^(?:题型|选项|备注|说明|正确答案|逻辑|作答)/.test(plain(lines[i])) || /^\s*```/.test(lines[i])) { end = i; break; }
      }
      spans.push([start, end]);
    });
    for (const [start,end] of spans.reverse()) lines.splice(start,end-start);
    text = lines.filter(line => !/^\s*(?:[-*>]\s*)?(?:质量控件|质量控制|注意力检测建议)[:：].*注意力/.test(line)).join('\n');
    if (removed.size) text = text.replace(/```questionnaire-rules\s*\n([\s\S]*?)```/g, (block,json) => {
      try {
        const value = JSON.parse(json);
        if (!Array.isArray(value.rules)) return block;
        value.rules = value.rules.flatMap(rule => {
          if (rule?.kind !== 'quality' || !Array.isArray(rule.questionIds)) return [rule];
          const questionIds = rule.questionIds.filter(id => !removed.has(String(id).toUpperCase()));
          return questionIds.length ? [{...rule,questionIds}] : [];
        });
        return '```questionnaire-rules\n'+JSON.stringify(value,null,2)+'\n```';
      } catch { return block; }
    });
    return text.trim();
  }
  function clientText(input) {
    const text = prepare(input).replace(/```questionnaire-rules[^\n]*\n[\s\S]*?(?:```|$)/g, '');
    const output = [];
    let skipLevel = null, skipParagraph = false;
    for (const line of text.split('\n')) {
      const title = plain(line);
      const isQuestion = questionHeading(line);
      const heading = section(line) && !isQuestion;
      const level = line.match(/^\s*(#{1,6})\s/)?.[1].length || 3;
      // An explicit questionnaire body always ends an internal appendix block.
      const bodyHeading = /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:问卷正文|模块[A-Z一二三四五六七八九十]|开场白|结束语)/.test(title);
      if (skipLevel !== null) {
        if (isQuestion || bodyHeading || heading && level <= skipLevel) skipLevel = null;
        else continue;
      }
      if (internalTitle.test(title) && (heading || /[:：（(]/.test(title) || title.length < 55)) { skipLevel = level; continue; }
      if (/^(?:设计思路|设计依据|研究用途|内部备注)[:：]/.test(title)) { skipParagraph = true; continue; }
      if (skipParagraph) {
        if (!title || heading || isQuestion || /^\s*\|/.test(line)) skipParagraph = false;
        else continue;
      }
      if (/^(?:[-*>]\s*)?(?:本地备用骨架|本地备用稿|质量控件|大模型调用失败|大模型设置未通过|模型自评)[:：]/.test(title)) continue;
      if (/^\s*<!--\s*questionnaire-/.test(line)) continue;
      output.push(line.replace(/(问卷说明)与编程约定/g, '$1'));
    }
    return output.join('\n').replace(/\n(?:\s*---\s*\n){2,}/g, '\n---\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const api = { prepare, clientText, isAttention };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuestionnaireDelivery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
