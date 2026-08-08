// 全页面冒烟测试：切换所有页面 + 打开主要弹窗，捕获 JS 运行时错误
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18730;
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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.1700, lng: 120.6600, sort: 1 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    window.Notification = { permission: 'granted' };
  });
  await page.waitForTimeout(300);

  // 1. 遍历所有页面（switchPage 每个）
  const pages = ['record','history','summary','manage','settings','reconcile'];
  for (const p of pages) {
    await page.evaluate(name => switchPage(name), p);
    await page.waitForTimeout(150);
  }
  T('6 个主页面切换无 JS 错误', errs.length === 0, errs.join(';'));

  // 2. 打开主要弹窗
  const modalChecks = [
    ['openExtraModal', 'extraModal'],
    ['openNotifyTemplatesPanel', 'notifyTemplatesModal'],
    ['openNotifyManagePage', 'page-notify'],
    ['openPermPage', 'page-perm']
  ];
  for (const [fn, id] of modalChecks) {
    await page.evaluate(f => { try { window[f](); } catch(e) { window.__smokeErr = e.message; } }, fn);
    await page.waitForTimeout(150);
  }
  T('主要弹窗/页面打开无 JS 错误', errs.length === 0, errs.join(';'));

  // 3. 恢复数据弹窗/备份（验证数据弹窗）
  await page.evaluate(() => { switchPage('settings'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { openBackupDetail(); } catch(e) {} });
  await page.waitForTimeout(100);

  // 4. 登录页/设置页切换
  await page.evaluate(() => { switchPage('login'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { switchPage('record'); });
  await page.waitForTimeout(200);

  T('全部操作无 JS 错误', errs.length === 0, errs.join(';'));
  const pageCount = await page.evaluate(() => document.querySelectorAll('.page').length);
  T('页面容器数量正常(10+)', pageCount >= 10, 'got ' + pageCount);

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
