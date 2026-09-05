function bearerToken(header) {
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function verifyAgentToolCredential(header, expectedSecret) {
  const supplied = bearerToken(header);
  const expected = String(expectedSecret || "").trim();
  if (!supplied || !expected) return false;
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  const [left, right] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(supplied)),
    subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left); const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}
