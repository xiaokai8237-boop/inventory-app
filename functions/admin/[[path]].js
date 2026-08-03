// Cloudflare Pages Function — /admin/* 管理员接口
// POST /admin/reset  {adminKey, phone, newPasswordHash}  管理员重置用户密码
// POST /admin/stats  {adminKey}                          统计注册人数
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

  // 管理员密钥从环境变量读取（不写死在代码/前端），未配置则拒绝
  const ADMIN_KEY = env.ADMIN_KEY || '';
  const adminKey = (body.adminKey || '').toString();

  // POST /admin/verify  {adminKey}  验证管理员密钥（前端不保存/不写死密钥，仅本接口校验）
  if (url.pathname.endsWith('/admin/verify')) {
    if (!ADMIN_KEY) return json({ error: '管理员密钥未配置', ok: false }, 500);
    return json({ ok: adminKey === ADMIN_KEY });
  }

  if (!ADMIN_KEY || adminKey !== ADMIN_KEY) return json({ error: '管理员密钥错误' }, 401);

  if (url.pathname.endsWith('/admin/stats')) {
    // 统计注册人数 + 用户列表（手机号+密码）+ 待恢复的注销账号（临时代码）
    try {
      const keys = [];
      let cursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'account_', cursor });
        keys.push(...page.keys);
        cursor = page.cursor;
      } while (cursor);
      const users = [];
      for (const k of keys) {
        const phone = k.name.replace('account_', '');
        const raw = await env.BACKUP_KV.get(k.name);
        let password = '';
        if (raw) { try { const acct = JSON.parse(raw); password = acct.password || ''; } catch (e) {} }
        users.push({ phone, password });
      }
      // 列出已注销待恢复的临时代码（tmp_ 前缀）
      const tmpKeys = [];
      let tmpCursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'tmp_', cursor: tmpCursor });
        tmpKeys.push(...page.keys);
        tmpCursor = page.cursor;
      } while (tmpCursor);
      const pending = [];
      for (const k of tmpKeys) {
        const code = k.name.replace('tmp_', '');
        const raw = await env.BACKUP_KV.get(k.name);
        if (raw) {
          try {
            const t = JSON.parse(raw);
            pending.push({ code, originalPhone: t.originalPhone || '', deletedAt: t.deletedAt || '' });
          } catch (e) {}
        }
      }
      return json({ ok: true, count: users.length, users, pendingDelete: pending });
    } catch (e) {
      return json({ error: '统计失败: ' + e.message }, 500);
    }
  }

  // POST /admin/restore-account {adminKey, code, newPhone}  用临时代码恢复注销账号到新手机号
  if (url.pathname.endsWith('/admin/restore-account')) {
    const code = (body.code || '').toString().trim();
    const newPhone = (body.newPhone || '').toString().trim();
    if (!code) return json({ error: '临时代码不能为空' }, 400);
    if (!/^1\d{10}$/.test(newPhone)) return json({ error: '新手机号格式不正确' }, 400);
    // 检查新手机号是否已被占用
    if (await env.BACKUP_KV.get('account_' + newPhone)) return json({ error: '该手机号已注册，无法绑定' }, 400);
    const tmpRaw = await env.BACKUP_KV.get('tmp_' + code);
    if (!tmpRaw) return json({ error: '临时代码不存在或已处理' }, 404);
    let tmp;
    try { tmp = JSON.parse(tmpRaw); } catch (e) { return json({ error: '临时代码数据异常' }, 500); }
    // 把冻结数据绑定到新手机号（保留原密码哈希/密保，用户可直接用原密码登录）
    const acct = {
      passwordHash: tmp.data.passwordHash || '',
      password: tmp.data.password || '',
      securityQ: tmp.data.securityQ || '',
      securityA: tmp.data.securityA || '',
      lastDeviceId: '',
      updatedAt: new Date().toISOString()
    };
    await env.BACKUP_KV.put('account_' + newPhone, JSON.stringify(acct));
    // 业务数据独立存 data_<newPhone>，避免覆盖账号认证数据
    await env.BACKUP_KV.put('data_' + newPhone, JSON.stringify({
      records: tmp.data.records || [],
      goodsConfig: tmp.data.goodsConfig || null,
      storeConfig: tmp.data.storeConfig || null,
      uiState: tmp.data.uiState || null,
      updatedAt: new Date().toISOString()
    }));
    // 删除临时代码（恢复完成）
    await env.BACKUP_KV.delete('tmp_' + code);
    return json({ ok: true, message: '已恢复 ' + tmp.originalPhone + ' 的数据到 ' + newPhone });
  }

  // POST /admin/delete-temp {adminKey, code}  彻底删除注销账号（临时代码对应数据）
  if (url.pathname.endsWith('/admin/delete-temp')) {
    const code = (body.code || '').toString().trim();
    if (!code) return json({ error: '临时代码不能为空' }, 400);
    await env.BACKUP_KV.delete('tmp_' + code);
    return json({ ok: true, message: '已彻底删除该注销账号数据' });
  }

  // POST /admin/delete-account {adminKey, phones:[]}  删除指定账号（保留白名单外的）
  if (url.pathname.endsWith('/admin/delete-account')) {
    const phones = Array.isArray(body.phones) ? body.phones : [];
    const keep = new Set(['15558088023', '17688560476']); // 保留账号白名单
    const valid = phones.filter(p => /^1\d{10}$/.test(p));
    let deleted = 0;
    const errors = [];
    for (const p of valid) {
      if (keep.has(p)) { errors.push(p + '(保留)'); continue; }
      // 完整删除：账号认证 + 业务数据 + 设备备份（避免孤儿数据）
      const raw = await env.BACKUP_KV.get('account_' + p);
      if (raw) { try { const a = JSON.parse(raw); if (a.lastDeviceId) await env.BACKUP_KV.delete('device_' + a.lastDeviceId); } catch (e) {} }
      await env.BACKUP_KV.delete('account_' + p);
      await env.BACKUP_KV.delete('data_' + p);
      deleted++;
    }
    return json({ ok: true, deleted, skipped: errors });
  }

  if (!url.pathname.endsWith('/admin/reset')) return json({ error: 'not found' }, 404);

  const phone = (body.phone || '').toString().trim();
  const newPasswordHash = (body.newPasswordHash || '').toString().trim();
  const newPassword = (body.password || '').toString();
  if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
  if (newPassword.length < 6) return json({ error: '新密码无效' }, 400);
  const raw = await env.BACKUP_KV.get('account_' + phone);
  if (!raw) return json({ error: '该手机号未设置过密码' }, 404);
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
  // 明文唯一：若传了新哈希则更新，否则清空旧哈希，避免旧密码哈希残留仍能登录（安全一致）
  acct.passwordHash = newPasswordHash || '';
  acct.password = newPassword;
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true, message: '密码已重置' });
}
