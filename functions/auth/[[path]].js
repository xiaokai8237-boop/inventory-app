// Cloudflare Pages Function — /auth/* 账号接口
// POST /auth/setup   {phone, passwordHash, securityQ, securityA}  设置/更新账号
// POST /auth/verify  {phone, passwordHash}                        校验密码，返回数据
// POST /auth/reset   {phone, securityA, newPasswordHash}          忘记密码：密保+新密码
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

  const path = url.pathname;
  if (path.endsWith('/auth/setup')) return handleSetup(body, env, json);
  if (path.endsWith('/auth/verify')) return handleVerify(body, env, json);
  if (path.endsWith('/auth/reset')) return handleReset(body, env, json);
  return json({ error: 'not found' }, 404);
}

// 设置/更新账号（保留已有记录数据）
async function handleSetup(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const passwordHash = (body.passwordHash || '').toString().trim();
  const securityQ = (body.securityQ || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (passwordHash.length < 16) return json({ error: '密码无效' }, 400);
  if (!securityQ || !securityA) return json({ error: '密保问题不能为空' }, 400);
  const existingRaw = await env.BACKUP_KV.get('account_' + phone);
  let existing = {};
  if (existingRaw) { try { existing = JSON.parse(existingRaw); } catch (e) {} }
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

// 校验密码，返回该账号数据（含密保信息供改密用）
async function handleVerify(body, env, json) {
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
      securityQ: acct.securityQ || '',
      securityA: acct.securityA || '',
      backupTime: acct.updatedAt
    }
  });
}

// 忘记密码：密保答案 + 新密码
async function handleReset(body, env, json) {
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
