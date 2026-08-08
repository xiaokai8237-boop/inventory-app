// #151 未录门店数字暂存 + 一键补录测试（方案A）
// 验证：① 保存时未录门店数字暂存 localStorage
//       ② 店面管理添加门店后自动弹补录
//       ③ 补录弹窗带出数字可改 + 补录入账写入当天记录 + 暂存清除
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18750;
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

  // ===== 1. 保存时未录门店数字暂存 =====
  await page.evaluate(() => {
    currentActionType = 'in';
    selectEmitGoods(4); // 常温筐
    fillEmitConfirm([
      { code: '35-01', name: '35-01 温州永嘉上塘下堡店', cols: { '物流箱': 12, '整箱数量': 83 }, whole: 83, nums: [12] },
      { code: '35-99', name: '35-99 温州永嘉新店', cols: { '物流箱': 3, '整箱数量': 10 }, whole: 10, nums: [3] }
    ]);
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => { unregStoreIgnore(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.getElementById('emitConfirmDate').value = '2026-08-09';
    applyEmitVoice();
  });
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => ({
    pending: loadUnregPending(),
    saved: loadData().filter(r => r.date === '2026-08-09' && r.goodsIdx === 4).length
  }));
  T('已录 1 家入账', r1.saved === 1, 'got ' + r1.saved);
  T('未录门店已暂存 1 家', r1.pending.length === 1, JSON.stringify(r1.pending));
  T('暂存含店名 35-99', r1.pending[0]?.name === '35-99 温州永嘉新店', r1.pending[0]?.name);
  T('暂存含物流箱 3', r1.pending[0]?.qty === 3, '' + r1.pending[0]?.qty);
  T('暂存含整箱 10（常温）', r1.pending[0]?.whole === 10, '' + r1.pending[0]?.whole);
  T('暂存含筐类型 idx 4', r1.pending[0]?.goodsIdx === 4, '' + r1.pending[0]?.goodsIdx);
  T('暂存含日期', r1.pending[0]?.date === '2026-08-09', r1.pending[0]?.date);

  // ===== 2. 店面管理添加 35-99 → 自动弹补录 =====
  await page.evaluate(() => {
    const cfg = loadStoreConfig();
    cfg.push({ name: '35-99 温州永嘉新店', aliases: ['35-99'], sort: cfg.length });
    saveStoreConfig(cfg);
    checkUnregPending();
  });
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => {
    const modal = document.getElementById('unregPendingModal');
    const rows = document.querySelectorAll('#unregPendingList > div').length;
    const qty = document.getElementById('unregPendingQty_0')?.value;
    const whole = document.getElementById('unregPendingWhole_0')?.value;
    return {
      shown: modal.classList.contains('show'),
      rows,
      qty,
      whole,
      title: document.getElementById('unregPendingTitle')?.textContent.trim(),
      modalEmoji: (modal.textContent || '').match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u) ? true : false
    };
  });
  T('自动弹补录弹窗', r2.shown, '');
  T('补录列表 1 行', r2.rows === 1, 'got ' + r2.rows);
  T('物流箱数字带出 3', r2.qty === '3', r2.qty);
  T('整箱数字带出 10', r2.whole === '10', r2.whole);
  T('标题「上次有 1 家店没存上」', (r2.title || '').includes('1 家店没存上'), r2.title);
  T('弹窗零 emoji', !r2.modalEmoji, '');

  // ===== 3. 补录入账 → 写入当天记录 + 暂存清除 =====
  await page.evaluate(() => {
    document.getElementById('unregPendingQty_0').value = '5';
    doUnregPendingSave();
  });
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => {
    const data = loadData();
    const today = data.filter(r => r.date === '2026-08-09' && r.goodsIdx === 4);
    return {
      pending: loadUnregPending(),
      modalShown: document.getElementById('unregPendingModal').classList.contains('show'),
      count: today.length,
      storeNames: today.map(r => r.storeName),
      qtyIns: today.map(r => r.qtyIn),
      wholes: today.map(r => r.qtyWhole)
    };
  });
  T('补录后共 2 条记录', r3.count === 2, 'got ' + r3.count);
  T('补录店 35-99 入账', r3.storeNames.includes('35-99 温州永嘉新店'), JSON.stringify(r3.storeNames));
  T('补录物流箱=5（改过的值）', r3.qtyIns.includes(5), JSON.stringify(r3.qtyIns));
  T('补录整箱=10', r3.wholes.includes(10), JSON.stringify(r3.wholes));
  T('暂存已清除（补录完成）', r3.pending.length === 0, JSON.stringify(r3.pending));
  T('弹窗已关闭', !r3.modalShown, '');

  // ===== 4. 未录入的店：addStore 后再检测（真实入口路径） =====
  await page.evaluate(() => {
    // 再暂存一家 35-88（未录入）
    stashUnregStore({ code: '35-88', name: '35-88 温州永嘉黄田店' }, 7, 0, 0, '2026-08-09');
  });
  // 添加店面（走真实 addStoreFromPanel 路径）：添加"新店面"不含 35-88 → 不弹
  await page.evaluate(() => { addStoreFromPanel(); });
  await page.waitForTimeout(300);
  const r4 = await page.evaluate(() => ({
    shown: document.getElementById('unregPendingModal').classList.contains('show'),
    pending: loadUnregPending().length
  }));
  T('添加无关门店不弹补录', !r4.shown, '');
  T('35-88 暂存保留', r4.pending === 1, 'got ' + r4.pending);
  // 真正添加 35-88 → 弹
  await page.evaluate(() => {
    const cfg = loadStoreConfig();
    cfg.push({ name: '35-88 温州永嘉黄田店', aliases: ['35-88'], sort: cfg.length });
    saveStoreConfig(cfg);
    checkUnregPending();
  });
  await page.waitForTimeout(300);
  const r4b = await page.evaluate(() => document.getElementById('unregPendingModal').classList.contains('show'));
  T('添加 35-88 后自动弹补录', r4b, '');

  T('全程无 JS 错误', errs.length === 0, errs.join(';'));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
