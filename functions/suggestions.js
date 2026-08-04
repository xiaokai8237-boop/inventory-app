// Cloudflare Pages Function — 功能建议（公共建议墙）
// GET  /suggestions                拉取全部建议（所有人可见，最新在前）
// POST /suggestions  body:{phone,text}  提交建议（同一手机号每日最多3条，防刷）
export async function onRequest(context) {
  const { request, env } = context;
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method === 'GET') {
    const raw = await env.BACKUP_KV.get('suggestions');
    if (!raw) return json({ suggestions: [] });
    try { return json({ suggestions: JSON.parse(raw) }); }
    catch (e) { return json({ suggestions: [] }); }
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
    const phone = (body.phone || '').toString().trim();
    const text = (body.text || '').toString().trim();
    if (!phone) return json({ error: 'missing phone' }, 400);
    if (text.length < 2) return json({ error: '建议内容太短' }, 400);
    if (text.length > 500) return json({ error: '建议内容过长（最多500字）' }, 400);

    // 防刷：同一手机号每日最多 3 条
    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = 'suggest_daily_' + phone + '_' + today;
    const daily = parseInt((await env.BACKUP_KV.get(dailyKey)) || '0', 10);
    if (daily >= 3) return json({ error: '今日已提交 3 条建议，明天再来吧' }, 429);

    // 读现有建议列表，新建议放最前
    let list = [];
    const raw = await env.BACKUP_KV.get('suggestions');
    if (raw) { try { list = JSON.parse(raw); } catch (e) { list = []; } }
    if (!Array.isArray(list)) list = [];
    const item = {
      phone: phone.slice(0, 3) + '****' + phone.slice(-4),
      text: text,
      time: new Date().toISOString()
    };
    list.unshift(item);
    if (list.length > 200) list = list.slice(0, 200); // 上限200条滚动

    await env.BACKUP_KV.put('suggestions', JSON.stringify(list));
    await env.BACKUP_KV.put(dailyKey, String(daily + 1), { expirationTtl: 86400 });
    return json({ ok: true, suggestion: item });
  }
  return json({ error: 'not found' }, 404);
}
