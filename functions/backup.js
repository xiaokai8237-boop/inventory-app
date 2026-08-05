// Cloudflare Pages Function — 云备份（读写 KV）
// POST /backup   body: {account?, deviceId, token?, data, userDeleted?, deleteTime?}  保存备份
// GET  /backup?account=xxx 或 ?deviceId=xxx       读取备份
// 安全：account（手机号）相关读写必须带鉴权 token（Authorization: Bearer <token>，由 /auth 签发）；
//       deviceId 为设备随机 ID（32 位 hex，不可枚举），天然作为设备级密钥，保持兼容（未登录设备兜底备份不受影响）
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
  if (request.method === 'GET') return handleGet(request, url, env, json);
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
    return handleBackupPost(request, body, env, json);
  }
  return json({ error: 'not found' }, 404);
}

// 鉴权 token 校验：Authorization: Bearer <token>，且 tok_<token> 必须归属该 account
async function verifyAccountToken(env, request, account) {
  try {
    const auth = (request.headers.get('Authorization') || '').toString();
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return false;
    const raw = await env.BACKUP_KV.get('tok_' + token);
    return !!raw && raw === account;
  } catch (e) { return false; }
}

async function handleGet(request, url, env, json) {
  const account = (url.searchParams.get('account') || '').toString().trim().toLowerCase();
  const deviceId = url.searchParams.get('deviceId');
  const key = account ? 'data_' + account : (deviceId ? 'device_' + deviceId : null);
  if (!key) return json({ error: 'missing account or deviceId' }, 400);
  // account（手机号可枚举）必须 token 鉴权；deviceId（随机 32 位）天然密钥，保持兼容
  if (account && !(await verifyAccountToken(env, request, account))) {
    return json({ error: 'unauthorized' }, 401);
  }
  let raw;
  try { raw = await env.BACKUP_KV.get(key); } catch (e) { return json({ error: 'server error' }, 500); }
  if (!raw) return json({ data: null });
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // 云端数据损坏：不返回 500 HTML，明确提示
    return json({ error: 'cloud data corrupted' }, 502);
  }
  // 数据格式校验：records 必须是数组（异常结构不返回，避免前端信任脏数据）
  if (data && typeof data === 'object' && !Array.isArray(data.records)) {
    data = Object.assign({}, data, { records: Array.isArray(data.records) ? data.records : [] });
  }
  return json({ data });
}

async function handleBackupPost(request, body, env, json) {
  const account = (body.account || '').toString().trim().toLowerCase();
  const deviceId = body.deviceId;
  const data = body.data;
  if ((!account && !deviceId) || !data) return json({ error: 'missing account/deviceId or data' }, 400);
  // account 写入必须 token 鉴权（防止任何人覆盖/清空他人云端数据）
  if (account && !(await verifyAccountToken(env, request, account))) {
    return json({ error: 'unauthorized' }, 401);
  }
  // 服务端时间戳盖章：统一所有新旧判断基于服务器时间，避免客户端时钟偏差
  if (data && typeof data === 'object') data.backupTime = new Date().toISOString();
  // 用户主动删除标记：客户端删除过数据时传 userDeleted=true，允许空记录/空店面覆盖云端
  // （否则"防数据丢失"保护会把已删数据从云端拉回，导致用户永远删不掉）
  const userDeleted = !!body.userDeleted;
  // 服务器端防数据丢失（终极保护，客户端无论新旧版本都无法绕过）：
  // ① 空数据保护：本地记录/店面为空数组但云端已有数据时，保留云端数据；
  // ② 时间保护：云端备份时间比本次新（说明其他设备/会话已写入更新数据）→ 保留云端 records/storeConfig，避免旧数据覆盖新数据
  // 例外：用户主动删除（userDeleted=true）时允许空覆盖，尊重删除意图。
  if (!userDeleted && account) {
    const key = 'data_' + account;
    let raw = null;
    try { raw = await env.BACKUP_KV.get(key); } catch (e) {}
    if (raw) {
      try {
        const cloud = JSON.parse(raw);
        // 记录保护：本地 records 空但云端有记录 → 保留云端记录
        if (Array.isArray(cloud.records) && cloud.records.length > 0 &&
            Array.isArray(data.records) && data.records.length === 0) {
          data.records = cloud.records;
        }
        // 店面保护：本地 storeConfig 空但云端有店面 → 保留云端店面
        if (Array.isArray(cloud.storeConfig) && cloud.storeConfig.length > 0 &&
            Array.isArray(data.storeConfig) && data.storeConfig.length === 0) {
          data.storeConfig = cloud.storeConfig;
        }
        // 时间保护：云端备份时间晚于本次（其他设备已写入更新数据）→ 保留云端 records + storeConfig
        // （本次自动备份可能来自未同步的旧设备/旧会话，避免"后写覆盖先写"丢失其他设备新录入）
        const cloudTime = cloud.backupTime ? new Date(cloud.backupTime).getTime() : 0;
        const thisTime = data.backupTime ? new Date(data.backupTime).getTime() : 0;
        if (cloudTime > thisTime) {
          if (Array.isArray(cloud.records) && cloud.records.length > 0) data.records = cloud.records;
          if (Array.isArray(cloud.storeConfig) && cloud.storeConfig.length > 0) data.storeConfig = cloud.storeConfig;
        }
      } catch (e) {}
    }
    try { await env.BACKUP_KV.put(key, JSON.stringify(data)); } catch (e) { return json({ error: 'storage limit exceeded' }, 507); }
  }
  if (account && userDeleted) {
    const key = 'data_' + account;
    const raw = await env.BACKUP_KV.get(key);
    let allowClear = true;
    if (raw) {
      try {
        const cloud = JSON.parse(raw);
        // 服务端时间戳：delTime 缺失时用当前服务端时间
        const delTime = body.deleteTime || new Date().toISOString();
        // 关键保护：仅当【本次上传是空数据】且云端存在删除后录入的新数据时，才阻止覆盖（保留其他设备新数据）
        // 有数据的备份（records 非空 = 用户正常录入/保存）必须正常保存，不能被删除标记拦截
        const isEmptyData = !Array.isArray(data.records) || data.records.length === 0;
        if (isEmptyData && delTime && cloud.backupTime && new Date(cloud.backupTime) > new Date(delTime)) {
          allowClear = false;
        }
      } catch (e) {}
    }
    if (allowClear) { try { await env.BACKUP_KV.put(key, JSON.stringify(data)); } catch (e) { return json({ error: 'storage limit exceeded' }, 507); } }
  }
  // 设备级备份：与账号写入解耦（独立 try-catch），账号主备份成功即可返回 ok
  if (deviceId) {
    try { await env.BACKUP_KV.put('device_' + deviceId, JSON.stringify(data)); } catch (e) { /* 设备级备份失败不阻塞主流程 */ }
  }
  return json({ ok: true });
}
