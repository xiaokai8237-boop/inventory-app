// #145b 后台保活引导移除验证（原 #145 引导页 + 两个入口已删除，一键开启保留）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18710;
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
    localStorage.setItem(scopeKey('kuanwei_notify_settings'), '');
    localStorage.setItem('kuanwei_loc_ok', '1');
    // mock 通知权限 granted + Capacitor ArrivalMonitor 插件
    window.Notification = { permission: 'granted', requestPermission: function() { return Promise.resolve('granted'); } };
    window.Capacitor = { Plugins: { ArrivalMonitor: {
      requestBatteryIgnore: () => { window.__capCalls = window.__capCalls || []; window.__capCalls.push('battery'); return Promise.resolve(); },
      openAutoStart: () => { window.__capCalls = window.__capCalls || []; window.__capCalls.push('autostart'); return Promise.resolve(); },
      openSettings: (k) => { window.__capCalls = window.__capCalls || []; window.__capCalls.push('settings:' + k); return Promise.resolve(); },
      requestPermissions: () => Promise.resolve(),
      registerRoute: (o) => { window.__routeCalls = window.__routeCalls || []; window.__routeCalls.push(JSON.parse(o.route || '[]')); return Promise.resolve({ registered: (JSON.parse(o.route || '[]')).length }); }
    } } };
  });
  await page.waitForTimeout(300);

  // ===== 1. 管理页有权限管理入口 =====
  const entry = await page.evaluate(() => {
    switchPage('manage');
    return [...document.querySelectorAll('#page-manage .manage-item')].some(b => b.textContent.includes('权限管理'));
  });
  await page.waitForTimeout(200);
  T('管理页有权限管理入口', entry, '');

  // ===== 2. 权限管理页：后台保活引导已彻底移除 =====
  const r2 = await page.evaluate(() => {
    openPermPage();
    return {
      card: document.querySelector('#page-perm .pm-guide-btn'),
      mini: document.querySelector('#page-perm .pm-guide-mini'),
      guardPage: document.getElementById('page-guard'),
      hasOpenGuard: typeof openGuardPage !== 'undefined',
      hasRunGuard: typeof runGuardOptimize !== 'undefined',
      optBtn: document.getElementById('pmOptAll'),
      rows: document.querySelectorAll('#permPageRows .pm-row').length
    };
  });
  await page.waitForTimeout(300);
  T('权限管理页底部引导卡已删除', !r2.card, '');
  T('小字入口已删除', !r2.mini, '');
  T('page-guard 页面已删除', !r2.guardPage, '');
  T('openGuardPage 已删除', !r2.hasOpenGuard, '');
  T('runGuardOptimize 已删除', !r2.hasRunGuard, '');
  T('一键开启所有权限按钮保留', !!r2.optBtn, '');
  T('权限状态行仍为 5 行', r2.rows === 5, 'got ' + r2.rows);

  // ===== 3. 一键开启所有权限仍正常（mock，第1项位置定位 2500ms → 第2项电池弹框）=====
  const r3 = await page.evaluate(() => {
    runPermAll();
    return { running: typeof permAllRunning !== 'undefined' };
  });
  await page.waitForTimeout(3200);
  const r3b = await page.evaluate(() => {
    return { calls: (window.__capCalls || []).slice(), done: Object.keys(permAllDone || {}).length };
  });
  T('一键开启已启动并依次处理（电池弹框已触发）', r3.running && r3b.calls.includes('battery'), JSON.stringify(r3b.calls));

  // ===== 4. 路线同步原生（门店围栏注册）仍正常 =====
  const sync = await page.evaluate(() => {
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.1700, lng: 120.6600, sort: 1 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem(scopeKey('kuanwei_notify_settings'), JSON.stringify({ template: 'rich', distM: 300, ring: true, vibrate: true, silent: false }));
    syncArrivalRouteToNative();
    return { calls: (window.__routeCalls || []).length, last: (window.__routeCalls || []).slice(-1)[0] };
  });
  await page.waitForTimeout(200);
  T('路线已同步原生（registerRoute 调用）', sync.calls >= 1, 'got ' + sync.calls);
  T('路线含 2 个已定位门店', sync.last && sync.last.length === 2, JSON.stringify(sync.last && sync.last.length));
  T('门店含 name/lat/lng', sync.last && sync.last[0].name && sync.last[0].lat && sync.last[0].lng, JSON.stringify(sync.last && sync.last[0]));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
