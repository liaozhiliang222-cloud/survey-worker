"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

function ensureInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) throw new Error("INVALID_STORAGE_PATH");
  return resolved;
}

class LocalResearchFileStorage {
  constructor(root) { this.root = path.resolve(root); }
  key(projectId, fileId, extension) {
    const safeProject = createHash("sha256").update(String(projectId || "")).digest("hex").slice(0, 24);
    const safeFile = String(fileId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const safeExtension = String(extension || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!safeProject || !safeFile || !safeExtension) throw new Error("INVALID_STORAGE_KEY");
    return `${safeProject}/${safeFile}.${safeExtension}`;
  }
  async put(key, bytes) {
    const target = ensureInside(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = ensureInside(this.root, key + '.' + randomUUID() + '.partial');
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(Buffer.from(bytes)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
    return key;
  }
  async get(key) { return fs.readFile(ensureInside(this.root, key)); }
  async delete(key) { try { await fs.unlink(ensureInside(this.root, key)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

function createLocalResearchFileStorage(env = process.env) {
  const root = env.RESEARCH_FILES_DIR || path.join(__dirname, "..", ".data", "research-files");
  return new LocalResearchFileStorage(root);
}

module.exports = { LocalResearchFileStorage, createLocalResearchFileStorage };
