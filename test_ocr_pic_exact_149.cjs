// #149 识别结果=图片实际内容测试（发出页拍照识别按行渲染/保存 + 首页OCR去补漏）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18732;
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
    // 3 家已录门店（图片里只出现 2 家 + 1 家未录入）
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.1700, lng: 120.6600, sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], lat: 28.1900, lng: 120.6800, sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    window.Notification = { permission: 'granted' };
  });
  await page.waitForTimeout(300);

  // ===== 1. 拍照识别 3 行（2 已录 + 1 未录 35-99）→ 弹窗只渲染 3 行，不是全部已录门店 =====
  await page.evaluate(() => {
    currentActionType = 'in';
    selectEmitGoods(4); // 常温筐
    fillEmitConfirm([
      { code: '35-01', name: '35-01 温州永嘉上塘下堡店', cols: { '物流箱': 12, '整箱数量': 83 }, whole: 83, nums: [12] },
      { code: '35-02', name: '35-02 温州永嘉瓯北店', cols: { '物流箱': 8, '整箱数量': 52 }, whole: 52, nums: [8] },
      { code: '35-99', name: '35-99 温州永嘉新店', cols: { '物流箱': 3, '整箱数量': 10 }, whole: 10, nums: [3] }
    ]);
  });
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList [data-emit-row]')];
    const unregShown = document.getElementById('unregStoreModal').classList.contains('show');
    return {
      rowCount: rows.length,
      firstText: rows[0]?.textContent.replace(/\s+/g, ' ').trim(),
      lastText: rows[rows.length - 1]?.textContent.replace(/\s+/g, ' ').trim(),
      unregShown
    };
  });
  T('识别 3 行 → 弹窗渲染 3 行（不是全部已录 3 家+补漏）', r1.rowCount === 3, 'got ' + r1.rowCount);
  T('第 1 行含编号+店名', (r1.firstText || '').includes('35-01') && (r1.firstText || '').includes('上塘下堡店'), r1.firstText);
  T('第 3 行是图片里的新店（35-99）', (r1.lastText || '').includes('35-99'), r1.lastText);
  T('未录门店弹窗出现（35-99）', r1.unregShown, '');

  // ===== 2. 忽略继续 → 弹窗保留 3 行 =====
  await page.evaluate(() => { unregStoreIgnore(); });
  await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#emitVoiceConfirmList [data-emit-row]').length,
    modalShown: document.getElementById('emitVoiceConfirmModal').classList.contains('show'),
    qty0: document.querySelector('#emitVoiceConfirmList input[data-emit-confirm-idx="0"]')?.value,
    qty2: document.querySelector('#emitVoiceConfirmList input[data-emit-confirm-idx="2"]')?.value
  }));
  T('忽略继续后识别结果弹窗显示', r2.modalShown, '');
  T('忽略后仍 3 行（图片内容）', r2.rows === 3, 'got ' + r2.rows);
  T('第 1 行物流箱数=12', r2.qty0 === '12', r2.qty0);
  T('第 3 行（未录店）物流箱数=3', r2.qty2 === '3', r2.qty2);

  // ===== 3. 确定保存：2 已录保存 + 1 未录跳过 =====
  await page.evaluate(() => {
    document.getElementById('emitConfirmDate').value = '2026-08-09';
    applyEmitVoice();
  });
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => {
    const data = loadData();
    const today = data.filter(r => r.date === '2026-08-09' && r.goodsIdx === 4);
    return {
      count: today.length,
      storeNames: today.map(r => r.storeName),
      qtyIns: today.map(r => r.qtyIn),
      wholes: today.map(r => r.qtyWhole)
    };
  });
  T('保存 2 条（未录的 35-99 被跳过）', r3.count === 2, 'got ' + r3.count);
  T('保存的店名是已录的 2 家', JSON.stringify(r3.storeNames) === JSON.stringify(['35-01 温州永嘉上塘下堡店','35-02 温州永嘉瓯北店']), JSON.stringify(r3.storeNames));
  T('物流箱数正确 12/8', JSON.stringify(r3.qtyIns) === JSON.stringify([12,8]), JSON.stringify(r3.qtyIns));
  T('常温整箱数正确 83/52', JSON.stringify(r3.wholes) === JSON.stringify([83,52]), JSON.stringify(r3.wholes));

  // ===== 4. 首页 OCR 不再补漏（源码断言 fillMissingStores 调用移除）=====
  const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
  T('首页 OCR 不再调用 fillMissingStores 补行', !src.includes('fillMissingStores(rows, loadStoreConfig())') && !src.includes('fillMissingStores(ocrCurrentResult.rows'), '');

  T('全程无 JS 错误', errs.length === 0, errs.join(';'));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
