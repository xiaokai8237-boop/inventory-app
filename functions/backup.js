// Cloudflare Pages Function — 云备份（读写 KV）
// POST /backup   body: {account?, deviceId, data}  保存备份
// GET  /backup?account=xxx 或 ?deviceId=xxx       读取备份
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method === 'GET') return handleGet(url, env, json);
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
    return handleBackupPost(body, env, json);
  }
  return json({ error: 'not found' }, 404);
}

async function handleGet(url, env, json) {
  const account = (url.searchParams.get('account') || '').toString().trim().toLowerCase();
  const deviceId = url.searchParams.get('deviceId');
  const key = account ? 'account_' + account : (deviceId ? 'device_' + deviceId : null);
  if (!key) return json({ error: 'missing account or deviceId' }, 400);
  const raw = await env.BACKUP_KV.get(key);
  if (!raw) return json({ data: null });
  return json({ data: JSON.parse(raw) });
}

async function handleBackupPost(body, env, json) {
  const account = (body.account || '').toString().trim().toLowerCase();
  const deviceId = body.deviceId;
  const data = body.data;
  if ((!account && !deviceId) || !data) return json({ error: 'missing account/deviceId or data' }, 400);
  if (account) await env.BACKUP_KV.put('account_' + account, JSON.stringify(data));
  if (deviceId) await env.BACKUP_KV.put('device_' + deviceId, JSON.stringify(data));
  return json({ ok: true });
}
