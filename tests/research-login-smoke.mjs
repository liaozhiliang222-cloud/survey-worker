import assert from "node:assert/strict";
import fs from "node:fs";

const { onRequest, researchLoginRedirect, researchSession } = await import(new URL("../functions/api/research/[[path]].js", import.meta.url));
const { buildOwnerMigrationSql, OWNED_TABLES } = await import(new URL("../scripts/migrate-research-owner.mjs", import.meta.url));

// 登录入口只回到站内 hash，不能被利用为开放重定向。
const redirect = (query) => researchLoginRedirect(new Request(`https://surveykit.cc/api/research/login${query}`)).headers.get("Location");
assert.equal(redirect(""), "/#research");
assert.equal(redirect("?return=%23research"), "/#research");
assert.equal(redirect("?return=%23crosstab-analysis"), "/#crosstab-analysis");
assert.equal(redirect("?return=https%3A%2F%2Fevil.example"), "/#research");
assert.equal(redirect("?return=%2F%2Fevil.example"), "/#research");
assert.equal(redirect("?return=%23research%2F..%2F%2Fevil"), "/#research");

// 登录与会话路由不依赖数据库，走在 RESEARCH_DB 检查之前。
const loginResponse = await onRequest({ request: new Request("https://surveykit.cc/api/research/login"), env: {} });
assert.equal(loginResponse.status, 302);
assert.equal(loginResponse.headers.get("Cache-Control"), "no-store");
const anonymousSession = await onRequest({ request: new Request("https://surveykit.cc/api/research/session"), env: {} });
assert.equal(anonymousSession.status, 200);
assert.deepEqual((await anonymousSession.json()).session, { auth_mode: "anonymous", user_id: "anonymous:shared-workspace", email: "", logout_url: "" });

// access 模式下未带有效凭据的会话请求返回 401，前端据此显示登录入口。
const accessEnv = { RESEARCH_AUTH_MODE: "access", CLOUDFLARE_ACCESS_TEAM_DOMAIN: "surveykit.cloudflareaccess.com", CLOUDFLARE_ACCESS_AUD: "surveykit-audience" };
const unauthenticated = await onRequest({ request: new Request("https://surveykit.cc/api/research/session"), env: accessEnv });
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).error.type, "unauthorized");

// access 会话返回经过签名校验的邮箱和退出地址，不信任单独的邮箱请求头。
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "login-test-key" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({ iss: "https://surveykit.cloudflareaccess.com", aud: ["surveykit-audience"], sub: "access-user-123", email: "Researcher@Example.com", exp: Math.floor(Date.now() / 1000) + 300 })}`;
const signature = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsigned))).toString("base64url");
const certFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
const signedRequest = new Request("https://surveykit.cc/api/research/session", { headers: { "Cf-Access-Jwt-Assertion": `${unsigned}.${signature}`, "cf-access-authenticated-user-email": "forged@example.com" } });
assert.deepEqual(await researchSession(signedRequest, accessEnv, "access-user-123", certFetch), { auth_mode: "access", user_id: "access-user-123", email: "researcher@example.com", logout_url: "/cdn-cgi/access/logout" });

// 迁移 SQL 覆盖所有带 user_id 的表，并正确转义身份字符串。
const migrations = fs.readdirSync(new URL("../migrations/", import.meta.url)).map((name) => fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")).join("\n");
const finalTables = [...migrations.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (research_[a-z_]+?)(?:_v\d+)? \(([^;]*?)\);/g)].filter((match) => /\buser_id\b/.test(match[2])).map((match) => match[1]);
assert.deepEqual([...new Set(finalTables)].sort(), [...OWNED_TABLES].sort(), "迁移脚本必须覆盖所有带 user_id 的研究员表");
const sql = buildOwnerMigrationSql({ to: "o'brien" });
for (const table of OWNED_TABLES) assert.match(sql, new RegExp(`UPDATE ${table} SET user_id = 'o''brien' WHERE user_id = 'anonymous:shared-workspace';`));
const scoped = buildOwnerMigrationSql({ to: "access-user-123", projectIds: ["p1", "p1", "p2"] });
assert.match(scoped, /UPDATE research_projects SET user_id = 'access-user-123' WHERE user_id = 'anonymous:shared-workspace' AND id IN \('p1', 'p2'\);/);
assert.match(scoped, /UPDATE research_datasets SET .* AND project_id IN \('p1', 'p2'\);/);
assert.throws(() => buildOwnerMigrationSql({}), /--to/);
assert.throws(() => buildOwnerMigrationSql({ from: "a", to: "a" }), /不能相同/);

// 前端：所有研究员请求都把 Access 跳转识别为未登录，显示登录入口而不是网络错误。
const ui = fs.readFileSync(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const directFetches = [...ui.matchAll(/fetch\(`\$\{API_ROOT\}[^\n]*/g)].map((match) => match[0]);
assert.ok(directFetches.length >= 4);
for (const call of directFetches) assert.match(call, /redirect: "manual"/, call.slice(0, 80));
assert.match(ui, /response\.type === "opaqueredirect" \|\| response\.status === 401/);
assert.match(ui, /async function responseError\(response\) \{\s*if \(isAuthRedirect\(response\)\) return authRequiredError\(\);/);
assert.match(ui, /if \(state\.authRequired\) \{ renderLoginGate\(list\); return; \}/);
assert.match(ui, /\/messages`[^\n]*\n\s*if \(isAuthRedirect\(response\)\) throw authRequiredError\(\);/, "消息接口的非流式分支也要识别登录跳转");
assert.match(ui, /LOGIN_URL = `\$\{API_ROOT\}\/login\?return=%23research`/);
assert.match(html, /id="researchSessionInfo"/);

console.log("research-login-smoke: PASS");
