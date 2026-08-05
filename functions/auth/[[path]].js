// Cloudflare Pages Function — /auth/* 账号接口
// POST /auth/setup   {phone, password, securityQ, securityA, deviceId}  设置/更新账号（密码哈希存储）
// POST /auth/verify  {phone, password, deviceId, skipPwd}               校验密码，返回数据+token
// POST /auth/reset   {phone, securityA, password}                       忘记密码：密保+新密码（哈希存储）
// POST /auth/delete  {phone, password, deviceId}                        注销（软删除，临时代码 30 天 TTL）
// 安全说明：密码不再明文存储——存储 SHA-256(phone + ':' + password) 哈希；旧明文账号首次登录成功后自动迁移
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

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }

  const path = url.pathname;
  if (path.endsWith('/auth/setup')) return handleSetup(body, env, json);
  if (path.endsWith('/auth/verify')) return handleVerify(body, env, json);
  if (path.endsWith('/auth/reset')) return handleReset(body, env, json);
  if (path.endsWith('/auth/delete')) return handleDelete(body, env, json);
  return json({ error: 'not found' }, 404);
}

// ===== 密码哈希（SHA-256 + 账号盐，登录校验用） =====
async function hashPassword(phone, password) {
  try {
    const data = new TextEncoder().encode(phone + ':' + password);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}

// ===== 密码可逆加密（AES-256-GCM，管理员可解密查看；存储非明文） =====
// 密钥从管理员密钥（env.ADMIN_KEY）派生，不新增环境变量；管理员接口用同一派生密钥解密
async function deriveKey(env) {
  const adminKey = env.ADMIN_KEY || 'kuanwei_default';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kuanwei:' + adminKey));
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptPassword(env, password) {
  try {
    const key = await deriveKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));
    return JSON.stringify({
      iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
      ct: Array.from(new Uint8Array(ct)).map(b => b.toString(16).padStart(2, '0')).join('')
    });
  } catch (e) { return ''; }
}
async function decryptPassword(env, enc) {
  try {
    if (!enc) return '';
    const o = JSON.parse(enc);
    if (!o || !o.iv || !o.ct) return '';
    const key = await deriveKey(env);
    const iv = new Uint8Array(o.iv.match(/.{2}/g).map(h => parseInt(h, 16)));
    const ct = new Uint8Array(o.ct.match(/.{2}/g).map(h => parseInt(h, 16)));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (e) { return ''; }
}

// ===== 鉴权 token 签发/校验 =====
// token 存 KV tok_<token> = phone（TTL 30 天），用于 /backup 接口鉴权
async function issueToken(env, phone) {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await env.BACKUP_KV.put('tok_' + token, phone, { expirationTtl: 30 * 24 * 3600 }); // 30 天
    return token;
  } catch (e) { return ''; }
}
async function verifyToken(env, token, phone) {
  if (!token) return false;
  const raw = await env.BACKUP_KV.get('tok_' + token).catch(() => null);
  return !!raw && raw === phone;
}

// 账号注销（软删除）：校验密码 → 释放手机号 → 数据冻结为临时代码（供管理员恢复，30 天 TTL）
async function handleDelete(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const password = (body.password || '').toString();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (!password) return json({ error: '密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  // 密码校验：哈希优先（新账号），明文兼容（旧账号迁移期）
  const inputHash = await hashPassword(phone, password);
  const pwdOk = (acct.passwordHash && acct.passwordHash === inputHash) ||
                (!acct.passwordHash && acct.password === password);
  if (!pwdOk) return json({ error: '密码错误' }, 401);
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
  // 生成临时代码（16 位大写字母+数字，空间 36^16 不可枚举），冻结账号数据 30 天
  const code = 'T' + Array.from(crypto.getRandomValues(new Uint8Array(15))).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const tmpKey = 'tmp_' + code;
  await env.BACKUP_KV.put(tmpKey, JSON.stringify({
    originalPhone: phone,
    deletedAt: new Date().toISOString(),
    data: {
      passwordHash: acct.passwordHash || '',
      passwordEnc: acct.passwordEnc || '',
      securityQ: acct.securityQ || '',
      securityA: acct.securityA || '',
      records: biz.records || [],
      goodsConfig: biz.goodsConfig || null,
      storeConfig: biz.storeConfig || null,
      uiState: biz.uiState || null
    }
  }), { expirationTtl: 30 * 24 * 3600 }); // 30 天过期
  // 释放手机号（删除账号记录，手机号可重新注册）
  await env.BACKUP_KV.delete('account_' + phone);
  // 删除该账号业务数据（已冻结到临时代码）
  await env.BACKUP_KV.delete('data_' + phone);
  // 清理该账号的鉴权 token
  const token = (body.token || '').toString().trim();
  if (token) await env.BACKUP_KV.delete('tok_' + token).catch(() => {});
  // 清理该账号的设备级备份（避免残留）
  if (acct.lastDeviceId) await env.BACKUP_KV.delete('device_' + acct.lastDeviceId);
  return json({ ok: true, tempCode: code });
}

// 设置/更新账号（密码哈希存储；保留已有记录数据）
async function handleSetup(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const password = (body.password || body.pwd || '').toString();
  const securityQ = (body.securityQ || '').toString().trim();
  const securityA = (body.securityA || '').toString().trim().toLowerCase();
  const deviceId = (body.deviceId || '').toString().trim();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (password.length < 6) return json({ error: '密码无效' }, 400);
  if (!securityQ || !securityA) return json({ error: '密保问题不能为空' }, 400);
  const existingRaw = await env.BACKUP_KV.get('account_' + phone);
  let existing = {};
  if (existingRaw) { try { existing = JSON.parse(existingRaw); } catch (e) {} }
  const passwordHash = await hashPassword(phone, password);
  const passwordEnc = await encryptPassword(env, password); // 可逆加密（管理员解密查看用），非明文
  const accountData = {
    passwordHash, // 登录校验哈希
    passwordEnc,  // 可逆加密密文（管理员可解密查看）
    securityQ,
    securityA,
    lastDeviceId: deviceId || existing.lastDeviceId || '',
    updatedAt: new Date().toISOString(),
    records: existing.records || [],
    goodsConfig: existing.goodsConfig || null,
    storeConfig: existing.storeConfig || null
  };
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(accountData));
  // 签发鉴权 token（备份接口用）
  const token = await issueToken(env, phone);
  return json({ ok: true, token });
}

// 校验密码，返回该账号数据（含密保信息供改密用）+ 鉴权 token
// 旧明文账号：登录成功后自动把明文迁移为哈希存储（渐进安全升级）
async function handleVerify(body, env, json) {
  const phone = (body.phone || '').toString().trim();
  const password = (body.password || '').toString();
  const deviceId = (body.deviceId || '').toString().trim();
  const skipPwd = !!body.skipPwd;
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  let verified = false;
  if (skipPwd) {
    // 免密恢复：仅当该设备是最近登录设备（lastDeviceId 匹配）才放行
    if (deviceId && acct.lastDeviceId === deviceId) verified = true;
  } else {
    const inputHash = await hashPassword(phone, password);
    if (acct.passwordHash) {
      // 新账号：哈希比对；成功后刷新可逆密文（保证活跃账号可被管理员查看）
      if (acct.passwordHash === inputHash) {
        verified = true;
        const enc = await encryptPassword(env, password);
        if (enc && enc !== acct.passwordEnc) {
          acct.passwordEnc = enc;
          acct.updatedAt = new Date().toISOString();
          await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
        }
      }
    } else if (acct.password !== undefined && acct.password !== '') {
      // 旧账号明文：明文比对，成功后自动迁移为哈希 + 加密存储（一次登录永久升级）
      if (acct.password === password) {
        verified = true;
        acct.passwordHash = inputHash;
        acct.passwordEnc = await encryptPassword(env, password);
        delete acct.password; // 清掉明文
        acct.updatedAt = new Date().toISOString();
        await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
      }
    }
  }
  if (!verified) return json({ error: '密码错误' }, 401);
  // 登录成功，记录该设备为最近登录设备（便于已登录设备免密恢复）
  if (deviceId && acct.lastDeviceId !== deviceId) {
    acct.lastDeviceId = deviceId;
    acct.updatedAt = new Date().toISOString();
    await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  }
  // 签发鉴权 token（每次成功验证刷新，30 天有效）
  const token = await issueToken(env, phone);
  // 业务数据从 data_<phone> 读取（避免覆盖账号认证数据）；旧账号无 data_ 则用 account_ 内残留
  let bizData = {};
  const bizRaw = await env.BACKUP_KV.get('data_' + phone);
  if (bizRaw) { try { bizData = JSON.parse(bizRaw); } catch (e) {} }
  return json({
    ok: true,
    token,
    data: {
      records: bizData.records || acct.records || [],
      goodsConfig: bizData.goodsConfig || acct.goodsConfig || null,
      storeConfig: bizData.storeConfig || acct.storeConfig || null,
      securityQ: acct.securityQ || '',
      securityA: acct.securityA || '',
      // 修复：返回真实备份时间（data_ 里是 backupTime，不是 updatedAt）
      backupTime: bizData.backupTime || bizData.updatedAt || acct.updatedAt || ''
    }
  });
}

// 忘记密码：密保答案 + 新密码（哈希存储）
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
  const newHash = await hashPassword(phone, newPassword);
  acct.passwordHash = newHash; // 只存哈希
  acct.passwordEnc = await encryptPassword(env, newPassword); // 可逆密文（管理员可解密查看）
  delete acct.password;         // 清掉可能残留的明文
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true });
}
