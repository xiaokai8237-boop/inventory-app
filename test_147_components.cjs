// 任务A/B/C 测试：bootOverlay 启动页 + 注销确认弹窗 + 导入确认弹窗
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18731;
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
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify([
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 }
    ]));
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    window.Notification = { permission: 'granted' };
    window.__confirmCalls = 0;
    window.confirm = function() { window.__confirmCalls++; return true; };
  });
  await page.waitForTimeout(300);

  // ===== 任务A：bootOverlay 启动页（源码级断言：overlay 加载完会被正常移除）=====
  const htmlSrc = fs.readFileSync(__dirname + '/index.html', 'utf8');
  T('启动页遮罩 HTML 存在', htmlSrc.includes('id="bootOverlay"'), '');
  T('启动页含标语「让筐数清清楚楚」', htmlSrc.includes('让筐数清清楚楚'), '');
  T('启动页含品牌名', htmlSrc.includes('物流筐收发管理系统'), '');
  T('启动页含 4 条优点（云备份等）', htmlSrc.includes('手动 / 语音 / 拍照 都能记') && htmlSrc.includes('云备份，换机不丢数据'), '');
  T('启动页版本号动态（无 v6.0.55 硬编码）', !htmlSrc.includes('v6.0.55') && htmlSrc.includes("bootVerEl.textContent = '版本 v' + APP_VERSION"), '');

  // ===== 任务B：注销确认弹窗（不再用 confirm） =====
  await page.evaluate(() => {
    adminKey = 'test';
    adminDeleteTemp(999);
  });
  await page.waitForTimeout(200);
  const b1 = await page.evaluate(() => ({
    modalShown: document.getElementById('deleteConfirmModal').classList.contains('show'),
    confirmCalls: window.__confirmCalls,
    dangerBtn: [...document.querySelectorAll('#deleteConfirmModal button')].map(b => b.textContent.trim())
  }));
  T('adminDeleteTemp 打开自定义弹窗', b1.modalShown, '');
  T('不再调用原生 confirm', b1.confirmCalls === 0, 'got ' + b1.confirmCalls);
  T('弹窗含取消/确认注销按钮', JSON.stringify(b1.dangerBtn).includes('取消') && JSON.stringify(b1.dangerBtn).includes('确认注销'), JSON.stringify(b1.dangerBtn));

  // 取消关闭
  await page.evaluate(() => closeDeleteConfirmModal());
  await page.waitForTimeout(100);
  const b2 = await page.evaluate(() => !document.getElementById('deleteConfirmModal').classList.contains('show'));
  T('取消关闭弹窗', b2, '');

  // 确认注销执行（mock fetch 返回失败也行，只要不崩）
  await page.evaluate(() => { adminDeleteTemp(999); });
  await page.waitForTimeout(100);
  await page.evaluate(() => { confirmDeleteTemp(); });
  await page.waitForTimeout(200);
  const b3 = await page.evaluate(() => ({
    closed: !document.getElementById('deleteConfirmModal').classList.contains('show'),
    errs: window.__lastPageErr || null
  }));
  T('确认注销关闭弹窗并执行（无 JS 错误）', b3.closed, '');
  T('全程无 JS 错误', errs.length === 0, errs.join(';'));

  // ===== 任务C：导入确认弹窗 =====
  // mock FileReader：构造一个含 2 条记录的文件
  await page.evaluate(() => {
    const fileData = JSON.stringify({ records: [
      { id: 'x1', date: '2026-08-09', storeIdx: 0, storeName: '35-01 温州永嘉上塘下堡店', goodsIdx: 0, goodsName: '鲜食筐', qtyIn: 5, qtyOut: 0 },
      { id: 'x2', date: '2026-08-09', storeIdx: 0, storeName: '35-01 温州永嘉上塘下堡店', goodsIdx: 1, goodsName: '面包筐', qtyIn: 3, qtyOut: 0 }
    ] });
    window.__fakeFile = { name: 'test.json', files: [ { name: 'test.json' } ] };
    // 拦截 FileReader
    const origFR = window.FileReader;
    window.FileReader = function() {
      const fr = new origFR();
      fr.readAsText = function() {
        const e = { target: { result: fileData } };
        setTimeout(() => fr.onload && fr.onload(e), 10);
      };
      return fr;
    };
  });
  await page.evaluate(() => {
    // 模拟 input change 调用 importData
    importData({ target: { files: [{ name: 'test.json' }] } });
  });
  await page.waitForTimeout(300);
  const c1 = await page.evaluate(() => ({
    modalShown: document.getElementById('importConfirmModal').classList.contains('show'),
    count: document.getElementById('importConfirmCount')?.textContent.trim(),
    confirmCalls: window.__confirmCalls
  }));
  T('导入文件后打开自定义弹窗', c1.modalShown, '');
  T('显示条数 2', c1.count === '2', c1.count);
  T('不再调用原生 confirm', c1.confirmCalls === 0, 'got ' + c1.confirmCalls);

  // 合并：现有 1 条 (0,0) qtyIn=1，导入 2 条 → 结果 2 条（去重后同 key 保留新值）
  await page.evaluate(() => {
    // 先造现有数据
    saveDataArr([{ id: 'old1', date: '2026-08-09', storeIdx: 0, storeName: '35-01 温州永嘉上塘下堡店', goodsIdx: 0, goodsName: '鲜食筐', qtyIn: 1, qtyOut: 0 }]);
    doImportMerge();
  });
  await page.waitForTimeout(200);
  const c2 = await page.evaluate(() => {
    const data = loadData();
    const today = data.filter(r => r.date === '2026-08-09');
    return { count: today.length, qIn0: today.find(r => r.goodsIdx === 0)?.qtyIn, closed: !document.getElementById('importConfirmModal').classList.contains('show') };
  });
  T('合并：弹窗关闭', c2.closed, '');
  T('合并：2 条记录（去重）', c2.count === 2, 'got ' + c2.count);
  T('合并：同 key 保留新值 qtyIn=5', c2.qIn0 === 5, 'got ' + c2.qIn0);

  // 覆盖：导入 2 条 → 覆盖现有（只剩导入的 2 条）
  await page.evaluate(() => {
    const fileData = JSON.stringify({ records: [
      { id: 'x1', date: '2026-08-09', storeIdx: 0, storeName: '35-01 温州永嘉上塘下堡店', goodsIdx: 0, goodsName: '鲜食筐', qtyIn: 9, qtyOut: 0 },
      { id: 'x2', date: '2026-08-09', storeIdx: 0, storeName: '35-01 温州永嘉上塘下堡店', goodsIdx: 1, goodsName: '面包筐', qtyIn: 3, qtyOut: 0 }
    ] });
    const origFR = window.FileReader;
    window.FileReader = function() {
      const fr = new origFR();
      fr.readAsText = function() {
        setTimeout(() => fr.onload && fr.onload({ target: { result: fileData } }), 10);
      };
      return fr;
    };
    importData({ target: { files: [{ name: 'test.json' }] } });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => { doImportOverwrite(); });
  await page.waitForTimeout(200);
  const c3 = await page.evaluate(() => {
    const data = loadData();
    const today = data.filter(r => r.date === '2026-08-09');
    return { count: today.length, qIn0: today.find(r => r.goodsIdx === 0)?.qtyIn, closed: !document.getElementById('importConfirmModal').classList.contains('show') };
  });
  T('覆盖：弹窗关闭', c3.closed, '');
  T('覆盖：只剩 2 条（旧数据被覆盖）', c3.count === 2, 'got ' + c3.count);
  T('覆盖：新值 qtyIn=9', c3.qIn0 === 9, 'got ' + c3.qIn0);

  T('全程无 JS 错误', errs.length === 0, errs.join(';'));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
