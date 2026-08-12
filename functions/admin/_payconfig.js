// Cloudflare Pages Function 子模块 — /admin/pay-config 读 + /admin/pay-config/save 写（被 [[path]].js import，非独立路由）
// 说明：不建独立静态路由文件（此前 pay-config-save.js 静态路由在部分边缘节点未命中 → 404），统一走 [[path]] 兜底路由

const MAX_IMG = 2_000_000; // 单图 base64 上限

// POST /admin/pay-config {adminKey} → {ok, config}  读收款配置
export async function handlePayConfig(env, json) {
  const raw = await env.BACKUP_KV.get('pay_config').catch(() => null);
  if (raw) { try { return json({ ok: true, config: JSON.parse(raw) }); } catch (e) {} }
  return json({ ok: true, config: { wxQr: '', alipayQr: '', kfQr: '', kfWx: '', kfHours: '凌晨 1:00 — 下午 3:00' } });
}

// POST /admin/pay-config/save {adminKey, wxQr, alipayQr, kfQr, kfWx, kfHours} → {ok, verified, message}  存收款配置（先校验原始长度，防截断绕过）
export async function handlePayConfigSave(body, env, json) {
  for (const k of ['wxQr', 'alipayQr', 'kfQr']) {
    if ((body[k] || '').toString().length > MAX_IMG) return json({ error: k + ' 图片过大（压缩后仍超限）' }, 400);
  }
  const cfg = {
    wxQr: (body.wxQr || '').toString().slice(0, MAX_IMG),
    alipayQr: (body.alipayQr || '').toString().slice(0, MAX_IMG),
    kfQr: (body.kfQr || '').toString().slice(0, MAX_IMG),
    kfWx: (body.kfWx || '').toString().slice(0, 100),
    kfHours: (body.kfHours || '凌晨 1:00 — 下午 3:00').toString().slice(0, 100),
    updatedAt: new Date().toISOString()
  };
  try {
    await env.BACKUP_KV.put('pay_config', JSON.stringify(cfg));
  } catch (e) {
    return json({ error: '云端存储失败，请重试（' + (e && e.message ? e.message : 'KV error') + '）' }, 500);
  }
  let verified = false;
  try {
    const back = await env.BACKUP_KV.get('pay_config').catch(() => null);
    if (back && back.length > 10) verified = true;
  } catch (e) {}
  try {
    await env.BACKUP_KV.put('admin_log_' + Date.now(), JSON.stringify({ action: 'pay-config-save', at: new Date().toISOString() }));
  } catch (e) {}
  return json({ ok: true, verified, message: verified ? '收款配置已保存，全局生效' : '已保存（存储验证待确认）' });
}
