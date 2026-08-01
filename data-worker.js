/**
 * 数据清洗/加权 Web Worker
 * 当数据集 > 5000 行时，将计算移到后台线程避免 UI 卡顿。
 */
self.onmessage = function (e) {
  const { type, payload, requestId } = e.data;

  if (type === "clean") {
    const { rows, rules } = payload;
    const result = applyCleaningRules(rows, rules);
    self.postMessage({ type: "clean_done", requestId, result });
  } else if (type === "weight") {
    const { rows, targets } = payload;
    const result = computeRimWeights(rows, targets);
    self.postMessage({ type: "weight_done", requestId, result });
  }
};

function applyCleaningRules(rows, rules) {
  // 简化版清洗：按规则过滤行
  let cleaned = [...rows];
  const removed = [];
  for (const rule of rules) {
    if (rule.type === "remove_empty" && rule.column != null) {
      const before = cleaned.length;
      cleaned = cleaned.filter((row) => {
        const val = String(row[rule.column] ?? "").trim();
        return val !== "";
      });
      removed.push({ rule: rule.label || "remove_empty", count: before - cleaned.length });
    } else if (rule.type === "remove_value" && rule.column != null) {
      const before = cleaned.length;
      cleaned = cleaned.filter((row) => String(row[rule.column] ?? "").trim() !== rule.value);
      removed.push({ rule: rule.label || "remove_value", count: before - cleaned.length });
    } else if (rule.type === "min_duration" && rule.column != null) {
      const before = cleaned.length;
      cleaned = cleaned.filter((row) => Number(row[rule.column]) >= (rule.min || 0));
      removed.push({ rule: rule.label || "min_duration", count: before - cleaned.length });
    }
  }
  return { cleaned, removed, total: rows.length, kept: cleaned.length };
}

function computeRimWeights(rows, targets) {
  // 简化版 RIM 加权迭代
  const maxIter = 20;
  const tol = 0.001;
  const n = rows.length;
  const weights = new Float64Array(n).fill(1);

  for (let iter = 0; iter < maxIter; iter++) {
    let maxDiff = 0;
    for (const target of targets) {
      const { column, categories } = target;
      for (const cat of categories) {
        const { value, targetPct } = cat;
        const indices = [];
        for (let i = 0; i < n; i++) {
          if (String(rows[i][column] ?? "").trim() === value) indices.push(i);
        }
        if (!indices.length) continue;
        const currentWeighted = indices.reduce((s, i) => s + weights[i], 0);
        const targetWeighted = (targetPct / 100) * n;
        if (currentWeighted <= 0) continue;
        const factor = targetWeighted / currentWeighted;
        for (const i of indices) weights[i] *= factor;
        maxDiff = Math.max(maxDiff, Math.abs(factor - 1));
      }
    }
    if (maxDiff < tol) break;
  }

  const result = rows.map((row, i) => ({ ...row, _weight: weights[i] }));
  return { weights: Array.from(weights), rows: result };
}
