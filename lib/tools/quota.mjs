import { ToolInputError, requireFiniteNumber } from "./errors.mjs";

export const QUOTA_TOOL_ID = "quota";

export function parseQuotaItems(value) {
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawName, rawShare] = item.split(/[:：]/);
      return { name: (rawName || "").trim(), share: Number(String(rawShare || "").replace("%", "").trim()) };
    })
    .filter((item) => item.name && Number.isFinite(item.share) && item.share > 0);
}

export function normalizeQuota(items) {
  const total = items.reduce((sum, item) => sum + item.share, 0);
  return total > 0 ? items.map((item) => ({ ...item, weight: item.share / total })) : [];
}

export function allocateIntegers(values, total) {
  const floors = values.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

function dimensionGroups(dimension, dimensionIndex) {
  const rawGroups = Array.isArray(dimension?.groups) ? dimension.groups : Array.isArray(dimension?.items) ? dimension.items : [];
  if (!String(dimension?.name || "").trim()) throw new ToolInputError(`第 ${dimensionIndex + 1} 个配额维度缺少名称。`, "INVALID_INPUT", { field: `dimensions.${dimensionIndex}.name` });
  if (!rawGroups.length) throw new ToolInputError(`“${dimension.name}”至少需要一个配额选项。`, "INVALID_INPUT", { field: `dimensions.${dimensionIndex}.groups` });
  if (rawGroups.length > 100) throw new ToolInputError(`“${dimension.name}”的配额选项过多。`, "INPUT_LIMIT_EXCEEDED");
  const groups = rawGroups.map((group, groupIndex) => {
    const name = String(group?.name ?? group?.label ?? "").trim();
    if (!name) throw new ToolInputError(`“${dimension.name}”第 ${groupIndex + 1} 个选项缺少名称。`, "INVALID_INPUT");
    const share = requireFiniteNumber(group?.share, `“${dimension.name} / ${name}”比例`, { minimum: 0, maximum: 1_000_000, exclusiveMinimum: true });
    return { name, share };
  });
  const shareTotal = groups.reduce((sum, group) => sum + group.share, 0);
  return { name: String(dimension.name).trim(), share_total: shareTotal, valid_share_total: Math.abs(shareTotal - 100) < 0.001, groups: normalizeQuota(groups) };
}

function normalizeDimensions(rawDimensions) {
  if (!Array.isArray(rawDimensions) || !rawDimensions.length) throw new ToolInputError("请至少添加一个有效配额维度。", "INVALID_INPUT", { field: "dimensions" });
  if (rawDimensions.length > 8) throw new ToolInputError("配额维度最多支持 8 个。", "INPUT_LIMIT_EXCEEDED");
  return rawDimensions.map(dimensionGroups);
}

function singleQuota(totalSample, dimensions) {
  return dimensions.map((dimension) => {
    const counts = allocateIntegers(dimension.groups.map((group) => group.weight * totalSample), totalSample);
    return {
      name: dimension.name,
      share_total: dimension.share_total,
      valid_share_total: dimension.valid_share_total,
      groups: dimension.groups.map((group, index) => ({ label: group.name, share: group.share, percent: group.weight, sample: counts[index] })),
    };
  });
}

function crossQuota(totalSample, dimensions) {
  if (dimensions.length < 2) throw new ToolInputError("交叉配额至少需要两个有效维度。", "INVALID_INPUT", { field: "dimensions" });
  const combinationCount = dimensions.reduce((count, dimension) => count * dimension.groups.length, 1);
  if (combinationCount > 10_000) throw new ToolInputError("交叉配额组合超过 10,000 个，请减少维度或选项。", "INPUT_LIMIT_EXCEEDED");
  let combinations = [{ labels: {}, shares: [], weight: 1 }];
  for (const dimension of dimensions) {
    combinations = combinations.flatMap((combination) => dimension.groups.map((group) => ({
      labels: { ...combination.labels, [dimension.name]: group.name },
      shares: [...combination.shares, group.share],
      weight: combination.weight * group.weight,
    })));
  }
  const counts = allocateIntegers(combinations.map((combination) => combination.weight * totalSample), totalSample);
  const flat = combinations.map((combination, index) => ({ labels: combination.labels, shares: combination.shares, percent: combination.weight, sample: counts[index] }));
  let matrix = null;
  if (dimensions.length === 2) {
    const [rows, columns] = dimensions;
    const cells = rows.groups.map((_, rowIndex) => columns.groups.map((__, columnIndex) => counts[rowIndex * columns.groups.length + columnIndex]));
    matrix = {
      row_dimension: rows.name,
      column_dimension: columns.name,
      rows: rows.groups.map((group) => group.name),
      columns: columns.groups.map((group) => group.name),
      cells,
      row_totals: cells.map((row) => row.reduce((sum, value) => sum + value, 0)),
      column_totals: columns.groups.map((_, columnIndex) => cells.reduce((sum, row) => sum + row[columnIndex], 0)),
    };
  }
  return { combination_count: combinationCount, flat, matrix };
}

export function calculateQuota(input = {}) {
  const mode = String(input.mode || "single").trim().toLowerCase();
  if (!new Set(["single", "cross"]).has(mode)) throw new ToolInputError("配额类型必须是 single 或 cross。", "INVALID_INPUT", { field: "mode" });
  const totalSample = Math.round(requireFiniteNumber(input.total_sample ?? input.totalSample, "目标有效样本量", { minimum: 1, maximum: 10_000_000 }));
  const dimensions = normalizeDimensions(input.dimensions);
  const invalidDimensions = dimensions.filter((dimension) => !dimension.valid_share_total).map((dimension) => dimension.name);
  const result = {
    mode,
    total_sample: totalSample,
    invalid_dimensions: invalidDimensions,
    dimensions: mode === "single" ? singleQuota(totalSample, dimensions) : dimensions.map((dimension) => ({
      name: dimension.name,
      share_total: dimension.share_total,
      valid_share_total: dimension.valid_share_total,
      groups: dimension.groups.map((group) => ({ label: group.name, share: group.share, percent: group.weight })),
    })),
  };
  if (mode === "cross") Object.assign(result, crossQuota(totalSample, dimensions));
  return result;
}
