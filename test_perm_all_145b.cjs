// #145b 一键开启所有权限 + 通知原生状态 + 去新字测试
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18712;
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(f)); }
  catch(e) { res.writeHead(404); res.end(); }
});
let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_perm_guide_seen', '1');
    localStorage.setItem('kuanwei_loc_ok', '1');
    localStorage.setItem(scopeKey('kuanwei_notify_settings'), '');
    // mock：通知原生状态查询 + Capacitor 插件
    window.Notification = { permission: 'granted', requestPermission: function() { return Promise.resolve('granted'); } };
    window.Capacitor = { Plugins: { ArrivalMonitor: {
      notificationEnabled: () => Promise.resolve({ enabled: true }),  // 系统通知真实已开
      requestBatteryIgnore: () => { window.__calls = window.__calls || []; window.__calls.push('battery'); return Promise.resolve(); },
      requestPermissions: () => { window.__calls = window.__calls || []; window.__calls.push('perm'); return Promise.resolve(); },
      openAutoStart: () => { window.__calls = window.__calls || []; window.__calls.push('autostart'); return Promise.resolve(); },
      openSettings: (k) => { window.__calls = window.__calls || []; window.__calls.push('settings:' + k); return Promise.resolve(); }
    } } };
  });
  await page.waitForTimeout(300);

  // ===== 1. 管理页权限管理入口无「新」字 =====
  await page.evaluate(() => { switchPage('manage'); });
  await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('权限管理'));
    return { has: !!b, hasNew: b ? b.textContent.includes('新') : false };
  });
  T('权限管理入口存在', r1.has, '');
  T('入口无「新」字（已去掉）', !r1.hasNew, JSON.stringify(r1));

  // ===== 2. 权限管理页：一键按钮 + 5 行 + 引导小字入口 =====
  await page.evaluate(() => { openPermPage(); });
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => {
    const optBtn = document.getElementById('pmOptAll');
    const rows = [...document.querySelectorAll('#permPageRows .pm-row')];
    const mini = document.querySelector('#page-perm .pm-guide-mini');
    return {
      active: document.getElementById('page-perm').classList.contains('active'),
      optName: document.getElementById('pmOptAllName')?.textContent.trim(),
      optSvg: !!optBtn?.querySelector('.oa-ico svg'),
      rowCount: rows.length,
      names: rows.map(r => (r.querySelector('.pr-name')?.textContent || '').trim()),
      states: rows.map(r => r.querySelector('.pr-state')?.textContent.trim()),
      mini: mini ? mini.textContent.replace(/\s+/g,' ').trim() : 'NONE',
      rowNewCount: rows.filter(r => r.querySelector('.pr-new')).length
    };
  });
  T('权限管理页激活', r2.active, '');
  T('一键开启所有权限按钮存在', r2.optName === '一键开启所有权限' && r2.optSvg, JSON.stringify(r2.optName));
  T('状态行 5 行', r2.rowCount === 5, 'got ' + r2.rowCount);
  T('行名含电池优化/自启动', JSON.stringify(r2.names) === '["位置权限","电池优化","通知权限","允许自启动","后台运行 · 锁屏清理"]', JSON.stringify(r2.names));
  T('状态行无「新」字', r2.rowNewCount === 0, 'got ' + r2.rowNewCount);
  T('引导页小字入口存在', r2.mini.includes('后台保活详细步骤引导'), r2.mini);

  // ===== 3. 通知状态用原生真实值（mock enabled:true → 显示已开启）=====
  T('通知显示已开启（原生真实状态）', r2.states[2] === '已开启', JSON.stringify(r2.states));
  // 改 mock 为 false → refreshNotificationState 后显示未开启
  const r3 = await page.evaluate(() => {
    window.Capacitor.Plugins.ArrivalMonitor.notificationEnabled = () => Promise.resolve({ enabled: false });
    notifEnabled = null;
    refreshNotificationState();
    return true;
  });
  await page.waitForTimeout(300);
  const r3b = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#permPageRows .pm-row')];
    return rows[2].querySelector('.pr-state')?.textContent.trim();
  });
  T('通知原生 false → 显示未开启', r3b === '未开启', 'got ' + r3b);
  // 恢复 true
  await page.evaluate(() => {
    window.Capacitor.Plugins.ArrivalMonitor.notificationEnabled = () => Promise.resolve({ enabled: true });
    notifEnabled = null;
    refreshNotificationState();
  });
  await page.waitForTimeout(300);

  // ===== 4. 一键开启所有权限流程 =====
  await page.evaluate(() => { runPermAll(); });
  await page.waitForTimeout(300);
  const r4 = await page.evaluate(() => {
    return {
      btnText: document.getElementById('pmOptAllName')?.textContent.trim(),
      states: [...document.querySelectorAll('#permPageRows .pm-row')].map(r => r.querySelector('.pr-state')?.textContent.trim()),
      calls: (window.__calls || []).slice()
    };
  });
  T('按钮变自动处理中', r4.btnText === '自动处理中…', r4.btnText);
  T('位置项处理中', r4.states[0] === '处理中…', JSON.stringify(r4.states));
  // 等全部流程完成：location 2.5s + battery 5s + notification 3.5s + autostart 5s + background 5s ≈ 21s
  await page.waitForTimeout(22500);
  const r5 = await page.evaluate(() => {
    return {
      btnText: document.getElementById('pmOptAllName')?.textContent.trim(),
      states: [...document.querySelectorAll('#permPageRows .pm-row')].map(r => r.querySelector('.pr-state')?.textContent.trim()),
      calls: (window.__calls || []).slice()
    };
  });
  T('全部完成（5 项处理完）', r5.states.every(s => s === '完成' || s === '已开启'), JSON.stringify(r5.states));
  T('按钮变全部已开启', r5.btnText === '全部已开启', r5.btnText);
  T('电池弹框/权限申请/自启动/跳转都已触发', ['battery','perm','autostart'].every(c => r5.calls.includes(c)) && r5.calls.some(c => c.startsWith('settings:')), JSON.stringify(r5.calls));

  // ===== 5. 再次进入显示已开启（记忆）=====
  await page.evaluate(() => { switchPage('manage'); openPermPage(); });
  await page.waitForTimeout(300);
  const r6 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#permPageRows .pm-row')];
    return rows.map(r => r.querySelector('.pr-state')?.textContent.trim());
  });
  T('再次进入显示已开启（持久化）', r6.filter(s => s === '已开启').length >= 3, JSON.stringify(r6));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
