/**
 * PPTX 报告模块
 * 封装 PPT 生成、图表数据提取、Markdown→PPT 转换
 * 注：ppt-report-ai.js 和 proposal-deck.js 仍以独立脚本加载，
 *     本模块提供 ES Module 接口 + 从 app.js 提取的核心工具函数
 */


/* ─── XML 工具 ─── */
export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ─── Markdown → PPT Slides ─── */
export function markdownToPptSlides(markdown, fallbackTitle = "调研方案") {
  const lines = markdown.split(/\r?\n/);
  const slides = [];
  let current = null;
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h1) {
      if (!slides.length) slides.push({ title: h1[1], bullets: ["研究方案", "由 AI 方案设计生成"] });
      return;
    }
    if (h2) {
      current = { title: h2[1], bullets: [] };
      slides.push(current);
      return;
    }
    if (!current) {
      current = { title: fallbackTitle, bullets: [] };
      slides.push(current);
    }
    if (h3) { current.bullets.push(h3[1]); return; }
    if (/^\|/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const text = line.replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, " / ")
        .replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/---/g, "").trim();
      if (text && !/^\/+$/.test(text)) current.bullets.push(text);
      return;
    }
    if (line.length > 0) current.bullets.push(line);
  });
  // 分页：每页最多7条
  const expanded = [];
  slides.forEach((slide) => {
    const bullets = slide.bullets.filter(Boolean);
    if (bullets.length <= 7) { expanded.push({ title: slide.title, bullets }); return; }
    for (let i = 0; i < bullets.length; i += 7) {
      expanded.push({ title: i === 0 ? slide.title : `${slide.title}（续）`, bullets: bullets.slice(i, i + 7) });
    }
  });
  return expanded.slice(0, 40);
}

/* ─── 全局脚本桥接 ─── */
export function getProposalDeck() {
  return window.ProposalDeck || null;
}

export function getPptReportAi() {
  return window.PptReportAi || null;
}

/* ─── 下载辅助 ─── */
export function sanitizeDownloadName(name, fallback = "导出文件") {
  const safe = String(name || fallback).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  return safe || fallback;
}
