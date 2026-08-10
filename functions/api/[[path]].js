// Cloudflare Pages Function — /api/* 接口（需求7 邀请记录）
// GET /api/invite/stats    {token} → {monthCount, limit}      本月已邀请人数 + 上限
// GET /api/invite/records  {token} → {list: [{phone, time, status}]}  邀请记录（脱敏手机号）
// 鉴权：Authorization: Bearer <token>（tok_<token> = phone，30 天 TTL）
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const path = url.pathname;
  // token 鉴权：优先 Authorization 头，兜底 query token
  const auth = (request.headers.get('Authorization') || '').toString();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('token') || '');
  const phone = token ? await env.BACKUP_KV.get('tok_' + token).catch(() => null) : null;
  if (!phone) return json({ error: '未登录或登录已过期' }, 401);

  if (path.endsWith('/api/invite/stats')) {
    // 本月已邀请人数（granted 计数）+ 上限
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const cntRaw = await env.BACKUP_KV.get('invite_cnt_' + phone + '_' + ym).catch(() => null);
    return json({ ok: true, monthCount: parseInt(cntRaw, 10) || 0, limit: 20 });
  }

  if (path.endsWith('/api/invite/records')) {
    // 遍历 invite_rel_<inviteePhone>，筛选 inviterPhone === 当前用户，按时间倒序
    const list = [];
    let cursor;
    try {
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'invite_rel_', cursor, limit: 1000 });
        for (const k of page.keys) {
          const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
          if (!raw) continue;
          let rel;
          try { rel = JSON.parse(raw); } catch (e) { continue; }
          if (!rel || rel.inviterPhone !== phone) continue;
          const inviteePhone = k.name.replace('invite_rel_', '');
          list.push({
            phone: maskPhone(inviteePhone),      // 脱敏
            time: rel.time || '',
            status: rel.status || 'none'          // granted | denied | none
          });
        }
        cursor = page.cursor;
      } while (cursor);
    } catch (e) { return json({ error: '查询失败' }, 500); }
    list.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    return json({ ok: true, list });
  }

  return json({ error: 'not found' }, 404);
}

// 手机号脱敏：138****8000
function maskPhone(phone) {
  if (!phone || phone.length !== 11) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(7);
}
