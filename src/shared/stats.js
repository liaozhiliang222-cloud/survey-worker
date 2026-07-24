/**
 * 统计计算工具函数
 * 从 app.js 提取的纯函数，无 DOM 依赖
 */

export function gammaLog(value) {
  const coefficients = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953
  ];
  let x = value;
  let y = value;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  coefficients.forEach((coefficient) => {
    y += 1;
    series += coefficient / y;
  });
  return Math.log(2.5066282746310005 * series / x) - tmp;
}

export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 100; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-8) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaLog(a));
  }

  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-8) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaLog(a)) * h;
}

export function chiSquarePValue(chiSquare, degreesOfFreedom) {
  if (!Number.isFinite(chiSquare) || degreesOfFreedom <= 0) return null;
  return Math.max(0, Math.min(1, 1 - gammaP(degreesOfFreedom / 2, chiSquare / 2)));
}

export function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function toNumberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function standardDeviation(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function modeValue(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function frequencyRows(values, totalBase = values.length, validBase = values.filter(Boolean).length) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  let cumulative = 0;
  return [...counts.entries()]
    .sort((a, b) => {
      const an = toNumberOrNull(a[0]);
      const bn = toNumberOrNull(b[0]);
      if (an !== null && bn !== null) return an - bn;
      return String(a[0]).localeCompare(String(b[0]), "zh-CN");
    })
    .map(([label, count]) => {
      cumulative += count;
      return {
        label,
        count,
        percent: totalBase ? count / totalBase : 0,
        validPercent: validBase ? count / validBase : 0,
        cumulativePercent: validBase ? cumulative / validBase : 0
      };
    });
}

export function completeScoreRows(rows, minScore, maxScore, validBase) {
  const byLabel = new Map(rows.map((row) => [String(row.label), row]));
  return Array.from({ length: maxScore - minScore + 1 }, (_, index) => {
    const score = String(minScore + index);
    return byLabel.get(score) || {
      label: score,
      count: 0,
      percent: 0,
      validPercent: 0,
      cumulativePercent: validBase ? 0 : 0
    };
  });
}

export function completeScaleRows(rows, values) {
  const numericValues = values.map(toNumberOrNull).filter((value) => value !== null);
  const min = Math.min(...numericValues, 1);
  const max = Math.max(...numericValues, 5);
  const start = min <= 0 ? 0 : 1;
  const end = [5, 7, 10].includes(max) ? max : Math.max(max, 5);
  return completeScoreRows(rows, start, end, numericValues.length);
}

export function histogram(values, buckets = 12) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(min), count: values.length }];
  const width = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    label: `${(min + i * width).toFixed(1)}–${(min + (i + 1) * width).toFixed(1)}`,
    count: 0
  }));
  values.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / width), buckets - 1);
    bins[idx].count += 1;
  });
  return bins;
}
