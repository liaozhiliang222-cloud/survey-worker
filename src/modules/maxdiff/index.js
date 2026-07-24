/**
 * MaxDiff 最大差异缩放模块 — 题组设计 + 得分分析
 */

// ─── 题组设计 ───────────────────────────────────────────────

/**
 * 解析项目列表（每行一个项目）
 */
export function parseLineItems(text) {
  return text
    .split(/[\r\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 生成 MaxDiff 题组设计（均衡不完全区组设计）
 * @param {string[]} items - 待测试项目列表
 * @param {number} setCount - 题组数量
 * @param {number} itemsPerSet - 每组展示项目数
 * @returns {{ items: string[], sets: Array<{set: number, items: string[]}>, counts: Map }}
 */
export function generateMaxDiffDesign(items, setCount, itemsPerSet) {
  const uniqueItems = [...new Set(items)];
  if (uniqueItems.length < itemsPerSet) {
    throw new Error("项目数量不足：待测试项目数需要不少于每题展示项目数。");
  }

  const counts = new Map(uniqueItems.map((item) => [item, 0]));
  const sets = [];

  for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
    const ordered = [...uniqueItems].sort((a, b) => {
      const countDiff = counts.get(a) - counts.get(b);
      if (countDiff !== 0) return countDiff;
      return ((uniqueItems.indexOf(a) + setIndex * 2) % uniqueItems.length) -
             ((uniqueItems.indexOf(b) + setIndex * 2) % uniqueItems.length);
    });
    const selected = [];
    let cursor = setIndex % uniqueItems.length;
    while (selected.length < itemsPerSet) {
      const candidate = ordered[cursor % ordered.length];
      if (!selected.includes(candidate)) selected.push(candidate);
      cursor += 1;
    }
    selected.forEach((item) => counts.set(item, counts.get(item) + 1));
    sets.push({ set: setIndex + 1, items: selected });
  }

  return { items: uniqueItems, sets, counts };
}

// ─── 得分分析 ───────────────────────────────────────────────

/**
 * 解析 MaxDiff 得分数据
 * @param {string} text - 每行：项目名, 被选最好次数, 被选最差次数, 展示次数
 * @returns {Array<{item: string, best: number, worst: number, shown: number, score: number}>}
 */
export function parseMaxDiffScores(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，]+/).map((value) => value.trim()))
    .filter((row) => row.length >= 4)
    .map((row) => {
      const best = Number(row[1]);
      const worst = Number(row[2]);
      const shown = Number(row[3]);
      if (!row[0] || !Number.isFinite(best) || !Number.isFinite(worst) || !Number.isFinite(shown) || shown <= 0) return null;
      return {
        item: row[0],
        best,
        worst,
        shown,
        score: (best - worst) / shown
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

/**
 * 计算 MaxDiff 偏好份额（Share of Preference）
 * @param {Array} scores - parseMaxDiffScores 的返回值
 * @returns {Array<{item: string, score: number, share: number, rank: number}>}
 */
export function computePreferenceShare(scores) {
  if (!scores.length) return [];
  const minScore = Math.min(...scores.map((s) => s.score));
  const shifted = scores.map((s) => ({ ...s, shifted: s.score - minScore + 0.001 }));
  const total = shifted.reduce((sum, s) => sum + s.shifted, 0);
  return shifted
    .map((s, index) => ({
      item: s.item,
      score: s.score,
      best: s.best,
      worst: s.worst,
      shown: s.shown,
      share: s.shifted / total,
      rank: index + 1
    }))
    .sort((a, b) => b.share - a.share)
    .map((s, index) => ({ ...s, rank: index + 1 }));
}

// ─── 导出辅助 ───────────────────────────────────────────────

export function maxDiffDesignToExportRows(design) {
  const rows = [["任务", "位置", "项目"]];
  design.sets.forEach((set) => {
    set.items.forEach((item, index) => rows.push([String(set.set), String(index + 1), item]));
  });
  rows.push([], ["项目展示次数"], ["项目", "展示次数"]);
  design.items.forEach((item) => rows.push([item, String(design.counts.get(item))]));
  return rows;
}

export function maxDiffScoresToExportRows(scores) {
  const header = ["排名", "项目", "得分", "偏好份额", "被选最好", "被选最差", "展示次数"];
  const dataRows = scores.map((s) => [
    String(s.rank),
    s.item,
    s.score.toFixed(4),
    `${(s.share * 100).toFixed(1)}%`,
    String(s.best),
    String(s.worst),
    String(s.shown)
  ]);
  return [header, ...dataRows];
}
