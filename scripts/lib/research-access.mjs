export function accessServiceHeaders(env = process.env) {
  const id = String(env.CF_ACCESS_CLIENT_ID || "").trim();
  const secret = String(env.CF_ACCESS_CLIENT_SECRET || "").trim();
  if (Boolean(id) !== Boolean(secret)) throw new Error("CF_ACCESS_CLIENT_ID 和 CF_ACCESS_CLIENT_SECRET 必须同时设置。");
  return id ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}

export function isAccessLoginRedirect(response) {
  if (response.status !== 302) return false;
  try {
    const target = new URL(response.headers.get("location"));
    return target.protocol === "https:" && !target.username && !target.password
      && !target.port && target.hostname.endsWith(".cloudflareaccess.com");
  } catch { return false; }
}

// Keep credentials on the intended origin and never forward them through redirects.
export function createResearchFetch(baseUrl, { env = process.env, fetchImpl = fetch } = {}) {
  const origin = new URL(baseUrl).origin;
  const credentials = accessServiceHeaders(env);
  return async (input, options = {}) => {
    const url = new URL(input);
    if (url.origin !== origin || !/^\/api\/research(?:\/|$)/.test(url.pathname)) {
      return fetchImpl(input, options);
    }
    const headers = new Headers(options.headers);
    for (const [name, value] of Object.entries(credentials)) headers.set(name, value);
    const response = await fetchImpl(input, { ...options, headers, redirect: "manual" });
    if (isAccessLoginRedirect(response)) {
      await response.body?.cancel();
      throw new Error("研究员接口需要登录。生产冒烟测试请同时设置 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET，并为该服务凭据配置 Service Auth 策略。");
    }
    return response;
  };
}
