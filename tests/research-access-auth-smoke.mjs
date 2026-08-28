import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../functions/api/research/[[path]].js", import.meta.url), "utf8");
const { onRequest, resolveResearchIdentity, verifyAccessIdentity } = await import(new URL("../functions/api/research/[[path]].js", import.meta.url));

const anonymousDefault = await resolveResearchIdentity(
  new Request("https://surveykit.cc/api/research/projects", {
    headers: { "X-User-ID": "attacker-selected-user" },
  }),
  {},
);
assert.equal(anonymousDefault, "anonymous:shared-workspace");

const anonymousConfigured = await resolveResearchIdentity(
  new Request("https://surveykit.cc/api/research/projects"),
  { RESEARCH_AUTH_MODE: "anonymous", RESEARCH_ANONYMOUS_USER_ID: "internal-demo" },
);
assert.equal(anonymousConfigured, "anonymous:internal-demo");

const unknownMode = await resolveResearchIdentity(
  new Request("https://surveykit.cc/api/research/projects"),
  { RESEARCH_AUTH_MODE: "unexpected-mode" },
);
assert.equal(unknownMode, "");

const unknownModeResponse = await onRequest({
  request: new Request("https://surveykit.cc/api/research/projects"),
  env: { RESEARCH_AUTH_MODE: "unexpected-mode" },
});
assert.equal(unknownModeResponse.status, 503);
assert.equal((await unknownModeResponse.json()).error.type, "auth_not_configured");

const missingAccessConfigResponse = await onRequest({
  request: new Request("https://surveykit.cc/api/research/projects"),
  env: { RESEARCH_AUTH_MODE: "access" },
});
assert.equal(missingAccessConfigResponse.status, 503);
assert.equal((await missingAccessConfigResponse.json()).error.type, "auth_not_configured");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", publicKey);
jwk.kid = "access-test-key";

const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const header = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
const claims = encode({
  iss: "https://surveykit.cloudflareaccess.com",
  aud: ["surveykit-audience"],
  sub: "access-user-123",
  email: "researcher@example.com",
  exp: Math.floor(Date.now() / 1000) + 300,
});
const unsigned = `${header}.${claims}`;
const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsigned));
const token = `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
const env = {
  RESEARCH_AUTH_MODE: "access",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "surveykit.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "surveykit-audience",
};
const certFetch = async (url) => {
  assert.equal(url, "https://surveykit.cloudflareaccess.com/cdn-cgi/access/certs");
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
};

const verified = await verifyAccessIdentity(new Request("https://surveykit.cc/api/research/projects", {
  headers: {
    "Cf-Access-Jwt-Assertion": token,
    "cf-access-authenticated-user-email": "forged@example.com",
  },
}), env, certFetch);
assert.equal(verified, "access-user-123");

const forgedHeaderOnly = await verifyAccessIdentity(new Request("https://surveykit.cc/api/research/projects", {
  headers: { "cf-access-authenticated-user-email": "victim@example.com" },
}), env, certFetch);
assert.equal(forgedHeaderOnly, "");

const wrongAudience = await verifyAccessIdentity(new Request("https://surveykit.cc/api/research/projects", {
  headers: { "Cf-Access-Jwt-Assertion": token },
}), { ...env, CLOUDFLARE_ACCESS_AUD: "another-application" }, certFetch);
assert.equal(wrongAudience, "");

const accessResolved = await resolveResearchIdentity(new Request("https://surveykit.cc/api/research/projects", {
  headers: { "Cf-Access-Jwt-Assertion": token },
}), env, certFetch);
assert.equal(accessResolved, "access-user-123");

const leaseExpression = source.match(/const\s+leaseMs\s*=\s*([^;]+);/)?.[1];
assert.ok(leaseExpression, "project lock lease must be configured");
assert.equal(
  leaseExpression.replace(/\s/g, ""),
  "Math.max(boundedTimeout,boundedLongTimeout)*3+60000",
  "project lock lease must cover the larger of normal and long-task timeouts",
);
assert.match(source, /acquireProjectLock\(\s*pid\s*,\s*lockOwner\s*,\s*leaseMs\s*\)/);
assert.doesNotMatch(source, /acquireProjectLock\(pid,rid,/);
assert.doesNotMatch(source, /releaseProjectLock\(pid,rid\)/);

console.log("research-access-auth-smoke: PASS");
