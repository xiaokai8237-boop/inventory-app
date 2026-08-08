// #144 权限引导/权限管理/到店监测测试
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18698;
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
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem(scopeKey('kuanwei_notify_settings'), '');
    localStorage.removeItem('kuanwei_perm_guide_seen');
    localStorage.removeItem('kuanwei_arrival_on');
    // 店面管理：2 家有定位的门店
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1557, lng: 120.7112, address: '温州永嘉上塘' },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.0560, lng: 120.6880, address: '温州永嘉瓯北' }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
  });

  // ===== 1. 首次引导（未看过 → 打开） =====
  await page.evaluate(() => { isLoggedIn = function() { return true; }; });
  const g1 = await page.evaluate(() => {
    openPermGuide();
    const m = document.getElementById('permGuideModal');
    return {
      shown: m.classList.contains('show'),
      cards: m.querySelectorAll('.perm-card').length,
      names: [...m.querySelectorAll('.perm-card .pc-name')].map(x => x.textContent.trim()),
      safeCount: m.querySelectorAll('.pc-safe').length,
      agreeBtn: m.querySelector('.pg-btn')?.textContent.trim(),
      laterBtn: m.querySelector('.pg-later')?.textContent.trim()
    };
  });
  T('引导弹窗打开', g1.shown, '');
  T('3 张权限卡', g1.cards === 3 && JSON.stringify(g1.names) === '["位置权限","通知权限","允许后台运行"]', JSON.stringify(g1.names));
  T('3 条安全承诺', g1.safeCount === 3, 'got ' + g1.safeCount);
  T('同意/稍后按钮', g1.agreeBtn.includes('同意并开始') && g1.laterBtn.includes('稍后再说'), '');

  // ===== 2. 稍后再说 → 关闭 + 记录已看过 =====
  await page.evaluate(() => { permGuideLater(); });
  await page.waitForTimeout(200);
  const g2 = await page.evaluate(() => ({
    closed: !document.getElementById('permGuideModal').classList.contains('show'),
    seen: localStorage.getItem('kuanwei_perm_guide_seen')
  }));
  T('稍后再说关闭弹窗', g2.closed, '');
  T('记录已看过', g2.seen === '1', 'got ' + g2.seen);

  // ===== 3. 通知栏管理页顶部横幅（权限没开全 → 显示） =====
  await page.evaluate(() => { openNotifyManagePage(); });
  await page.waitForTimeout(300);
  const g3 = await page.evaluate(() => {
    const banner = document.querySelector('#page-notify .gd-banner');
    return {
      pageActive: document.getElementById('page-notify').classList.contains('active'),
      hasBanner: !!banner,
      bannerText: banner ? banner.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
    };
  });
  T('通知栏管理页打开（已看过引导）', g3.pageActive, '');
  T('顶部显示权限横幅', g3.hasBanner && g3.bannerText.includes('到店提醒还没开'), g3.bannerText);

  // ===== 4. 点横幅 → 打开引导 =====
  await page.evaluate(() => { document.querySelector('#page-notify .gd-banner').click(); });
  await page.waitForTimeout(200);
  const g4 = await page.evaluate(() => document.getElementById('permGuideModal').classList.contains('show'));
  T('点横幅重开引导', g4, '');
  await page.evaluate(() => { permGuideLater(); });

  // ===== 5. 同意 → 启动监测 + 横幅消失 =====
  await page.evaluate(() => {
    // 模拟同意后权限生效（测试环境无真实浏览器权限弹窗）
    window.Notification = { permission: 'granted', requestPermission: function() { return Promise.resolve('granted'); } };
    localStorage.setItem('kuanwei_loc_ok', '1');
    permGuideAgree();
  });
  await page.waitForTimeout(300);
  const g5 = await page.evaluate(() => ({
    monitorOn: !!arrivalTimer,
    bannerGone: !document.querySelector('#page-notify .gd-banner'),
    seen: localStorage.getItem('kuanwei_perm_guide_seen'),
    arrivalOn: localStorage.getItem('kuanwei_arrival_on')
  }));
  T('同意后启动到店监测', g5.monitorOn, '');
  T('记录已看过 + arrival_on=1', g5.seen === '1' && g5.arrivalOn === '1', '');
  await page.evaluate(() => { renderNotifyManage(); });
  await page.waitForTimeout(200);
  const g5b = await page.evaluate(() => !document.querySelector('#page-notify .gd-banner'));
  T('渲染后权限横幅消失（已开全）', g5b, '');

  // ===== 6. 权限管理弹窗 =====
  await page.evaluate(() => { openPermManage(); });
  await page.waitForTimeout(200);
  const g6 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#permManageList .mg-row')];
    const states = rows.map(r => r.querySelector('.mg-state')?.textContent.trim());
    return {
      shown: document.getElementById('permManageModal').classList.contains('show'),
      rowCount: rows.length,
      names: rows.map(r => r.querySelector('.mg-name')?.textContent.trim()),
      states,
      hasTip: !!document.querySelector('#permManageModal .mg-tip'),
      hasLast: !!document.querySelector('#permManageModal .mg-last'),
      reGuide: document.querySelector('#permManageModal .mg-reguide')?.textContent.replace(/\s+/g,' ').trim()
    };
  });
  T('权限管理弹窗打开 4 行', g6.shown && g6.rowCount === 4, '');
  T('行名正确', JSON.stringify(g6.names) === '["位置权限","通知权限","允许后台运行","到店提醒总开关"]', JSON.stringify(g6.names));
  T('位置/通知已开启（同意过）', g6.states[0] === '已开启' && g6.states[1] === '已开启', JSON.stringify(g6.states));
  T('总开关开启中', g6.states[3] === '开启中', '');
  T('提示条/透明行/重看权限说明', g6.hasTip && g6.hasLast && g6.reGuide === '重新看一遍权限说明', JSON.stringify(g6.reGuide));

  // ===== 7. 重看权限说明 → 打开引导 =====
  await page.evaluate(() => { document.querySelector('#permManageModal .mg-reguide').click(); });
  await page.waitForTimeout(200);
  const g7 = await page.evaluate(() => {
    const guideShown = document.getElementById('permGuideModal').classList.contains('show');
    const manageShown = document.getElementById('permManageModal').classList.contains('show');
    return { guideShown, manageShown };
  });
  T('重看权限说明打开引导', g7.guideShown, '');
  T('权限管理弹窗关闭', !g7.manageShown, '');
  await page.evaluate(() => { closePermGuide(); });

  // ===== 8. 到店监测：mock 定位触发 =====
  await page.evaluate(() => {
    // 关闭真实定时器（避免干扰），手动模拟 GPS 回调
    stopArrivalMonitor();
    arrivalNotified = {};
    // mock geolocation：返回 35-01 店附近（约 100m）
    const target = { lat: 28.1557, lng: 120.7112 };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: function() {
        return { getCurrentPosition: function(cb) { cb({ coords: { latitude: target.lat + 0.0009, longitude: target.lng - 0.0009 } }); } };
      }
    });
    loadNotifySettings = function() { return { template: 'rich', distM: 500, ring: true, vibrate: true, silent: false }; };
  });
  await page.evaluate(() => { arrivalTick(); });
  await page.waitForTimeout(300);
  const g8 = await page.evaluate(() => {
    const b = document.getElementById('arrivalBanner');
    return {
      shown: b.classList.contains('show'),
      dist: document.getElementById('arrDist').textContent,
      store: document.getElementById('arrStore').textContent,
      hasClock: !!b.querySelector('.ab-clock'),
      hasBtns: !!b.querySelector('.ab-btn.gold') && !!b.querySelector('.ab-btn.blue'),
      goodsCount: b.querySelectorAll('.ab-g').length,
      notified: Object.keys(arrivalNotified).length
    };
  });
  console.log('  到店横幅:', JSON.stringify(g8));
  T('到店提醒横幅显示', g8.shown, '');
  T('店名/距离正确', g8.store.includes('35-01') && parseInt(g8.dist) <= 500 && parseInt(g8.dist) > 0, g8.store + ' ' + g8.dist);
  T('含打卡+双按钮', g8.hasClock && g8.hasBtns, '');
  T('5 种筐全列', g8.goodsCount === 5, 'got ' + g8.goodsCount);
  T('防重复标记记录', g8.notified === 1, 'got ' + g8.notified);

  // ===== 9. 防重复：再 tick 一次不重复弹 =====
  await page.evaluate(() => { arrivalTick(); });
  await page.waitForTimeout(200);
  const g9 = await page.evaluate(() => Object.keys(arrivalNotified).length);
  T('同店内不重复提醒', g9 === 1, 'got ' + g9);

  // ===== 10. 关闭监测 =====
  await page.evaluate(() => { stopArrivalMonitor(); arrivalDismiss(); });
  await page.waitForTimeout(100);
  const g10 = await page.evaluate(() => ({
    timer: !!arrivalTimer,
    bannerGone: !document.getElementById('arrivalBanner').classList.contains('show'),
    arrivalOn: localStorage.getItem('kuanwei_arrival_on')
  }));
  T('关闭监测+横幅消失+标记 0', !g10.timer && g10.bannerGone && g10.arrivalOn === '0', JSON.stringify(g10));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
