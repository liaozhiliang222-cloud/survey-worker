// datareader-spss 0.2.1, MIT. Vendored browser ESM; see datareader-spss-LICENSE.
// src/limits.ts
var SavError = class extends Error {
};
var DEFAULT_LIMITS = {
  maxCells: 5e7,
  maxInflatedBytes: 512 * 1024 * 1024
};

// src/missing.ts
function numberMatches(cell, spec) {
  switch (spec.kind) {
    case "discrete":
      return spec.values.includes(cell);
    case "range":
      return cell >= spec.lo && cell <= spec.hi;
    case "range+discrete":
      return cell >= spec.lo && cell <= spec.hi || cell === spec.value;
    default:
      return false;
  }
}
function isMissing(cell, spec) {
  if (typeof cell === "number") return numberMatches(cell, spec);
  if (typeof cell === "string") return spec.kind === "strings" && spec.values.includes(cell);
  return false;
}
function applyUserMissing(sheet) {
  const specs = sheet.variables.map((v) => v.missing);
  const rows = sheet.rows.map(
    (row) => row.map((cell, col) => {
      const spec = specs[col];
      return spec !== void 0 && isMissing(cell, spec) ? null : cell;
    })
  );
  return { ...sheet, rows };
}

// src/sav/binary.ts
var Cursor = class {
  view;
  pos = 0;
  little = true;
  constructor(buf) {
    this.view = new DataView(buf);
  }
  get length() {
    return this.view.byteLength;
  }
  /** Refuse a read/seek that would land outside the buffer BEFORE the DataView touches it — a hostile
   * length/offset field must surface as a catchable `SavError`, never a raw `RangeError` (the taxonomy
   * `limits.ts` promises and the adversarial suite asserts). Also bounds `new Uint8Array(n)`. */
  ensure(n) {
    if (n < 0 || this.pos + n > this.length) {
      throw new SavError(
        `read of ${n} bytes at offset ${this.pos} exceeds the ${this.length}-byte file`
      );
    }
  }
  seek(p) {
    if (p < 0 || p > this.length) throw new SavError(`seek to ${p} is outside the file`);
    this.pos = p;
  }
  skip(n) {
    this.pos += n;
  }
  readI32() {
    this.ensure(4);
    const v = this.view.getInt32(this.pos, this.little);
    this.pos += 4;
    return v;
  }
  readF64() {
    this.ensure(8);
    const v = this.view.getFloat64(this.pos, this.little);
    this.pos += 8;
    return v;
  }
  /** Byte-order-aware 64-bit signed int (file offsets/lengths fit in a JS number). */
  readI64() {
    this.ensure(8);
    const v = this.view.getBigInt64(this.pos, this.little);
    this.pos += 8;
    return Number(v);
  }
  readBytes(n) {
    this.ensure(n);
    const out = new Uint8Array(n);
    out.set(new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n));
    this.pos += n;
    return out;
  }
  readStr(n, dec) {
    return dec.decode(this.readBytes(n));
  }
};

// src/sav/dates.ts
var DATE_FORMAT_TYPES = /* @__PURE__ */ new Set([20, 22, 23, 24, 28, 29, 30, 38, 39]);
var SPSS_EPOCH_OFFSET_SECONDS = 12219379200;
function isDateFormat(type) {
  return DATE_FORMAT_TYPES.has(type);
}
function spssToDate(seconds) {
  return new Date((seconds - SPSS_EPOCH_OFFSET_SECONDS) * 1e3);
}

// src/sav/cases.ts
function decoderFor(enc) {
  try {
    return new TextDecoder(enc || "utf-8");
  } catch {
    throw new SavError(`unsupported character encoding "${enc}"`);
  }
}
function readSegment(alloc, source) {
  const chunks = Math.max(1, Math.ceil(alloc / 8));
  const raw = new Uint8Array(chunks * 8);
  for (let c = 0; c < chunks; c++) raw.set(source.nextString8(), c * 8);
  return raw.subarray(0, alloc);
}
function readStringValue(segments, source, dec) {
  const parts = [];
  for (const alloc of segments) parts.push(readSegment(alloc, source));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let ofs = 0;
  for (const p of parts) {
    all.set(p, ofs);
    ofs += p.length;
  }
  return dec.decode(all).replace(/ +$/, "");
}
function readNumericCell(variable, source) {
  const v = source.nextNumeric();
  if (v !== null && variable.format.isDate) return spssToDate(v);
  return v;
}
function readCell(plan, source, dec) {
  if (plan.segments.length > 0) return readStringValue(plan.segments, source, dec);
  return readNumericCell(plan.variable, source);
}
function readCases(input) {
  const { dictInfo, header, limits, plans, source } = input;
  const dec = decoderFor(dictInfo.encoding);
  const rows = [];
  if (header.ncases >= 0) {
    for (let i = 0; i < header.ncases; i++) {
      rows.push(plans.map((plan) => readCell(plan, source, dec)));
    }
    return rows;
  }
  while (!source.atEnd()) {
    rows.push(plans.map((plan) => readCell(plan, source, dec)));
    if (rows.length * plans.length > limits.maxCells) {
      throw new SavError("case count exceeds cell limit");
    }
  }
  return rows;
}

// src/sav/variable.ts
var VALID_NMISSING = /* @__PURE__ */ new Set([-3, -2, 0, 1, 2, 3]);
function decodeFormat(packed, isDate = () => false) {
  const decimals = packed & 255;
  const width = packed >> 8 & 255;
  const type = packed >> 16 & 255;
  return { decimals, isDate: isDate(type), type, width };
}
function decodeMissing(n, values) {
  if (n === 0) return { kind: "none" };
  if (n > 0) return { kind: "discrete", values };
  const [lo, hi, value] = values;
  if (lo === void 0 || hi === void 0) throw new SavError("missing-value range underflow");
  if (n === -2) return { hi, kind: "range", lo };
  if (value === void 0) throw new SavError("missing-value range+discrete underflow");
  return { hi, kind: "range+discrete", lo, value };
}
function readMissing(cur, spec, dec) {
  const { nMissing, type } = spec;
  const count = Math.abs(nMissing);
  if (type > 0) {
    const values = [];
    for (let i = 0; i < count; i++) values.push(cur.readStr(8, dec).replace(/ +$/, ""));
    return count > 0 ? { kind: "strings", values } : { kind: "none" };
  }
  const nums = [];
  for (let i = 0; i < count; i++) nums.push(cur.readF64());
  return decodeMissing(nMissing, nums);
}
function readVariableRecord(cur, dec) {
  const type = cur.readI32();
  if (type === -1) {
    cur.skip(24);
    return "continuation";
  }
  const hasLabel = cur.readI32();
  const nMissing = cur.readI32();
  if (!VALID_NMISSING.has(nMissing)) throw new SavError("invalid missing-value count");
  const print = decodeFormat(cur.readI32());
  const write = decodeFormat(cur.readI32());
  const name = cur.readStr(8, dec).replace(/[\s\0]+$/, "");
  let label;
  if (hasLabel) {
    const labelLen = cur.readI32();
    label = cur.readStr(labelLen, dec);
    cur.skip((4 - labelLen % 4) % 4);
  }
  const missing = readMissing(cur, { nMissing, type }, dec);
  return { label, missing, name, print, type, write };
}

// src/sav/dictionary.ts
var MAX_DICT_RECORDS = 1e7;
var MAX_DOC_LINES = 1e5;
var PROVISIONAL = new TextDecoder("utf-8");
function readValueLabelSet(cur) {
  const count = cur.readI32();
  const labels = [];
  for (let i = 0; i < count; i++) {
    const raw = cur.readBytes(8);
    const labelLen = cur.readBytes(1)[0];
    const labelRaw = cur.readBytes(labelLen);
    cur.skip((8 - (1 + labelLen) % 8) % 8);
    labels.push({ labelRaw, raw });
  }
  return { labels, varIndexes: [] };
}
function readExtension(cur) {
  const subtype = cur.readI32();
  const size = cur.readI32();
  const count = cur.readI32();
  return { bytes: cur.readBytes(size * count), count, size, subtype };
}
function handleVariable(cur, state) {
  const physIdx = state.physicalPos;
  state.physicalPos += 1;
  const v = readVariableRecord(cur, PROVISIONAL);
  if (v !== "continuation") {
    state.variables.push(v);
    state.physicalIndexes.push(physIdx);
  }
}
function handleValueLabels(cur, state) {
  state.pending = readValueLabelSet(cur);
  state.valueLabelSets.push(state.pending);
}
function handleVarIndexes(cur, state) {
  const count = cur.readI32();
  const idx = [];
  for (let i = 0; i < count; i++) idx.push(cur.readI32());
  if (state.pending) state.pending.varIndexes = idx;
}
function handleDocument(cur) {
  const nLines = cur.readI32();
  if (nLines < 0 || nLines > MAX_DOC_LINES) throw new SavError("invalid document record");
  cur.skip(nLines * 80);
}
function handleExtension(cur, state) {
  state.extensions.push(readExtension(cur));
}
var HANDLERS = {
  2: handleVariable,
  3: handleValueLabels,
  4: handleVarIndexes,
  6: handleDocument,
  7: handleExtension
};
function readDictionary(cur) {
  const state = {
    extensions: [],
    physicalIndexes: [],
    physicalPos: 1,
    valueLabelSets: [],
    variables: []
  };
  for (let records = 0; ; records++) {
    if (records > MAX_DICT_RECORDS) throw new SavError("too many dictionary records");
    const prev = cur.pos;
    const recType = cur.readI32();
    if (recType === 999) {
      cur.readI32();
      break;
    }
    const handler = HANDLERS[recType];
    if (!handler) throw new Error(`Unknown SPSS dictionary record type: ${recType}`);
    handler(cur, state);
    if (cur.pos <= prev) throw new SavError("dictionary made no progress");
  }
  return {
    extensions: state.extensions,
    physicalIndexes: state.physicalIndexes,
    valueLabelSets: state.valueLabelSets,
    variables: state.variables
  };
}

// src/sav/extensions.ts
var UTF8 = new TextDecoder("utf-8");
function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function eachPair(tokens, apply) {
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) apply(token.slice(0, eq), token.slice(eq + 1));
  }
}
function parseLongNames(bytes, out) {
  eachPair(UTF8.decode(bytes).split("	"), (key, value) => out.set(key, value));
}
function parseVeryLong(bytes, out) {
  const tokens = UTF8.decode(bytes).split("\0").flatMap((chunk) => chunk.split("	"));
  eachPair(tokens, (key, value) => out.set(key, Number(value)));
}
function measureName(code) {
  if (code === 1) return "nominal";
  if (code === 2) return "ordinal";
  if (code === 3) return "scale";
  return "unknown";
}
function parseMeasures(record, little) {
  const view = viewOf(record.bytes);
  const measures = [];
  const triples = Math.floor(record.count / 3);
  for (let t = 0; t < triples; t++) {
    if (t * 12 + 12 > record.bytes.length) break;
    measures.push(measureName(view.getInt32(t * 12, little)));
  }
  return measures;
}
function applyRecord(record, little, info) {
  switch (record.subtype) {
    case 20:
      info.encoding = UTF8.decode(record.bytes).trim();
      break;
    case 4:
      if (record.bytes.length < 8)
        throw new SavError("subtype-4 record too short for its sysmis f64");
      info.sysmis = viewOf(record.bytes).getFloat64(0, little);
      break;
    case 13:
      parseLongNames(record.bytes, info.longNames);
      break;
    case 14:
      parseVeryLong(record.bytes, info.veryLong);
      break;
    case 11:
      info.measures = parseMeasures(record, little);
      break;
  }
}
function applyExtensions(raw, little) {
  const info = {
    encoding: "utf-8",
    longNames: /* @__PURE__ */ new Map(),
    measures: [],
    sysmis: -Number.MAX_VALUE,
    veryLong: /* @__PURE__ */ new Map()
  };
  for (const record of raw.extensions) applyRecord(record, little, info);
  return info;
}

// src/sav/header.ts
var ASCII = new TextDecoder("windows-1252");
function asCompression(v) {
  if (v === 0 || v === 1 || v === 2) return v;
  throw new Error(`Unsupported SPSS compression flag: ${v}`);
}
function detectByteOrder(cur) {
  const layoutLE = cur.view.getInt32(64, true);
  if (layoutLE === 2 || layoutLE === 3) return true;
  const layoutBE = cur.view.getInt32(64, false);
  if (layoutBE === 2 || layoutBE === 3) return false;
  throw new SavError(`invalid SPSS layout code (${layoutLE}); a .sav must store 2 or 3`);
}
function readHeader(cur) {
  if (cur.length < 176) throw new SavError("file too small to be a .sav");
  const magic = cur.readStr(4, ASCII);
  if (magic !== "$FL2" && magic !== "$FL3") throw new Error("Not an SPSS system file (bad magic)");
  cur.little = detectByteOrder(cur);
  cur.seek(64);
  cur.readI32();
  cur.readI32();
  const compression = asCompression(cur.readI32());
  cur.readI32();
  const ncases = cur.readI32();
  const bias = cur.readF64();
  cur.skip(9 + 8);
  const fileLabel = cur.readStr(64, ASCII).replace(/[\s\0]+$/, "");
  cur.skip(3);
  return { bias, compression, fileLabel, ncases, zlib: magic === "$FL3" };
}

// src/sav/source.ts
function filled(byte) {
  return new Uint8Array(8).fill(byte);
}
var UncompressedSource = class {
  constructor(cur, sysmis) {
    this.cur = cur;
    this.sysmis = sysmis;
  }
  cur;
  sysmis;
  nextNumeric() {
    const v = this.cur.readF64();
    return v === this.sysmis ? null : v;
  }
  nextString8() {
    return this.cur.readBytes(8);
  }
  atEnd() {
    return this.cur.pos + 8 > this.cur.length;
  }
};
var RleSource = class {
  // a control code peeked by atEnd(), not yet spent on a cell
  constructor(cur, bias) {
    this.cur = cur;
    this.bias = bias;
  }
  cur;
  bias;
  codes = new Uint8Array(8);
  idx = 8;
  // ≥ 8 forces an octet refill on the first pull
  lookahead = null;
  /** Pull the next raw octet code. Synthesizes 252 (end-of-data) once the stream is exhausted, so an
   * unknown-case-count read (`ncases = -1`) terminates on atEnd() instead of over-reading past EOF. */
  rawCode() {
    if (this.idx >= 8) {
      if (this.cur.pos >= this.cur.length) return 252;
      this.codes = this.cur.readBytes(8);
      this.idx = 0;
    }
    return this.codes[this.idx++];
  }
  /** Next cell-bearing control code: drains any peeked code, then skips 0 fillers (they encode no
   * cell — proven by the labels_order oracle fixture's inter-row octet padding). */
  nextCode() {
    if (this.lookahead !== null) {
      const code = this.lookahead;
      this.lookahead = null;
      return code;
    }
    for (; ; ) {
      const code = this.rawCode();
      if (code !== 0) return code;
    }
  }
  atEnd() {
    if (this.lookahead === null) this.lookahead = this.nextCode();
    return this.lookahead === 252;
  }
  nextNumeric() {
    const code = this.nextCode();
    if (code === 252 || code === 255) return null;
    if (code === 253) return this.cur.readF64();
    return code - this.bias;
  }
  nextString8() {
    const code = this.nextCode();
    if (code === 254) return filled(32);
    if (code === 253) return this.cur.readBytes(8);
    return filled(32);
  }
};
function concatToBuffer(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new ArrayBuffer(total);
  const out = new Uint8Array(buf);
  let ofs = 0;
  for (const p of parts) {
    out.set(p, ofs);
    ofs += p.length;
  }
  return buf;
}
async function inflateDeflate(compressed, maxBytes) {
  const bytes = new Uint8Array(compressed.length);
  bytes.set(compressed);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SavError("ZSAV inflated output exceeds limit");
    }
    parts.push(value);
  }
  return new Uint8Array(concatToBuffer(parts));
}
function readTrailerBlocks(cur, ztrailerOfs) {
  cur.seek(ztrailerOfs);
  cur.readI64();
  cur.readI64();
  cur.readI32();
  const nBlocks = cur.readI32();
  if (nBlocks < 0 || nBlocks > 1e6) throw new SavError("ZSAV block count out of range");
  const blocks = [];
  for (let i = 0; i < nBlocks; i++) {
    cur.readI64();
    const compressedOfs = cur.readI64();
    cur.readI32();
    blocks.push({ compressedOfs, compressedSize: cur.readI32() });
  }
  return blocks;
}
function makeSource(cur, header, sysmis) {
  if (header.compression === 0) return new UncompressedSource(cur, sysmis);
  return new RleSource(cur, header.bias);
}
async function inflateZsav(cur, maxInflatedBytes) {
  cur.readI64();
  const ztrailerOfs = cur.readI64();
  cur.readI64();
  const blocks = readTrailerBlocks(cur, ztrailerOfs);
  const parts = [];
  let total = 0;
  for (const block of blocks) {
    cur.seek(block.compressedOfs);
    const inflated = await inflateDeflate(
      cur.readBytes(block.compressedSize),
      maxInflatedBytes - total
    );
    total += inflated.length;
    parts.push(inflated);
  }
  return concatToBuffer(parts);
}

// src/sav/reader.ts
function rawToF64(raw, little) {
  return new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, little);
}
function valueLabelsFor(physicalIndex, isString, ctx) {
  const { dec, little, sets } = ctx;
  const out = [];
  for (const set of sets) {
    if (!set.varIndexes.includes(physicalIndex)) continue;
    for (const entry of set.labels) {
      const value = isString ? dec.decode(entry.raw).replace(/ +$/, "") : rawToF64(entry.raw, little);
      out.push({ label: dec.decode(entry.labelRaw).replace(/\0+$/, ""), value });
    }
  }
  return out.length > 0 ? out : void 0;
}
function baseVariable(rawVar, index, info) {
  return {
    format: { ...rawVar.print, isDate: isDateFormat(rawVar.print.type) },
    measure: info.measures[index] ?? "unknown",
    missing: rawVar.missing,
    name: info.longNames.get(rawVar.name) ?? rawVar.name,
    type: rawVar.type > 0 ? "string" : "numeric"
  };
}
function buildVariable(slot, ctx) {
  const { index, physicalIndex, rawVar } = slot;
  const isString = rawVar.type > 0;
  const variable = baseVariable(rawVar, index, ctx.info);
  if (rawVar.label !== void 0) variable.label = rawVar.label;
  if (isString) variable.width = rawVar.type;
  const valueLabels = valueLabelsFor(physicalIndex, isString, ctx);
  if (valueLabels) variable.valueLabels = valueLabels;
  return variable;
}
function segmentWidths(raw, start, realWidth) {
  const n = Math.ceil(realWidth / 252);
  const widths = [];
  for (let s = 0; s < n; s++) {
    const rec = raw.variables[start + s];
    if (!rec || rec.type <= 0) {
      throw new SavError(
        `very-long string declares width ${realWidth} (${n} segments) but its segment records are missing or non-string`
      );
    }
    widths.push(rec.type);
  }
  return widths;
}
function buildPlans(raw, ctx) {
  const plans = [];
  let i = 0;
  while (i < raw.variables.length) {
    const rawVar = raw.variables[i];
    const variable = buildVariable(
      { index: i, physicalIndex: raw.physicalIndexes[i], rawVar },
      ctx
    );
    const realWidth = rawVar.type > 0 ? ctx.info.veryLong.get(rawVar.name) : void 0;
    if (realWidth === void 0) {
      plans.push({ segments: rawVar.type > 0 ? [rawVar.type] : [], variable });
      i += 1;
      continue;
    }
    if (!Number.isInteger(realWidth) || realWidth < 1) {
      throw new SavError(
        `very-long string "${rawVar.name}" declares an invalid width ${realWidth}`
      );
    }
    const segments = segmentWidths(raw, i, realWidth);
    variable.width = realWidth;
    plans.push({ segments, variable });
    i += Math.max(1, segments.length);
  }
  return plans;
}
async function readSav(buf, opts) {
  const limits = { ...DEFAULT_LIMITS, ...opts };
  let cur = new Cursor(buf);
  const header = readHeader(cur);
  const raw = readDictionary(cur);
  const info = applyExtensions(raw, cur.little);
  const little = cur.little;
  const dec = decoderFor(info.encoding);
  const plans = buildPlans(raw, { dec, info, little, sets: raw.valueLabelSets });
  const variables = plans.map((plan) => plan.variable);
  if (variables.length === 0) throw new SavError("file has no variables");
  if (header.ncases >= 0 && header.ncases * variables.length > limits.maxCells) {
    throw new SavError(
      `case count ${header.ncases} \xD7 ${variables.length} vars exceeds cell limit ${limits.maxCells}`
    );
  }
  if (header.zlib) {
    const data = await inflateZsav(cur, limits.maxInflatedBytes);
    cur = new Cursor(data);
    cur.little = little;
  }
  const source = makeSource(cur, header, info.sysmis);
  const rows = readCases({ dictInfo: info, header, limits, plans, source });
  return { encoding: info.encoding, format: "sav", sheets: [{ name: "data", rows, variables }] };
}

export { DEFAULT_LIMITS, SavError, applyUserMissing, readSav };
