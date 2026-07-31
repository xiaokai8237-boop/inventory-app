// Cloudflare Pages Function — 云备份（读写 KV）
// POST /backup   body: {deviceId, data}  → 保存该设备的备份
// GET  /backup?deviceId=xxx             → 读取该设备的备份
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: cors });
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const deviceId = body.deviceId;
      const data = body.data;
      if (!deviceId || !data) {
        return new Response(JSON.stringify({ error: 'missing deviceId or data' }), { status: 400, headers: cors });
      }
      // 存到 KV：key = device_xxx
      await env.BACKUP_KV.put('device_' + deviceId, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  }

  if (request.method === 'GET') {
    const deviceId = url.searchParams.get('deviceId');
    if (!deviceId) {
      return new Response(JSON.stringify({ error: 'missing deviceId' }), { status: 400, headers: cors });
    }
    const raw = await env.BACKUP_KV.get('device_' + deviceId);
    if (!raw) {
      return new Response(JSON.stringify({ data: null }), { status: 200, headers: cors });
    }
    return new Response(JSON.stringify({ data: JSON.parse(raw) }), { status: 200, headers: cors });
  }

  return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });
}
