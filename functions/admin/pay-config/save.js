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

  // 先校验原始大小（防截断后绕过校验），再截断
  for (const k of ['wxQr', 'alipayQr', 'kfQr']) {
    if ((body[k] || '').toString().length > 2_000_000) return json({ error: k + ' 图片过大（压缩后仍超限）' }, 400);
  }
  const cfg = {
    wxQr: (body.wxQr || '').toString().slice(0, 2_000_000),
    alipayQr: (body.alipayQr || '').toString().slice(0, 2_000_000),
    kfQr: (body.kfQr || '').toString().slice(0, 2_000_000),
    kfWx: (body.kfWx || '').toString().slice(0, 100),
    kfHours: (body.kfHours || '凌晨 1:00 — 下午 3:00').toString().slice(0, 100),
    updatedAt: new Date().toISOString()
  };
  try {
    await env.BACKUP_KV.put('pay_config', JSON.stringify(cfg));
  } catch (e) {
    return json({ error: '云端存储失败，请重试（' + (e && e.message ? e.message : 'KV error') + '）' }, 500);
  }
  // 读回验证（确认真正写入）
  let verified = false;
  try {
    const back = await env.BACKUP_KV.get('pay_config').catch(() => null);
    if (back && back.length > 10) verified = true;
  } catch (e) {}
  try {
    await env.BACKUP_KV.put('admin_log_' + Date.now(), JSON.stringify({
      action: 'pay-config-save', at: new Date().toISOString()
    }));
  } catch (e) {}
  return json({ ok: true, verified, message: verified ? '收款配置已保存，全局生效' : '已保存（存储验证待确认）' });
}
