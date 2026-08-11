// 需求239：管理员界面显示用户最近登录时间
// 验证：①登录成功写入 lastLoginAt ②同一设备重复登录也更新 ③admin/stats 返回 lastLoginAt ④历史账号(无记录)返回空
import { readFileSync } from 'fs';
const authSrc = readFileSync('functions/auth/[[path]].js', 'utf8');
const adminSrc = readFileSync('functions/admin/[[path]].js', 'utf8');
const authMod = await import('data:text/javascript;base64,' + Buffer.from(authSrc).toString('base64'));
const adminMod = await import('data:text/javascript;base64,' + Buffer.from(adminSrc).toString('base64'));

class MockKV {
  constructor() { this.map = new Map(); }
  async put(k, v) { this.map.set(k, v); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async list({ prefix }) { return { keys: [...this.map.keys()].filter(k => k.startsWith(prefix)).map(k => ({ name: k })), cursor: undefined }; }
}
const kv = new MockKV();
const env = { BACKUP_KV: kv, ADMIN_KEY: 'test-admin-key' };

async function callAuth(body) {
  const req = { request: { method: 'POST', url: 'https://x/auth/verify', json: () => Promise.resolve(body) }, env };
  return await (await authMod.onRequest(req)).json();
}
async function callAdmin(path, body) {
  const req = { request: { method: 'POST', url: 'https://x' + path, json: () => Promise.resolve(body) }, env };
  return await (await adminMod.onRequest(req)).json();
}

let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

// 预置账号（含密码哈希；用 handleSetup 先建，或直接写 account_）
// 直接用 setup 注册用户（密码 Abc@123456）
const setupReq = { request: { method: 'POST', url: 'https://x/auth/setup', json: () => Promise.resolve({ phone: '13800138000', password: 'Abc@123456', securityQ: 'q', securityA: 'a', deviceId: 'dev-A' }) }, env };
await (await authMod.onRequest(setupReq)).json();

console.log('=== 1. 首次登录写入 lastLoginAt ===');
const r1 = await callAuth({ phone: '13800138000', password: 'Abc@123456', deviceId: 'dev-A' });
check('登录成功', r1.ok === true, JSON.stringify(r1));
const acct1 = JSON.parse(await kv.get('account_13800138000'));
check('lastLoginAt 已写入', !!acct1.lastLoginAt, 'lastLoginAt=' + acct1.lastLoginAt);
const t1 = new Date(acct1.lastLoginAt).getTime();
check('lastLoginAt 为有效ISO时间', !isNaN(t1) && t1 <= Date.now() + 60000, acct1.lastLoginAt);
// 记录第一次时间
const firstLogin = acct1.lastLoginAt;

console.log('=== 2. 同一设备重复登录也更新 ===');
await new Promise(r => setTimeout(r, 1100)); // 等 1.1s 让时间可区分
await callAuth({ phone: '13800138000', password: 'Abc@123456', deviceId: 'dev-A' });
const acct2 = JSON.parse(await kv.get('account_13800138000'));
check('同设备再登录 lastLoginAt 更新', acct2.lastLoginAt !== firstLogin, firstLogin + ' -> ' + acct2.lastLoginAt);

console.log('=== 3. admin/stats 返回 lastLoginAt ===');
const stats = await callAdmin('/admin/stats', { adminKey: 'test-admin-key' });
check('stats ok', stats.ok === true, JSON.stringify(stats).slice(0, 120));
const u = (stats.users || []).find(x => x.phone === '13800138000');
check('users 含 lastLoginAt 字段', !!u && !!u.lastLoginAt, JSON.stringify(u));

console.log('=== 4. 历史账号(无 lastLoginAt)返回空 ===');
// 预置一个无 lastLoginAt 的老账号
kv.map.set('account_13900139000', JSON.stringify({ passwordHash: 'x', passwordEnc: '', password: 'old', securityQ: 'q', securityA: 'a' }));
const stats2 = await callAdmin('/admin/stats', { adminKey: 'test-admin-key' });
const u2 = (stats2.users || []).find(x => x.phone === '13900139000');
check('历史账号 lastLoginAt 为空串', u2 && u2.lastLoginAt === '', JSON.stringify(u2));

console.log('=== 5. 无管理员密钥 → 401 ===');
const noAuth = await callAdmin('/admin/stats', { adminKey: '' });
check('无密钥拒绝', noAuth.error && noAuth.error.indexOf('密钥错误') >= 0, JSON.stringify(noAuth).slice(0, 80));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
