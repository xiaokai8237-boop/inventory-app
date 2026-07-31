// Cloudflare Pages Function — /admin/* 管理员接口
// POST /admin/reset  {adminKey, phone, newPasswordHash}  管理员重置用户密码
// POST /admin/stats  {adminKey}                          统计注册人数
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
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }

  const adminKey = (body.adminKey || '').toString();
  if (adminKey !== '8023.520') return json({ error: '管理员密钥错误' }, 401);

  if (url.pathname.endsWith('/admin/stats')) {
    // 统计注册人数：KV 中以 account_ 为前缀的 key 数量
    try {
      const list = await env.BACKUP_KV.list({ prefix: 'account_' });
      let total = list.keys.length;
      let cursor = list.cursor;
      while (cursor) {
        const page = await env.BACKUP_KV.list({ prefix: 'account_', cursor });
        total += page.keys.length;
        cursor = page.cursor;
      }
      return json({ ok: true, count: total });
    } catch (e) {
      return json({ error: '统计失败: ' + e.message }, 500);
    }
  }

  if (!url.pathname.endsWith('/admin/reset')) return json({ error: 'not found' }, 404);

  const phone = (body.phone || '').toString().trim();
  const newPasswordHash = (body.newPasswordHash || '').toString().trim();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (newPasswordHash.length < 16) return json({ error: '新密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  acct.passwordHash = newPasswordHash;
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true, message: '密码已重置' });
}
