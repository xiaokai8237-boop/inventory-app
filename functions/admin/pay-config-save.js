// Cloudflare Pages Function — /admin/pay-config/save  保存收款配置（云端可换码，全局生效）
// POST /admin/pay-config/save {adminKey, wxQr, alipayQr, kfQr, kfWx, kfHours}
export async function onRequest(context) {
  const { request, env } = context;
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const ADMIN_KEY = env.ADMIN_KEY || '';
  if (!ADMIN_KEY || (body.adminKey || '').toString() !== ADMIN_KEY) return json({ error: '管理员密钥错误' }, 401);

  const cfg = {
    wxQr: (body.wxQr || '').toString().slice(0, 1_400_000),
    alipayQr: (body.alipayQr || '').toString().slice(0, 1_400_000),
    kfQr: (body.kfQr || '').toString().slice(0, 1_400_000),
    kfWx: (body.kfWx || '').toString().slice(0, 100),
    kfHours: (body.kfHours || '凌晨 1:00 — 下午 3:00').toString().slice(0, 100),
    updatedAt: new Date().toISOString()
  };
  for (const k of ['wxQr', 'alipayQr', 'kfQr']) {
    if (cfg[k] && cfg[k].length > 1_400_000) return json({ error: k + ' 图片过大（≤1MB）' }, 400);
  }
  await env.BACKUP_KV.put('pay_config', JSON.stringify(cfg));
  try {
    await env.BACKUP_KV.put('admin_log_' + Date.now(), JSON.stringify({
      action: 'pay-config-save', at: new Date().toISOString()
    }));
  } catch (e) {}
  return json({ ok: true, message: '收款配置已保存，全局生效' });
}
