import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { onRequestGet } from "../functions/healthz.js";

const require = createRequire(import.meta.url);
const { releaseInfo } = require("../lib/release-info");

const localRelease = releaseInfo({
  SURVEYKIT_RELEASE: "local-1",
  SURVEYKIT_COMMIT: "abc123",
  SURVEYKIT_DEPLOYED_AT: "2026-08-23T10:00:00Z",
});
assert.deepEqual(localRelease, {
  version: "local-1",
  revision: "abc123",
  deployed_at: "2026-08-23T10:00:00Z",
});

const response = await onRequestGet({
  env: {
    PPTX_BACKEND_URL: "https://ppt-api.example.com",
    SENSENOVA_API_KEY: "configured",
    SURVEYKIT_RELEASE: "pages-1",
    CF_PAGES_COMMIT_SHA: "def456",
  },
});
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal(response.headers.get("x-surveykit-service"), "surveykit-web");
const payload = await response.json();
assert.equal(payload.ok, true);
assert.equal(payload.runtime, "cloudflare-pages");
assert.equal(payload.release.version, "pages-1");
assert.equal(payload.release.revision, "def456");
assert.equal(payload.dependencies.pptx_backend_configured, true);
assert.equal(payload.dependencies.ai_proxy_configured, true);

const automaticReleaseResponse = await onRequestGet({
  env: { CF_PAGES_COMMIT_SHA: "commit-release-789" },
});
const automaticReleasePayload = await automaticReleaseResponse.json();
assert.equal(automaticReleasePayload.release.version, "commit-release-789");
assert.equal(automaticReleaseResponse.headers.get("x-surveykit-release"), "commit-release-789");

console.log("Health contract smoke passed: local and Cloudflare release metadata");
