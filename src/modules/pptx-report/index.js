/**
 * PPTX 报告模块
 * 封装 PPT 生成、图表数据提取、Markdown→PPT 转换
 * 注：ppt-report-ai.js 和 proposal-deck.js 仍以独立脚本加载，
 *     本模块提供 ES Module 接口 + 从 app.js 提取的核心工具函数
 */
import { state } from "../../shared/store.js";

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

/* ─── 图表数据提取 ─── */
export function cleanChartLabel(label) {
  return String(label || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^(CAPTION|PART)\s*[:：]?\s*/i, "")
    .replace(/^[-*\d.\s]+/, "")
    .replace(/^(选项|指标|维度|发现|其中|最高|最低|合计|总计|BASE|样本)\s*[:：=]?\s*/i, "")
    .replace(/[|]/g, " ")
    .trim()
    .slice(0, 28);
}

export function shouldSkipChartLabel(label) {
  return !label || /^(合计|总计|总体|Total|BASE|样本|N)$/i.test(label) || /最高=|最低=/i.test(label);
}

export function parseChartPercentValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /^[-—]+$/.test(raw)) return null;
  const hasPercent = raw.includes("%");
  const num = Number(raw.replace(/,/g, "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(num)) return null;
  const percent = !hasPercent && Math.abs(num) <= 1 ? num * 100 : num;
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 99.5) return null;
  return percent;
}

export function findTotalColumnIndex(headers = []) {
  const exactIndex = headers.findIndex((h) => /^(Total|总体|总计|合计)$/i.test(String(h || "").trim()));
  if (exactIndex >= 0) return exactIndex;
  const fuzzyIndex = headers.findIndex((h) => /Total|总体|总计|合计/i.test(String(h || "")));
  return fuzzyIndex >= 0 ? fuzzyIndex : 0;
}

export function extractReportChartItems(markdown, maxItems = 8) {
  const items = [];
  const seen = new Set();
  String(markdown || "").split(/\r?\n/).forEach((rawLine) => {
    if (items.length >= maxItems) return;
    const line = rawLine.replace(/\*\*/g, "").replace(/[|]/g, " ").trim();
    const match = line.match(/(.{2,36}?)(?:：|:|\s)(-?\d+(?:\.\d+)?)\s*%/);
    if (!match) return;
    const label = match[1].replace(/^[-*\d.\s]+/, "").replace(/^(选项|指标|维度|发现|其中)\s*/, "").slice(-18).trim();
    const value = Number(match[2]);
    if (!label || Number.isNaN(value)) return;
    const key = `${label}_${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ label, value: Math.max(0, Math.min(100, value)) });
  });
  return items;
}

export function normalizePptChartItems(items, maxItems = 8) {
  const seen = new Set();
  return (items || [])
    .map((item) => ({ label: cleanChartLabel(item?.label || item?.name || ""), value: Number(item?.value) }))
    .filter((item) => {
      if (!item.label || shouldSkipChartLabel(item.label)) return false;
      if (!Number.isFinite(item.value) || item.value <= 0 || item.value >= 99.5) return false;
      const key = `${item.label}_${item.value.toFixed(1)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems)
    .map((item) => ({ label: item.label.slice(0, 20), value: Number(item.value.toFixed(1)) }));
}

export function normalizePptChartGroups(groups, maxGroups = 10, maxItemsPerGroup = 8) {
  const seenTitles = new Set();
  return (groups || [])
    .map((group, index) => {
      const items = normalizePptChartItems(group?.items, maxItemsPerGroup);
      const rawTitle = cleanChartLabel(group?.title || `关键指标图表 ${index + 1}`) || `关键指标图表 ${index + 1}`;
      const title = rawTitle.endsWith("图表") ? rawTitle : `${rawTitle.slice(0, 18)}图表`;
      return { title, items };
    })
    .filter((group) => {
      if (group.items.length < 2) return false;
      if (seenTitles.has(group.title)) return false;
      seenTitles.add(group.title);
      return true;
    })
    .slice(0, maxGroups);
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
