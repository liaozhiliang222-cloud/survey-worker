export async function onRequestPost({ request }) {
  try {
    const payload = await request.json();
    const targetUrl = payload.url;
    const apiKey = payload.apiKey;
    const requestBody = payload.body;

    if (!targetUrl || !apiKey || !requestBody) {
      return Response.json({ error: { message: "Missing url, apiKey or body" } }, { status: 400 });
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
