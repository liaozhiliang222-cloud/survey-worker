"use strict";

function configuredBodyLimit(rawValue, fallback, maximum, minimum = 1024) {
  const configured = Number(rawValue);
  if (!Number.isFinite(configured)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(configured)));
}

function collectRequestBody(req, maxBytes, done) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  let completed = false;
  let declaredTooLarge = false;
  const complete = (result) => {
    if (completed) return;
    completed = true;
    done(result);
  };

  req.on("data", (chunk) => {
    if (!declaredTooLarge) size += chunk.length;
    if (tooLarge) return;
    if (size > maxBytes) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => complete({
    body: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks),
    error: null,
    size,
    tooLarge,
  }));
  req.on("error", (error) => complete({ body: Buffer.alloc(0), error, size, tooLarge: false }));

  const declaredSize = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    declaredTooLarge = true;
    tooLarge = true;
    size = declaredSize;
    chunks.length = 0;
    req.resume();
  }
}

function bodyLimitError(scope, maxBytes) {
  return {
    error: {
      message: `${scope}请求体超过限制（最大 ${maxBytes} 字节）。`,
      code: "REQUEST_BODY_TOO_LARGE",
    },
  };
}

module.exports = { configuredBodyLimit, collectRequestBody, bodyLimitError };
