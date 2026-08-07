// 验证：识别到未录入门店时是否弹提醒
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18657;
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
  // 准备数据：店面管理里只有 35-01/35-02，OCR 识别出 35-03（未录入）
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], sort: 1 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    currentActionType = 'in';
    parseOcrResult({
      _highConf: true,
      words_result: [
        { words: '常温配送单' },
        { words: '路线编号 门店名称 物流箱 整箱数量' },
        { words: '35-01 温州永嘉上塘下堡店 12 3' },
        { words: '35-02 温州永嘉瓯北店 8 2' },
        { words: '35-03 温州永嘉桥下店 15 5' }   // 35-03 不在店面管理！
      ]
    });
  });
  await page.waitForTimeout(300);
  // 检查 unreg 弹窗
  const unregShown = await page.evaluate(() => {
    const m = document.getElementById('unregStoreModal');
    return m.classList.contains('show');
  });
  T('未录入门店弹窗弹出', unregShown, '');
  const unregDesc = await page.evaluate(() => document.getElementById('unregStoreDesc')?.textContent || '');
  T('弹窗列出未录入门店', unregDesc.includes('温州永嘉桥下店'), unregDesc.slice(0, 80));
  // 点忽略继续 → 显示结果
  await page.evaluate(() => { unregStoreIgnore(); });
  await page.waitForTimeout(200);
  const resultShown = await page.evaluate(() => document.getElementById('ocrResultModal').classList.contains('show'));
  T('忽略继续后显示识别结果', resultShown, '');
  // 保存：35-03 应被跳过
  await page.evaluate(() => { document.getElementById('recordDate').value = todayStr(); confirmOcrResult(); });
  await page.waitForTimeout(400);
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000')));
  T('只保存 2 条（35-03 被跳过）', recs.length === 2, 'got ' + recs.length);
  T('保存的是 35-01/35-02', recs.every(r => r.storeIdx === 0 || r.storeIdx === 1), JSON.stringify(recs.map(r => r.storeIdx)));
  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
