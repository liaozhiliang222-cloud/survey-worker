// @ts-check

/** Numeric survey values: missing answers are not zero, while a real 0 is valid.
 * @param {unknown} value
 * @returns {number | null}
 */
export function finiteDataNumber(value) {
  if (value == null || (typeof value !== "string" && typeof value !== "number")) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
