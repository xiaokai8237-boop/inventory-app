// Cloudflare Pages Function — /admin/pay-config  读收款配置（静态路由优先于 admin/[[path]].js）
// POST /admin/pay-config {adminKey} → {ok, config}
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
  const raw = await env.BACKUP_KV.get('pay_config').catch(() => null);
  if (raw) { try { return json({ ok: true, config: JSON.parse(raw) }); } catch (e) {} }
  return json({ ok: true, config: { wxQr: '', alipayQr: '', kfQr: '', kfWx: '', kfHours: '凌晨 1:00 — 下午 3:00' } });
}
