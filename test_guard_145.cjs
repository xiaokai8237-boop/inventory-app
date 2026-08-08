// #145 后台保活一键优化测试
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

  // ===== 1. 权限管理页有后台保活引导入口 =====
  const entry = await page.evaluate(() => {
    switchPage('manage');
    return null;
  });
  await page.waitForTimeout(200);
  const entry2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('权限管理'));
    const pm = document.getElementById('page-perm');
    const guardBtn = pm.querySelector('.pm-guide-btn');
    return { hasPermItem: !!b, guardBtnText: guardBtn ? guardBtn.textContent.replace(/\s+/g, ' ').trim() : 'NONE', guardBtnSvg: !!guardBtn?.querySelector('svg') };
  });
  T('管理页有权限管理入口', entry2.hasPermItem, '');
  T('权限管理页有后台保活引导卡', entry2.guardBtnText.includes('后台保活引导'), entry2.guardBtnText);
  T('引导卡有图标', entry2.guardBtnSvg, '');

  // ===== 2. 打开 page-guard =====
  const g1 = await page.evaluate(() => {
    openGuardPage();
    return {
      active: document.getElementById('page-guard').classList.contains('active'),
      title: document.querySelector('#page-guard .ntm-title')?.textContent.replace(/\s+/g, ' ').trim(),
      items: document.querySelectorAll('#ggList .gg-item').length,
      autoText: document.getElementById('ggAutoText')?.textContent.replace(/\s+/g, ' ').trim(),
      btnText: document.getElementById('ggOptText')?.textContent.trim(),
      hint: document.getElementById('ggHint')?.textContent.trim()
    };
  });
  await page.waitForTimeout(100);
  T('page-guard 激活', g1.active, '');
  T('标题正确', (g1.title || '').includes('后台保活优化'), g1.title);
  T('4 个处理项渲染', g1.items === 4, 'got ' + g1.items);
  T('自动检测文本含 4 项没开好', (g1.autoText || '').includes('4'), JSON.stringify(g1.autoText));
  T('一键优化按钮', (g1.btnText || '').includes('一键优化'), g1.btnText);
  T('提示含点允许', (g1.hint || '').includes('允许'), g1.hint);

  // ===== 3. 一键优化流程（battery → notification 跳过 → autostart → background）=====
  await page.evaluate(() => { runGuardOptimize(); });
  await page.waitForTimeout(300);
  const g2 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#ggList .gg-item')];
    return {
      states: items.map(i => i.querySelector('.gi-state')?.textContent.trim()),
      cls: items.map(i => i.className),
      btnDisabled: document.getElementById('ggOptBtn').disabled,
      btnText: document.getElementById('ggOptText')?.textContent.trim(),
      capCalls: (window.__capCalls || []).slice()
    };
  });
  T('电池项处理中', g2.states[0] === '处理中…', JSON.stringify(g2.states));
  T('按钮禁用（自动处理中）', g2.btnDisabled, '');
  T('电池弹框已触发', g2.capCalls.includes('battery'), JSON.stringify(g2.capCalls));

  // 等电池 5s 完成 → notification 跳过 → autostart 5s → background 5s → 全部完成（~15s）
  await page.waitForTimeout(16500);
  const g3 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#ggList .gg-item')];
    const capCalls = (window.__capCalls || []).slice();
    return {
      states: items.map(i => i.querySelector('.gi-state')?.textContent.trim()),
      doneVisible: document.getElementById('ggDone').style.display !== 'none',
      btnText: document.getElementById('ggOptText')?.textContent.trim(),
      btnDisabled: document.getElementById('ggOptBtn').disabled,
      capCalls,
      hasAutostart: capCalls.includes('autostart'),
      hasSettings: capCalls.some(c => c.startsWith('settings:'))
    };
  });
  T('全部 4 项完成', g3.states.every(s => s === '完成'), JSON.stringify(g3.states));
  T('完成卡显示', g3.doneVisible, '');
  T('按钮变全部已设置好', g3.btnText === '全部已设置好' && g3.btnDisabled, g3.btnText);
  T('自启动厂商跳转已触发', g3.hasAutostart, JSON.stringify(g3.capCalls));
  T('后台/锁屏跳转已触发', g3.hasSettings, JSON.stringify(g3.capCalls));

  // ===== 4. 路线同步原生（门店围栏注册）=====
  const sync = await page.evaluate(() => {
    // 造一个已定位门店
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
