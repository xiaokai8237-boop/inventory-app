// Cloudflare Pages Function — 云备份（读写 KV）
// POST /backup   body: {account?, deviceId, data}  保存备份
// GET  /backup?account=xxx 或 ?deviceId=xxx       读取备份
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
    return handleBackupPost(body, env, json);
  }
  return json({ error: 'not found' }, 404);
}

// 注意：业务数据改用 data_<account> 前缀存储，避免与 auth 的 account_<phone>（账号认证+密码）冲突覆盖
async function handleGet(url, env, json) {
  const account = (url.searchParams.get('account') || '').toString().trim().toLowerCase();
  const deviceId = url.searchParams.get('deviceId');
  const key = account ? 'data_' + account : (deviceId ? 'device_' + deviceId : null);
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
  // 用户主动删除标记：客户端删除过数据时传 userDeleted=true，允许空记录/空店面覆盖云端
  // （否则"防数据丢失"保护会把已删数据从云端拉回，导致用户永远删不掉）
  const userDeleted = !!body.userDeleted;
  // 服务器端防数据丢失（终极保护，客户端无论新旧版本都无法绕过）：
  // 本地记录/店面为空数组但云端已有数据时，保留云端数据，避免"清缓存/换设备/旧版本"上传空值覆盖云端。
  // 例外：用户主动删除（userDeleted=true）时允许空覆盖，尊重删除意图。
  if (!userDeleted && account) {
    const key = 'data_' + account;
    const raw = await env.BACKUP_KV.get(key);
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
      } catch (e) {}
    }
    await env.BACKUP_KV.put(key, JSON.stringify(data));
  }
  if (account && userDeleted) {
    const key = 'data_' + account;
    const raw = await env.BACKUP_KV.get(key);
    let allowClear = true;
    if (raw) {
      try {
        const cloud = JSON.parse(raw);
        const delTime = body.deleteTime;
        // 关键保护：云端备份时间【晚于】用户删除时间 → 云端是删除后录入的新数据（可能来自其他设备）
        // → 不允许本设备用空数据覆盖，避免"删一条把别人新数据全清掉"
        if (delTime && cloud.backupTime && cloud.backupTime > delTime) allowClear = false;
      } catch (e) {}
    }
    if (allowClear) await env.BACKUP_KV.put(key, JSON.stringify(data));
  }
  if (deviceId) await env.BACKUP_KV.put('device_' + deviceId, JSON.stringify(data));
  return json({ ok: true });
}
