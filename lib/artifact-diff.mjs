function lines(value, maximumLines = 400, maximumChars = 40_000) {
  return String(value ?? "").slice(0, maximumChars).replace(/\r/g, "").split("\n").slice(0, maximumLines);
}

export function compareArtifacts(base, target) {
  const before = lines(base?.content);
  const after = lines(target?.content);
  const matrix = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) matrix[left][right] = before[left] === after[right] ? matrix[left + 1][right + 1] + 1 : Math.max(matrix[left + 1][right], matrix[left][right + 1]);
  }
  const changes = [];
  let left = 0; let right = 0; let added = 0; let removed = 0; let unchanged = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) { changes.push({ type: "unchanged", text: before[left] }); left += 1; right += 1; unchanged += 1; }
    else if (right < after.length && (left >= before.length || matrix[left][right + 1] >= matrix[left + 1][right])) { changes.push({ type: "added", text: after[right] }); right += 1; added += 1; }
    else { changes.push({ type: "removed", text: before[left] }); left += 1; removed += 1; }
  }
  return {
    base: { id: base?.id, title: base?.title, version: base?.version },
    target: { id: target?.id, title: target?.title, version: target?.version },
    summary: { added, removed, unchanged, truncated: String(base?.content ?? "").length > 40_000 || String(target?.content ?? "").length > 40_000 },
    changes,
  };
}

