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
  if (path.endsWith('/auth/delete')) return handleDelete(body, env, json);
  return json({ error: 'not found' }, 404);
}

// 账号注销（软删除）：校验密码 → 释放手机号 → 数据冻结为临时代码（供管理员恢复）
async function handleDelete(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const password = (body.password || '').toString();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (!password) return json({ error: '密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  if (acct.password !== password) return json({ error: '密码错误' }, 401);
  // 业务数据从 data_<phone> 读取（记录/筐/店面配置/uiState）；data_ 缺失时回退 account_ 内残留业务，避免注销丢数据
  let biz = { records: acct.records || [], goodsConfig: acct.goodsConfig || null, storeConfig: acct.storeConfig || null, uiState: acct.uiState || null };
  const bizRaw = await env.BACKUP_KV.get('data_' + phone);
  if (bizRaw) {
    try {
      const d = JSON.parse(bizRaw);
      biz = {
        records: d.records || biz.records,
        goodsConfig: d.goodsConfig !== undefined ? d.goodsConfig : biz.goodsConfig,
        storeConfig: d.storeConfig !== undefined ? d.storeConfig : biz.storeConfig,
        uiState: d.uiState || biz.uiState
      };
    } catch (e) {}
  }
  // 生成临时代码，冻结账号数据（保留原手机号便于管理员识别）
  const code = 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();
  const tmpKey = 'tmp_' + code;
  await env.BACKUP_KV.put(tmpKey, JSON.stringify({
    originalPhone: phone,
    deletedAt: new Date().toISOString(),
    data: {
      passwordHash: acct.passwordHash || '',
      password: acct.password || '',
      securityQ: acct.securityQ || '',
      securityA: acct.securityA || '',
      records: biz.records || [],
      goodsConfig: biz.goodsConfig || null,
      storeConfig: biz.storeConfig || null,
      uiState: biz.uiState || null
    }
  }));
  // 释放手机号（删除账号记录，手机号可重新注册）
  await env.BACKUP_KV.delete('account_' + phone);
  // 删除该账号业务数据（已冻结到临时代码）
  await env.BACKUP_KV.delete('data_' + phone);
  // 清理该账号的设备级备份（避免残留）
  if (acct.lastDeviceId) await env.BACKUP_KV.delete('device_' + acct.lastDeviceId);
  return json({ ok: true, tempCode: code });
}

// 设置/更新账号（保留已有记录数据）
async function handleSetup(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const password = (body.password || body.pwd || '').toString();
  const passwordHash = (body.passwordHash || '').toString().trim();
  const securityQ = (body.securityQ || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  const deviceId = (body.deviceId || '').toString().trim();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (password.length < 6) return json({ error: '密码无效' }, 400);
  if (!securityQ || !securityA) return json({ error: '密保问题不能为空' }, 400);
  const existingRaw = await env.BACKUP_KV.get('account_' + phone);
  let existing = {};
  if (existingRaw) { try { existing = JSON.parse(existingRaw); } catch (e) {} }
  const accountData = {
    passwordHash: passwordHash || '', // 明文唯一：未传新哈希则清空旧哈希，避免旧密码哈希残留
    password,
    securityQ,
    securityA,
    lastDeviceId: deviceId || existing.lastDeviceId || '',
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
  const password = (body.password || '').toString();
  const passwordHash = (body.passwordHash || '').toString().trim();
  const deviceId = (body.deviceId || '').toString().trim();
  const skipPwd = !!body.skipPwd;
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  // 免密恢复：仅当该设备是最近登录设备（lastDeviceId 匹配）才放行
  if (skipPwd) {
    if (!deviceId || acct.lastDeviceId !== deviceId) return json({ error: '密码错误' }, 401);
  } else {
    // 明文优先：账号存了明文密码则用明文比对；旧账号只有哈希则用哈希比对
    const plainOk = acct.password !== undefined && acct.password !== '' && password === acct.password;
    const hashOk = !plainOk && acct.passwordHash && passwordHash === acct.passwordHash;
    if (!plainOk && !hashOk) return json({ error: '密码错误' }, 401);
  }
  // 登录成功，记录该设备为最近登录设备（便于已登录设备免密恢复）
  if (deviceId && acct.lastDeviceId !== deviceId) {
    acct.lastDeviceId = deviceId;
    acct.updatedAt = new Date().toISOString();
    await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  }
  // 业务数据从 data_<phone> 读取（避免覆盖账号认证数据）；旧账号无 data_ 则用 account_ 内残留
  let bizData = {};
  const bizRaw = await env.BACKUP_KV.get('data_' + phone);
  if (bizRaw) { try { bizData = JSON.parse(bizRaw); } catch (e) {} }
  return json({
    ok: true,
    data: {
      records: bizData.records || acct.records || [],
      goodsConfig: bizData.goodsConfig || acct.goodsConfig || null,
      storeConfig: bizData.storeConfig || acct.storeConfig || null,
      securityQ: acct.securityQ || '',
      securityA: acct.securityA || '',
      backupTime: bizData.updatedAt || acct.updatedAt
    }
  });
}

// 忘记密码：密保答案 + 新密码
async function handleReset(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  const newPassword = (body.password || '').toString();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (!newPassword || newPassword.length < 6) return json({ error: '新密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  if (acct.securityA !== securityA) return json({ error: '密保答案错误' }, 401);
  acct.password = newPassword;
  // 清空旧哈希，强制只用明文比对，避免旧密码哈希残留仍能登录（安全一致）
  acct.passwordHash = '';
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true });
}
