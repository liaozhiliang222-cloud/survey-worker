export class ToolInputError extends Error {
  constructor(message, code = "INVALID_INPUT", details = null) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
    this.details = details;
  }
}

export function requireFiniteNumber(value, field, { minimum = -Infinity, maximum = Infinity, exclusiveMinimum = false } = {}) {
  const number = Number(value);
  const belowMinimum = exclusiveMinimum ? number <= minimum : number < minimum;
  if (!Number.isFinite(number) || belowMinimum || number > maximum) {
    throw new ToolInputError(`${field}输入无效。`, "INVALID_INPUT", { field });
  }
  return number;
}
