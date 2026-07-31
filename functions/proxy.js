// Cloudflare Pages Function — 转发百度OCR请求（绕过CORS）
export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return new Response('missing url param', { status: 400 });

  const decodedTarget = decodeURIComponent(target);
  const method = request.method;

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    let body = null;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = await request.text();
    }
    const resp = await fetch(decodedTarget, { method, headers, body });
    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
