// Cloudflare Pages Function — 支付宝 H5 支付（手机网站支付）
// POST /pay/create  {token, planId} → {ok, orderNo, payUrl}   下单（RSA2 签名）
// POST /pay/notify  支付宝异步回调（验签+幂等+发VIP）→ 返回 success
// GET  /pay/status?token=&orderNo= → {ok, status, vipUntil}   订单查询（前端轮询）
// 环境变量：ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY(PKCS8) / ALIPAY_PUBLIC_KEY / PAY_NOTIFY_BASE(可选，默认 pages.dev)
const GATEWAY = 'https://openapi.alipay.com/gateway.do';
const PLANS = {
  month:    { days: 30,  subject: '物流筐VIP-月卡' },
  season:   { days: 90,  subject: '物流筐VIP-季卡' },
  year:     { days: 365, subject: '物流筐VIP-年卡' },
  lifetime: { days: 0,   subject: '物流筐VIP-终身卡' }
};

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
  const path = url.pathname;

  if (request.method === 'POST' && path.endsWith('/pay/create')) return handleCreate(request, env, json);
  if (request.method === 'POST' && path.endsWith('/pay/notify')) return handleNotify(request, env, url);
  if (request.method === 'GET' && path.endsWith('/pay/status')) return handleStatus(request, env, url, json);
  // 监听版（经营码+监听）：下单 / 公共收款配置
  if (request.method === 'POST' && path.endsWith('/pay/order/create')) return handleOrderCreate(request, env, json);
  if (request.method === 'GET' && path.endsWith('/pay/order/config')) return handleOrderConfig(env, json);
  return json({ error: 'not found' }, 404);
}

// ============ 监听版下单（经营码 + 通知监听自动开通） ============
async function handleOrderCreate(request, env, json) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = (body.token || '').toString();
    const phone = token ? await env.BACKUP_KV.get('tok_' + token).catch(() => null) : null;
    if (!phone) return json({ error: '未登录或登录已过期' }, 401);
    const plan = PLANS[body.planId];
    if (!plan) return json({ error: '档位不存在' }, 400);

    const baseAmount = getAmount(body.planId);
    // 尾数防撞单：同金额未支付订单存在则 +0.01，最多 +0.09
    let amount = baseAmount;
    for (let i = 1; i <= 9; i++) {
      if (!(await hasPendingAmount(env, amount))) break;
      amount = +(baseAmount + i * 0.01).toFixed(2);
    }
    const orderNo = 'KW' + Date.now() + String(Math.floor(Math.random() * 900 + 100));
    const order = {
      orderNo, phone, planId: body.planId, amount,
      subject: plan.subject, status: 'created',
      createdAt: new Date().toISOString(), channel: 'listen'
    };
    await env.BACKUP_KV.put('pay_order_' + orderNo, JSON.stringify(order));
    // 精简返回：收款码/客服信息体积大（合计约 400KB base64），单独走 /pay/order/config 拉取，避免手机端大响应卡"正在创建订单"
    return json({ ok: true, orderNo, amount });
  } catch (e) { return json({ error: '下单失败' }, 500); }
}

// ============ 公共收款配置（用户下单页展示收款码） ============
async function handleOrderConfig(env, json) {
  const cfg = await loadPayConfig(env);
  return json({ ok: true, config: cfg });
}

// ============ 工具（监听版） ============
async function hasPendingAmount(env, amount) {
  try {
    let cursor;
    do {
      const page = await env.BACKUP_KV.list({ prefix: 'pay_order_', cursor, limit: 200 });
      for (const k of page.keys) {
        const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
        if (!raw) continue;
        try {
          const o = JSON.parse(raw);
          if (o.status === 'created' && Math.abs(o.amount - amount) < 0.001) return true;
        } catch (e) {}
      }
      cursor = page.cursor;
    } while (cursor);
  } catch (e) {}
  return false;
}
async function loadPayConfig(env) {
  const raw = await env.BACKUP_KV.get('pay_config').catch(() => null);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { wxQr: '', alipayQr: '', kfQr: '', kfWx: '', kfHours: '凌晨 1:00 — 下午 3:00' };
}

// ============ 下单 ============
async function handleCreate(request, env, json) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = (body.token || '').toString();
    const phone = token ? await env.BACKUP_KV.get('tok_' + token).catch(() => null) : null;
    if (!phone) return json({ error: '未登录或登录已过期' }, 401);
    const plan = PLANS[body.planId];
    if (!plan) return json({ error: '档位不存在' }, 400);
    if (!env.ALIPAY_APP_ID || !env.ALIPAY_PRIVATE_KEY) return json({ error: '支付宝尚未配置，请联系管理员' }, 503);

    const orderNo = 'KV' + Date.now() + String(Math.floor(Math.random() * 900 + 100));
    const amount = getAmount(body.planId);
    const order = { orderNo, phone, planId: body.planId, amount, subject: plan.subject, status: 'created', createdAt: new Date().toISOString() };
    await env.BACKUP_KV.put('pay_order_' + orderNo, JSON.stringify(order));

    const notifyBase = env.PAY_NOTIFY_BASE || 'https://inventory-app-9ql.pages.dev';
    const params = {
      app_id: env.ALIPAY_APP_ID,
      method: 'alipay.trade.wap.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(),
      version: '1.0',
      notify_url: notifyBase + '/pay/notify',
      return_url: notifyBase + '/?pay_ret=1&out_trade_no=' + orderNo,
      biz_content: JSON.stringify({
        out_trade_no: orderNo,
        total_amount: amount.toFixed(2),
        subject: plan.subject,
        product_code: 'QUICK_WAP_WAY'
      })
    };
    const sign = await rsa2Sign(env.ALIPAY_PRIVATE_KEY, buildSignStr(params));
    params.sign = sign;
    const payUrl = GATEWAY + '?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    return json({ ok: true, orderNo, payUrl });
  } catch (e) { return json({ error: '下单失败' }, 500); }
}

// ============ 异步回调（唯一可信支付结果） ============
async function handleNotify(request, env, url) {
  const form = await request.formData().catch(() => null);
  if (!form) return new Response('fail', { status: 200 });
  const params = {};
  for (const [k, v] of form.entries()) params[k] = v.toString();
  try {
    if (!env.ALIPAY_PUBLIC_KEY) return new Response('fail', { status: 200 });
    // 验签
    const signStr = Object.keys(params).filter(k => k !== 'sign' && k !== 'sign_type').sort()
      .map(k => k + '=' + params[k]).join('&');
    const ok = await rsa2Verify(env.ALIPAY_PUBLIC_KEY, signStr, params.sign || '');
    if (!ok) return new Response('fail', { status: 200 });
    // 业务校验：成功状态 + 订单存在 + 幂等 + 金额一致
    if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') return new Response('success', { status: 200 });
    const raw = await env.BACKUP_KV.get('pay_order_' + params.out_trade_no).catch(() => null);
    if (!raw) return new Response('success', { status: 200 });
    const order = JSON.parse(raw);
    if (order.status === 'paid') return new Response('success', { status: 200 }); // 幂等
    if (Math.abs(parseFloat(params.total_amount) - order.amount) > 0.01) return new Response('fail', { status: 200 });
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.tradeNo = params.trade_no || '';
    await env.BACKUP_KV.put('pay_order_' + order.orderNo, JSON.stringify(order));
    await grantVip(env, order.phone, order.planId);
    return new Response('success', { status: 200 });
  } catch (e) { return new Response('fail', { status: 200 }); }
}

// ============ 订单查询 ============
async function handleStatus(request, env, url, json) {
  const auth = (request.headers.get('Authorization') || '').toString();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('token') || '');
  const phone = token ? await env.BACKUP_KV.get('tok_' + token).catch(() => null) : null;
  if (!phone) return json({ error: '未登录或登录已过期' }, 401);
  const orderNo = url.searchParams.get('orderNo') || '';
  const raw = await env.BACKUP_KV.get('pay_order_' + orderNo).catch(() => null);
  if (!raw) return json({ error: '订单不存在' }, 404);
  const order = JSON.parse(raw);
  if (order.phone !== phone) return json({ error: '无权访问该订单' }, 403);
  const acct = JSON.parse(await env.BACKUP_KV.get('account_' + phone).catch(() => 'null') || 'null');
  return json({ ok: true, status: order.status, vipUntil: acct && acct.vipUntil ? acct.vipUntil : '' });
}

// ============ 工具 ============
function getAmount(planId) {
  const p = { month: 12.8, season: 28.8, year: 88, lifetime: 158 };
  return p[planId] || 0;
}
function alipayTimestamp(d) {
  const b = new Date((d || new Date()).getTime() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return b.getUTCFullYear() + '-' + p(b.getUTCMonth() + 1) + '-' + p(b.getUTCDate()) + ' ' +
         p(b.getUTCHours()) + ':' + p(b.getUTCMinutes()) + ':' + p(b.getUTCSeconds());
}
function buildSignStr(params) {
  return Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
}
async function rsa2Sign(pemKey, content) {
  const b64 = pemKey.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----|\s/g, '');
  const keyData = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(content));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function rsa2Verify(pemKey, content, signB64) {
  const b64 = pemKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const keyData = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Uint8Array.from(atob(signB64), c => c.charCodeAt(0)), new TextEncoder().encode(content));
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
