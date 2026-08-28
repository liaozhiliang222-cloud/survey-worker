function endpointFrom(env = {}) { return String(env.RESEARCH_OCR_ENDPOINT || "").trim(); }

export function isOcrConfigured(env = {}) { return Boolean(endpointFrom(env)); }

export async function requestProjectOcr({ env = {}, file, bytes, fetchImpl = fetch }) {
  const endpoint = endpointFrom(env);
  if (!endpoint) { const error = new Error("OCR_NOT_CONFIGURED"); error.code = "OCR_NOT_CONFIGURED"; throw error; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(300_000, Math.max(5_000, Number(env.RESEARCH_OCR_TIMEOUT || 120_000))));
  try {
    const headers = { "Content-Type": file.mime_type || "application/octet-stream", "X-Research-File-Name": encodeURIComponent(file.file_name || "document") };
    if (env.RESEARCH_OCR_API_KEY) headers.Authorization = `Bearer ${String(env.RESEARCH_OCR_API_KEY)}`;
    const response = await fetchImpl(endpoint, { method: "POST", headers, body: bytes, signal: controller.signal });
    if (!response.ok) { const error = new Error("OCR_UPSTREAM"); error.code = "OCR_UPSTREAM"; error.status = response.status; throw error; }
    const payload = await response.json();
    const text = String(payload?.text || payload?.result?.text || "").trim();
    if (!text) { const error = new Error("OCR_EMPTY"); error.code = "OCR_EMPTY"; throw error; }
    return { text, provider: String(payload?.provider || "external-ocr").slice(0, 80) };
  } catch (error) {
    if (error?.name === "AbortError") { const timeoutError = new Error("OCR_TIMEOUT"); timeoutError.code = "OCR_TIMEOUT"; throw timeoutError; }
    throw error;
  } finally { clearTimeout(timeout); }
}

