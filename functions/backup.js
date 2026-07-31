// Cloudflare Pages Function — 云备份（读写 KV）
// POST /backup   body: {account?, deviceId, data}  → 保存备份
// GET  /backup?account=xxx 或 ?deviceId=xxx       → 读取备份
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
      const account = (body.account || '').toString().trim().toLowerCase();
      const deviceId = body.deviceId;
      const data = body.data;
      if ((!account && !deviceId) || !data) {
        return new Response(JSON.stringify({ error: 'missing account/deviceId or data' }), { status: 400, headers: cors });
      }
      // 有账号 → 存到 account_邮箱（跨设备恢复用）；同时存 device_设备ID（独立备份）
      if (account) {
        await env.BACKUP_KV.put('account_' + account, JSON.stringify(data));
      }
      if (deviceId) {
        await env.BACKUP_KV.put('device_' + deviceId, JSON.stringify(data));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  }

  if (request.method === 'GET') {
    const account = (url.searchParams.get('account') || '').toString().trim().toLowerCase();
    const deviceId = url.searchParams.get('deviceId');
    const key = account ? 'account_' + account : (deviceId ? 'device_' + deviceId : null);
    if (!key) {
      return new Response(JSON.stringify({ error: 'missing account or deviceId' }), { status: 400, headers: cors });
    }
    const raw = await env.BACKUP_KV.get(key);
    if (!raw) {
      return new Response(JSON.stringify({ data: null }), { status: 200, headers: cors });
    }
    return new Response(JSON.stringify({ data: JSON.parse(raw) }), { status: 200, headers: cors });
  }

  return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });
}
