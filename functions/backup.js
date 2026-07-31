// Cloudflare Pages Function — 云备份 + 账号体系
// 备份接口：
//   POST /backup   body: {account?, deviceId, data}  保存备份
//   GET  /backup?account=xxx 或 ?deviceId=xxx       读取备份
// 账号接口：
//   POST /auth/setup   {phone, passwordHash, securityQ, securityA}        设置/更新账号信息
//   POST /auth/verify  {phone, passwordHash}                              校验密码，返回该账号数据
//   POST /auth/reset   {phone, securityA, newPasswordHash}                忘记密码：密保答案+新密码
//   POST /admin/reset  {adminKey, phone, newPasswordHash}                 管理员重置密码
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
    const path = url.pathname;
    if (path.endsWith('/auth/setup')) return handleAuthSetup(body, env, json);
    if (path.endsWith('/auth/verify')) return handleAuthVerify(body, env, json);
    if (path.endsWith('/auth/reset')) return handleAuthReset(body, env, json);
    if (path.endsWith('/admin/reset')) return handleAdminReset(body, env, json);
    return handleBackupPost(body, env, json);
  }
  return json({ error: 'not found' }, 404);
}

// ===== 备份读写 =====
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

// ===== 账号设置 =====
async function handleAuthSetup(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const passwordHash = (body.passwordHash || '').toString().trim();
  const securityQ = (body.securityQ || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (passwordHash.length < 16) return json({ error: '密码无效' }, 400);
  if (!securityQ || !securityA) return json({ error: '密保问题不能为空' }, 400);
  // 读取已有账号数据（设置/更新密码时保留已有记录）
  const existingRaw = await env.BACKUP_KV.get('account_' + phone);
  let existing = {};
  if (existingRaw) {
    try { existing = JSON.parse(existingRaw); } catch (e) {}
  }
  const accountData = {
    passwordHash,
    securityQ,
    securityA,
    updatedAt: new Date().toISOString(),
    records: existing.records || [],
    goodsConfig: existing.goodsConfig || null,
    storeConfig: existing.storeConfig || null
  };
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(accountData));
  return json({ ok: true });
}

// ===== 密码校验（返回数据） =====
async function handleAuthVerify(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const passwordHash = (body.passwordHash || '').toString().trim();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  if (acct.passwordHash !== passwordHash) return json({ error: '密码错误' }, 401);
  return json({
    ok: true,
    data: {
      records: acct.records || [],
      goodsConfig: acct.goodsConfig || null,
      storeConfig: acct.storeConfig || null,
      backupTime: acct.updatedAt
    }
  });
}

// ===== 忘记密码：密保答案 + 新密码 =====
async function handleAuthReset(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  const newPasswordHash = (body.newPasswordHash || '').toString().trim();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (newPasswordHash.length < 16) return json({ error: '新密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  if (acct.securityA !== securityA) return json({ error: '密保答案错误' }, 401);
  acct.passwordHash = newPasswordHash;
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true });
}

// ===== 管理员重置密码 =====
const ADMIN_KEY = '8023.520';
async function handleAdminReset(body, env, json) {
  const adminKey = (body.adminKey || '').toString();
  const phone = (body.phone || '').toString().trim();
  const newPasswordHash = (body.newPasswordHash || '').toString().trim();
  if (adminKey !== ADMIN_KEY) return json({ error: '管理员密钥错误' }, 401);
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
