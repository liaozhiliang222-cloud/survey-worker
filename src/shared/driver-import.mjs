import { readSav, applyUserMissing } from './vendor/spss-reader.mjs';

// Keep numeric codes separate from labels. These tables are for modelling;
// other modules' display-oriented SAV conversion remains independent.
export async function readDriverFile(file, readWorkbook) {
  if (!file || file.size > 20 * 1024 * 1024) throw Error('请选择 20MB 以内的数据文件。');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['sav', 'xlsx', 'csv', 'txt'].includes(extension)) throw Error('支持 SAV、XLSX、CSV 和制表符文本，请选择对应格式。');
  const buffer = await file.arrayBuffer();
  if (extension === 'sav') {
    try {
      const parsed = await readSav(buffer, { maxCells: 5_000_000, maxInflatedBytes: 96 * 1024 * 1024 });
      return parsed.sheets.map(sheet => ({ ...applyUserMissing(sheet), encoding: parsed.encoding }));
    } catch (error) {
      throw Error(`SAV 读取失败：${error.message}。请检查文件是否完整，或在 SPSS 中另存为标准 SAV 后重试。`);
    }
  }
  if (extension === 'xlsx') {
    const sheets = await readWorkbook(buffer);
    return sheets.filter(s => s.rows.length > 1).map(s => ({ name: s.name, headers: s.rows[0], rows: s.rows.slice(1) }));
  }
  const bytes = new Uint8Array(buffer);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { text = new TextDecoder('gb18030').decode(bytes); }
  return [{ text, name: 'Data' }];
}
