const headers = ['QY', 'Q1', 'ID', 'CITY', 'Q2', 'EMPTY', 'CONST'];
const rows = Array.from({ length: 48 }, (_, i) => ({ QY: i === 47 ? 99 : 1 + .4 * (i % 6) + .8 * Math.floor(i / 6) + (i % 2 ? .05 : -.05), Q1: i % 6, ID: i + 1, CITY: i % 2 ? '上海' : '北京', Q2: i === 46 ? null : Math.floor(i / 6), EMPTY: null, CONST: 5 }));
const variables = [
  { name: 'QY', type: 0, label: '总体满意度' },
  { name: 'Q1', type: 0, label: '产品体验评分', values: { 0: '完全不满意', 1: '不满意', 2: '一般', 3: '较满意', 4: '满意', 5: '非常满意' } },
  { name: 'ID', type: 0, label: '受访者编号' },
  { name: 'CITY', type: 16, label: '常住城市' },
  { name: 'Q2', type: 0, label: '服务体验评分' },
  { name: 'EMPTY', type: 0, label: '未作答题' },
  { name: 'CONST', type: 0, label: '固定值题' },
];
function csv() { return [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n'); }
async function sav({ range = false, compressed = false, nominal = false, nps = false } = {}) {
  const { SavWriter } = await import('savfilewriter');
  const sourceVariables = nps ? variables.map(v => v.name === 'QY' ? { ...v, label: '有多大意愿推荐此平台？【打分】请用0分到10分评分。' } : v) : variables;
  let base = Buffer.from(SavWriter.write({ encoding: 'UTF-8', sysvars: sourceVariables }, rows));
  if (nominal) {
    const marker = Buffer.alloc(12); marker.writeInt32LE(7, 0); marker.writeInt32LE(11, 4); marker.writeInt32LE(4, 8);
    const index = base.indexOf(marker, 176);
    if (index >= 0) {
      const count = base.readInt32LE(index + 12);
      for (let offset = index + 16; offset < index + 16 + count * 4; offset += 12) base.writeInt32LE(1, offset);
    } else {
      const record = Buffer.alloc(16 + sourceVariables.length * 12); marker.copy(record); record.writeInt32LE(sourceVariables.length * 3, 12);
      for (let i = 0; i < sourceVariables.length; i++) { record.writeInt32LE(1, 16 + i * 12); record.writeInt32LE(8, 20 + i * 12); }
      const end = Buffer.alloc(8); end.writeInt32LE(999); const insertion = base.indexOf(end, 176);
      if (insertion < 0) throw Error('SAV dictionary end missing');
      base = Buffer.concat([base.subarray(0, insertion), record, base.subarray(insertion)]);
    }
  }
  // Declare the first variable's 99 (or 98..99 interval) as user-missing.
  const labelBytes = base.readInt32LE(208), insertion = 212 + Math.ceil(labelBytes / 4) * 4;
  base.writeInt32LE(range ? -2 : 1, 188);
  const missing = Buffer.alloc(range ? 16 : 8);
  missing.writeDoubleLE(range ? 98 : 99); if (range) missing.writeDoubleLE(99, 8);
  const bytes = Buffer.concat([base.subarray(0, insertion), missing, base.subarray(insertion)]);
  if (!compressed) return bytes;
  // Standard bytecode-compressed SAV, with literal numeric/string cells.
  const marker = Buffer.alloc(8); marker.writeInt32LE(999);
  const start = bytes.indexOf(marker, 176) + 8;
  if (start < 184) throw Error('SAV fixture dictionary terminator missing');
  const dictionary = Buffer.from(bytes.subarray(0, start)); dictionary.writeInt32LE(1, 72);
  const blocks = [];
  for (let offset = start; offset < bytes.length; offset += 64) {
    const count = Math.min(8, (bytes.length - offset) / 8), codes = Buffer.alloc(8);
    const literals = [];
    for (let i = 0; i < count; i++) {
      const unit = bytes.subarray(offset + i * 8, offset + (i + 1) * 8);
      codes[i] = unit.readDoubleLE() === -Number.MAX_VALUE ? 255 : 253;
      if (codes[i] === 253) literals.push(unit);
    }
    blocks.push(codes, ...literals);
  }
  return Buffer.concat([dictionary, ...blocks]);
}
module.exports = { headers, rows, variables, csv, sav };
