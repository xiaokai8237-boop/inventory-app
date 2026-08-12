// Cloudflare Pages Function — /listen/* 收款监听上报（管理 APK 原生监听服务调用）
// POST /listen/report    {listenKey, amount}   监听上报「收到 X 元」→ 匹配订单 → 发VIP → 记流水
// POST /listen/heartbeat {listenKey, deviceId} 心跳（管理 APP 每 5 分钟）
// 安全：listenKey = hex(SHA-256('kuanwei-listen:' + ADMIN_KEY))，与管理密码同源，管理 APP 首次登录后本地派生
const PLANS = {
  month:    { days: 30  },
  season:   { days: 90  },
  year:     { days: 365 },
  lifetime: { days: 0   }
};
const ORDER_TTL = 2 * 3600 * 1000; // 订单 2 小时有效

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
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const ADMIN_KEY = env.ADMIN_KEY || '';
  if (!ADMIN_KEY) return json({ error: '服务未配置' }, 500);

  // listenKey 派生校验（与管理密码同源，不新增环境变量）
  const expectKey = await deriveListenKey(ADMIN_KEY);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const listenKey = (body.listenKey || '').toString();
  if (listenKey !== expectKey) return json({ error: '密钥错误' }, 401);

  const path = url.pathname;
  if (path.endsWith('/listen/report')) return handleReport(body, env, json);
  if (path.endsWith('/listen/heartbeat')) return handleHeartbeat(body, env, json);
  return json({ error: 'not found' }, 404);
}

// ============ 收款上报 → 匹配订单 → 发 VIP ============
async function handleReport(body, env, json) {
  try {
    const amount = parseFloat(body.amount);
    if (!(amount > 0) || amount > 10000) return json({ error: '金额异常' }, 400);
    const now = Date.now();
    const dateKey = new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);

    // 防重复上报（微信双端通知/重试）：同金额 5 分钟去重
    const dedupKey = 'listen_dedup_' + amount.toFixed(2);
    const lastTs = await env.BACKUP_KV.get(dedupKey).catch(() => null);
    if (lastTs && now - parseInt(lastTs, 10) < 5 * 60 * 1000) {
      return json({ ok: true, matched: false, dup: true });
    }
    await env.BACKUP_KV.put(dedupKey, String(now));

    // 查同金额未支付订单（2 小时内）
    const order = await findPendingOrder(env, amount, now);
    let flow = { amount, ts: now, dateKey, source: 'listen', status: 'unmatched', orderNo: '' };
    let vipGranted = false;
    if (order) {
      order.status = 'paid';
      order.paidAt = new Date(now).toISOString();
      order.channel = 'listen';
      await env.BACKUP_KV.put('pay_order_' + order.orderNo, JSON.stringify(order));
      await grantVip(env, order.phone, order.planId);
      flow.orderNo = order.orderNo;
      flow.status = 'matched';
      flow.phone = order.phone;
      vipGranted = true;
    }
    await appendFlow(env, flow);
    return json({ ok: true, matched: vipGranted, orderNo: flow.orderNo });
  } catch (e) { return json({ error: '处理失败' }, 500); }
}

// ============ 心跳 ============
async function handleHeartbeat(body, env, json) {
  try {
    const deviceId = (body.deviceId || 'unknown').toString().slice(0, 64);
    const ts = Date.now();
    await env.BACKUP_KV.put('listen_hb_' + deviceId, String(ts));
    return json({ ok: true, ts });
  } catch (e) { return json({ error: '心跳失败' }, 500); }
}

// ============ 工具 ============
async function deriveListenKey(adminKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kuanwei-listen:' + adminKey));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const TOLERANCE = 0.05; // 容差兜底：用户实际付款与订单金额差 ≤0.05 视为该订单（防止少付几分钱匹配不上）
async function findPendingOrder(env, amount, now) {
  let cursor;
  let exact = null;
  let tolerant = null; // {order, diff}
  do {
    const page = await env.BACKUP_KV.list({ prefix: 'pay_order_', cursor, limit: 200 });
    for (const k of page.keys) {
      const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
      if (!raw) continue;
      try {
        const o = JSON.parse(raw);
        if (o.status !== 'created') continue;
        const created = new Date(o.createdAt).getTime();
        if (now - created >= ORDER_TTL) continue;
        const diff = Math.abs(o.amount - amount);
        if (diff < 0.001) { exact = o; break; } // 精确匹配优先
        if (diff <= TOLERANCE && (!tolerant || diff < tolerant.diff)) tolerant = { order: o, diff };
      } catch (e) {}
    }
    cursor = page.cursor;
  } while (cursor);
  return exact || (tolerant && tolerant.order) || null;
}
async function grantVip(env, phone, planId) {
  try {
    const raw = await env.BACKUP_KV.get('account_' + phone).catch(() => null);
    if (!raw) return;
    const acct = JSON.parse(raw);
    if (planId === 'lifetime') {
      acct.vipUntil = '2100-12-31T00:00:00.000Z';
    } else {
      const days = PLANS[planId].days;
      const now = Date.now();
      const base = acct.vipUntil && new Date(acct.vipUntil).getTime() > now ? new Date(acct.vipUntil).getTime() : now;
      acct.vipUntil = new Date(base + days * 24 * 3600 * 1000).toISOString();
    }
    acct.updatedAt = new Date().toISOString();
    await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  } catch (e) {}
}
async function appendFlow(env, flow) {
  try {
    const seq = String(Date.now());
    await env.BACKUP_KV.put('pay_flow_' + flow.dateKey + '_' + seq, JSON.stringify(flow));
  } catch (e) {}
}
