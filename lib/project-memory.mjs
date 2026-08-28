function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function isHeading(value) {
  return /^(?:#{1,6}\s+|第.{1,16}[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+)*[、.．\s])/.test(value) || (value.length <= 42 && /[:：]$/.test(value));
}

export function chunkProjectText(value, options = {}) {
  const text = normalized(value);
  if (!text) return [];
  const targetChars = integer(options.targetChars, 1_800, 600, 4_000);
  const overlapChars = integer(options.overlapChars, 180, 0, 600);
  const maxChunks = integer(options.maxChunks, 48, 1, 120);
  const paragraphs = text.split(/\n{2,}|(?<=。|！|？)\n/).map(normalized).filter(Boolean);
  const chunks = [];
  let buffer = "";
  let heading = "";
  const push = (retainOverlap = true) => {
    const content = normalized(buffer);
    if (!content || chunks.length >= maxChunks) return;
    chunks.push({ chunk_index: chunks.length, heading, content, char_count: content.length });
    buffer = retainOverlap && overlapChars ? content.slice(-overlapChars) : "";
  };
  for (const paragraph of paragraphs) {
    if (isHeading(paragraph)) heading = paragraph.slice(0, 160);
    if (buffer && buffer.length + paragraph.length + 2 > targetChars) push();
    if (chunks.length >= maxChunks) break;
    if (paragraph.length > targetChars) {
      if (buffer) push(false);
      for (let offset = 0; offset < paragraph.length && chunks.length < maxChunks; offset += Math.max(1, targetChars - overlapChars)) {
        const part = paragraph.slice(offset, offset + targetChars);
        buffer = part;
        push(false);
      }
    } else buffer = `${buffer}${buffer ? "\n\n" : ""}${paragraph}`;
  }
  if (buffer && chunks.length < maxChunks) push();
  return chunks;
}

export function researchQueryTerms(value) {
  const query = normalized(value).toLowerCase().slice(0, 500);
  const terms = [];
  for (const token of query.match(/[a-z0-9][a-z0-9_.-]{1,30}|[\p{Script=Han}]{2,24}/gu) || []) {
    terms.push(token);
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 3) {
      for (let index = 0; index < token.length - 1; index += 1) terms.push(token.slice(index, index + 2));
    }
  }
  return [...new Set(terms)].sort((left, right) => right.length - left.length).slice(0, 18);
}

export function searchProjectChunks(chunks = [], files = [], query, options = {}) {
  const terms = researchQueryTerms(query);
  if (!terms.length) return [];
  const limit = integer(options.limit, 5, 1, 12);
  const excluded = new Set((options.excludeFileIds || []).map(String));
  const fileMap = new Map(files.map((file) => [String(file.id), file]));
  const phrase = normalized(query).toLowerCase();
  return chunks.map((chunk) => {
    const file = fileMap.get(String(chunk.file_id));
    if (!file || excluded.has(String(chunk.file_id)) || file.parse_status !== "completed") return null;
    const content = normalized(chunk.content).toLowerCase();
    const heading = normalized(chunk.heading).toLowerCase();
    const fileName = normalized(file.file_name).toLowerCase();
    let score = phrase.length >= 3 && content.includes(phrase) ? 18 : 0;
    let matchedTerms = 0;
    for (const term of terms) {
      if (!content.includes(term) && !heading.includes(term) && !fileName.includes(term)) continue;
      matchedTerms += 1;
      score += Math.min(8, Math.max(2, term.length)) + (heading.includes(term) ? 4 : 0) + (fileName.includes(term) ? 3 : 0);
    }
    if (!matchedTerms) return null;
    score += matchedTerms / terms.length * 10;
    return {
      id: chunk.id,
      file_id: chunk.file_id,
      file_name: file.file_name,
      category: file.category,
      chunk_index: Number(chunk.chunk_index || 0),
      heading: chunk.heading || "",
      content: chunk.content || "",
      score: Math.round(score * 100) / 100,
      matched_terms: matchedTerms,
    };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.chunk_index - right.chunk_index).slice(0, limit);
}
