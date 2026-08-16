// Cloudflare Pages Function — /admin/*（收款配置走 _payconfig.js 子模块，统一路由避免静态路由边缘 404）
import { handlePayConfig, handlePayConfigSave } from './_payconfig.js';

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

  const ADMIN_KEY = env.ADMIN_KEY || '';
  const adminKey = (body.adminKey || '').toString();

  // 密码解密（与 /auth 的加密对称：AES-256-GCM，密钥从 ADMIN_KEY 派生）
  async function deriveKey() {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kuanwei:' + ADMIN_KEY));
    return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function decryptPassword(env, enc) {
    try {
      if (!enc) return '';
      const o = JSON.parse(enc);
      if (!o || !o.iv || !o.ct) return '';
      const key = await deriveKey();
      const iv = new Uint8Array(o.iv.match(/.{2}/g).map(h => parseInt(h, 16)));
      const ct = new Uint8Array(o.ct.match(/.{2}/g).map(h => parseInt(h, 16)));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch (e) { return ''; }
  }

  // POST /admin/verify  {adminKey}  验证管理员密钥（前端不保存/不写死密钥，仅本接口校验）
  if (url.pathname.endsWith('/admin/verify')) {
    if (!ADMIN_KEY) return json({ error: '管理员密钥未配置', ok: false }, 500);
    return json({ ok: adminKey === ADMIN_KEY });
  }

  if (!ADMIN_KEY || adminKey !== ADMIN_KEY) return json({ error: '管理员密钥错误' }, 401);
  // 收款配置读/存（子模块，统一路由）
  if (url.pathname.endsWith('/admin/pay-config')) return handlePayConfig(env, json);
  if (url.pathname.endsWith('/admin/pay-config/save')) return handlePayConfigSave(body, env, json);

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
        let lastLoginAt = '';
        if (raw) {
          try {
            const acct = JSON.parse(raw);
            // 可逆密文优先解密显示；旧明文账号兜底（迁移期）
            password = (await decryptPassword(env, acct.passwordEnc)) || acct.password || '';
            // 最近登录时间（无记录的历史账号显示空 → 前端显示「暂无记录」）
            lastLoginAt = acct.lastLoginAt || '';
          } catch (e) {}
        }
        users.push({ phone, password, lastLoginAt });
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
    // 把冻结数据绑定到新手机号（保留原密码哈希/加密密文/密保，用户可直接用原密码登录）
    const acct = {
      passwordHash: tmp.data.passwordHash || '',
      passwordEnc: tmp.data.passwordEnc || '',
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

  // POST /admin/grant-vip {adminKey, phone, planId}  补发 VIP（第 5 层兜底，档位锁定）
  if (url.pathname.endsWith('/admin/grant-vip')) {
    const phone = (body.phone || '').toString().trim();
    const planId = (body.planId || '').toString();
    const PLANS = { month: 30, season: 90, year: 365, lifetime: 0 };
    if (!/^1\d{10}$/.test(phone)) return json({ error: '手机号格式不正确' }, 400);
    if (!(planId in PLANS)) return json({ error: '档位不存在' }, 400);
    const raw = await env.BACKUP_KV.get('account_' + phone);
    if (!raw) return json({ error: '该手机号未注册' }, 404);
    let acct;
    try { acct = JSON.parse(raw); } catch (e) { return json({ error: '账号数据异常' }, 500); }
    const now = Date.now();
    if (planId === 'lifetime') {
      acct.vipUntil = '2100-12-31T00:00:00.000Z';
    } else {
      const days = PLANS[planId];
      const base = acct.vipUntil && new Date(acct.vipUntil).getTime() > now ? new Date(acct.vipUntil).getTime() : now;
      acct.vipUntil = new Date(base + days * 24 * 3600 * 1000).toISOString();
    }
    acct.updatedAt = new Date().toISOString();
    await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
    // 操作留痕
    try {
      await env.BACKUP_KV.put('admin_log_' + Date.now(), JSON.stringify({
        action: 'grant-vip', phone, planId, at: new Date(now).toISOString()
      }));
    } catch (e) {}
    return json({ ok: true, vipUntil: acct.vipUntil, message: '已补发 ' + planId });
  }

  // POST /admin/reconcile {adminKey, date?}  每日对账报告（收到N/匹配M/未匹配K + 明细）
  if (url.pathname.endsWith('/admin/reconcile')) {
    try {
      const date = (body.date || '').toString() || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const flows = [];
      let cursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'pay_flow_' + date + '_', cursor, limit: 500 });
        for (const k of page.keys) {
          const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
          if (raw) { try { flows.push(JSON.parse(raw)); } catch (e) {} }
        }
        cursor = page.cursor;
      } while (cursor);
      flows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const matched = flows.filter(f => f.status === 'matched');
      const unmatched = flows.filter(f => f.status !== 'matched');
      return json({
        ok: true, date,
        total: flows.length,
        totalAmount: +flows.reduce((s, f) => s + (f.amount || 0), 0).toFixed(2),
        matched: matched.length, matchedAmount: +matched.reduce((s, f) => s + (f.amount || 0), 0).toFixed(2),
        unmatched: unmatched.length, unmatchedAmount: +unmatched.reduce((s, f) => s + (f.amount || 0), 0).toFixed(2),
        flows
      });
    } catch (e) { return json({ error: '对账失败' }, 500); }
  }

  // POST /admin/flow {adminKey, date?}  收款流水明细
  if (url.pathname.endsWith('/admin/flow')) {
    try {
      const date = (body.date || '').toString() || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const flows = [];
      let cursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'pay_flow_' + date + '_', cursor, limit: 500 });
        for (const k of page.keys) {
          const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
          if (raw) { try { flows.push(JSON.parse(raw)); } catch (e) {} }
        }
        cursor = page.cursor;
      } while (cursor);
      flows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return json({ ok: true, date, flows });
    } catch (e) { return json({ error: '查询失败' }, 500); }
  }

  // POST /admin/listen-status {adminKey}  监听设备在线状态（15 分钟无心跳 = 离线）
  if (url.pathname.endsWith('/admin/listen-status')) {
    try {
      const hbs = [];
      let cursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'listen_hb_', cursor, limit: 200 });
        hbs.push(...page.keys);
        cursor = page.cursor;
      } while (cursor);
      const now = Date.now();
      const devices = [];
      for (const k of hbs) {
        const ts = parseInt(await env.BACKUP_KV.get(k.name).catch(() => '0') || '0', 10);
        devices.push({ deviceId: k.name.replace('listen_hb_', ''), lastBeat: ts, online: now - ts < 15 * 60 * 1000 });
      }
      return json({ ok: true, devices });
    } catch (e) { return json({ error: '查询失败' }, 500); }
  }

  // POST /admin/rebates {adminKey, month?}  用户分红记录（按月/全部，按邀请人分组）
  if (url.pathname.endsWith('/admin/rebates')) {
    try {
      const month = (body.month || '').toString().trim(); // 如 2026-08；空 = 全部
      const rebates = [];
      let cursor;
      do {
        const page = await env.BACKUP_KV.list({ prefix: 'pay_rebate_', cursor, limit: 200 });
        for (const k of page.keys) {
          const raw = await env.BACKUP_KV.get(k.name).catch(() => null);
          if (raw) {
            try {
              const rb = JSON.parse(raw);
              if (month && rb.month !== month) continue;
              rebates.push(rb);
            } catch (e) {}
          }
        }
        cursor = page.cursor;
      } while (cursor);
      rebates.sort((a, b) => ((b.paidAt || '') < (a.paidAt || '') ? -1 : ((b.paidAt || '') > (a.paidAt || '') ? 1 : 0)));
      // 按邀请人分组
      const byInviter = {};
      for (const rb of rebates) {
        const k = rb.inviter || 'unknown';
        if (!byInviter[k]) byInviter[k] = [];
        byInviter[k].push(rb);
      }
      const list = Object.keys(byInviter).map(inviter => ({
        inviter,
        count: byInviter[inviter].length,
        totalAmount: +byInviter[inviter].reduce((s, r) => s + (r.amount || 0), 0).toFixed(2),
        totalRebate: +byInviter[inviter].reduce((s, r) => s + (r.rebate || 0), 0).toFixed(2),
        items: byInviter[inviter]
      })).sort((a, b) => b.totalRebate - a.totalRebate);
      return json({
        ok: true, month,
        count: rebates.length,
        totalRebate: +rebates.reduce((s, r) => s + (r.rebate || 0), 0).toFixed(2),
        list
      });
    } catch (e) { return json({ error: '查询失败' }, 500); }
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
  // 管理员重置：优先用前端传来的新哈希（如有）；否则用明文算哈希 + 加密密文，绝不存明文
  async function hashPwd(phone, pwd) {
    try {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone + ':' + pwd));
      return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }
  async function encryptPwd(env, pwd) {
    try {
      const key = await deriveKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pwd));
      return JSON.stringify({
        iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
        ct: Array.from(new Uint8Array(ct)).map(b => b.toString(16).padStart(2, '0')).join('')
      });
    } catch (e) { return ''; }
  }
  acct.passwordHash = newPasswordHash || (await hashPwd(phone, newPassword));
  acct.passwordEnc = await encryptPwd(env, newPassword);
  delete acct.password; // 清掉明文
  acct.updatedAt = new Date().toISOString();
  await env.BACKUP_KV.put('account_' + phone, JSON.stringify(acct));
  return json({ ok: true, message: '密码已重置' });
}
