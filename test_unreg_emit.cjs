// 验证：发出页 AI 识别（emitDoOcr 通道）未录入门店弹窗
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18658;
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
  // 数据：店面管理只有 35-01/35-02，识别出 35-03（未录入）
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], sort: 1 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    currentActionType = 'in';
    // 模拟发出页 AI 识别结果（混元 rows 格式：code/name/cols）
    fillEmitConfirm([
      { code: '35-01', name: '温州永嘉上塘下堡店', cols: { '物流箱': 12 } },
      { code: '35-02', name: '温州永嘉瓯北店', cols: { '物流箱': 8 } },
      { code: '35-03', name: '温州永嘉桥下店', cols: { '物流箱': 15 } }  // 未录入！
    ]);
  });
  await page.waitForTimeout(300);
  const unregShown = await page.evaluate(() => document.getElementById('unregStoreModal').classList.contains('show'));
  T('发出页未录入门店弹窗弹出', unregShown, '');
  const desc = await page.evaluate(() => document.getElementById('unregStoreDesc')?.textContent || '');
  T('弹窗列出 35-03', desc.includes('温州永嘉桥下店'), desc.slice(0, 80));
  // 忽略继续 → 显示发出确认框
  await page.evaluate(() => { unregStoreIgnore(); });
  await page.waitForTimeout(200);
  const emitShown = await page.evaluate(() => document.getElementById('emitVoiceConfirmModal').classList.contains('show'));
  T('忽略继续后显示发出确认框', emitShown, '');
  // 场景2：全部已录入 → 不弹窗直接显示确认框
  await page.evaluate(() => {
    closeUnregStoreModal();
    document.getElementById('emitVoiceConfirmModal').classList.remove('show');
    fillEmitConfirm([
      { code: '35-01', name: '温州永嘉上塘下堡店', cols: { '物流箱': 12 } },
      { code: '35-02', name: '温州永嘉瓯北店', cols: { '物流箱': 8 } }
    ]);
  });
  await page.waitForTimeout(300);
  const state2 = await page.evaluate(() => ({
    unreg: document.getElementById('unregStoreModal').classList.contains('show'),
    emit: document.getElementById('emitVoiceConfirmModal').classList.contains('show')
  }));
  T('全部已录入不弹未录入提醒', !state2.unreg, '');
  T('直接显示发出确认框', state2.emit, '');
  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
