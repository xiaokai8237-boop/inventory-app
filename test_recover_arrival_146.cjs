// #146 回收页自动定位测试（到店提示条 + 切换门店 + 单店回收保存）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18715;
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
    // 造 3 家已定位门店
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.1700, lng: 120.6600, sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], lat: 28.1900, lng: 120.6800, sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    localStorage.setItem('kuanwei_logged_in', '1');
    window.Notification = { permission: 'granted' };
    // mock Capacitor：getPendingArrival 返回预设值（通知点击带过来的店名/动作）
    window.__pendingArrival = null;
    window.Capacitor = { Plugins: { ArrivalMonitor: {
      getPendingArrival: function() {
        return Promise.resolve(window.__pendingArrival || { storeName: '', action: '' });
      }
    } } };
    window.__navUrl = null;
    const origOpen = window.open;
    window.open = function(u) { window.__navUrl = u; return null; };
  });
  await page.waitForTimeout(300);

  // ===== 1. 有最近到店记录：arrivalRecycle → 回收模式 + 定位该店 + 提示条 =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_arrival_last_store', '35-02 温州永嘉瓯北店');
    switchPage('record');
    arrivalRecycle();
  });
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => {
    const mf = document.getElementById('manualForm');
    return {
      manualVisible: mf && mf.style.display !== 'none',
      header: document.getElementById('manualHeaderLabel')?.textContent.trim(),
      tipVisible: document.getElementById('arrivalTipBar')?.style.display !== 'none',
      tipStore: document.getElementById('arrivalTipStore')?.textContent.trim(),
      curIdx: currentStoreIdx,
      curStore: document.querySelector('#recordStoreChips .store-chip.active')?.textContent.replace(/\s+/g, ' ').trim(),
      recoverCol: !!document.getElementById('giOut0'),
      emitColHidden: !document.getElementById('giIn0') || document.getElementById('giIn0') === null
    };
  });
  T('进回收模式（manualForm 显示）', r1.manualVisible, '');
  T('标题为回收 - 手动录入', (r1.header || '').includes('回收'), r1.header);
  T('到店提示条显示', r1.tipVisible, '');
  T('提示条店名 = 最近到店店', r1.tipStore === '35-02 温州永嘉瓯北店', r1.tipStore);
  T('自动选中该店', (r1.curStore || '').includes('35-02 温州永嘉瓯北店'), r1.curStore);
  T('只显示回收列（giOut 存在）', r1.recoverCol, '');
  T('回收模式无发出列（giIn 不存在）', r1.emitColHidden, '');

  // ===== 2. 切换门店弹窗 =====
  await page.evaluate(() => { openSwitchStoreModal(); });
  await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#switchStoreList > div')];
    const cur = items.find(i => i.textContent.includes('当前'));
    return {
      visible: document.getElementById('switchStoreModal').classList.contains('show'),
      count: items.length,
      curText: cur ? cur.textContent.replace(/\s+/g, ' ').trim() : 'NONE'
    };
  });
  T('切换门店弹窗打开', r2.visible, '');
  T('门店列表 3 家', r2.count === 3, 'got ' + r2.count);
  T('当前门店有金标', (r2.curText || '').includes('35-02') && (r2.curText || '').includes('当前'), r2.curText);

  // 切到店1
  await page.evaluate(() => { pickSwitchStore(0); });
  await page.waitForTimeout(200);
  const r2b = await page.evaluate(() => ({
    closed: !document.getElementById('switchStoreModal').classList.contains('show'),
    tipStore: document.getElementById('arrivalTipStore')?.textContent.trim(),
    curStore: document.querySelector('#recordStoreChips .store-chip.active')?.textContent.replace(/\s+/g, ' ').trim()
  }));
  T('选择后弹窗关闭', r2b.closed, '');
  T('提示条店名更新为店1', r2b.tipStore === '35-01 温州永嘉上塘下堡店', r2b.tipStore);
  T('当前门店切为店1', (r2b.curStore || '').includes('35-01'), r2b.curStore);

  // ===== 3. 无最近到店记录 + GPS 失败 → 提示条隐藏（兜底不打断） =====
  await page.evaluate(() => {
    localStorage.removeItem('kuanwei_arrival_last_store');
    arrivalLastStoreIdx = -1;
    // GPS mock 失败
    navigator.geolocation = { getCurrentPosition: function(ok, err) { err && err({ code: 1 }); } };
    openRecoverArrival();
  });
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => ({
    tipHidden: document.getElementById('arrivalTipBar')?.style.display === 'none',
    manualVisible: document.getElementById('manualForm')?.style.display !== 'none'
  }));
  T('GPS 失败提示条隐藏（兜底）', r3.tipHidden, '');
  T('回收模式仍可用（不打断）', r3.manualVisible, '');

  // ===== 4. 单店 5 筐回收保存（qtyOut） =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_arrival_last_store', '35-01 温州永嘉上塘下堡店');
    currentStoreIdx = 0;
    renderStoreChips();
    reloadRecordInputs();
    document.getElementById('recordDate').value = '2026-08-08';
    document.getElementById('giOut0').value = '3';
    document.getElementById('giOut1').value = '5';
    document.getElementById('giOut2').value = '2';
    document.getElementById('giOut3').value = '1';
    document.getElementById('giOut4').value = '12';
    saveManualRecord();
  });
  await page.waitForTimeout(300);
  const r4 = await page.evaluate(() => {
    const data = loadData();
    const recs = data.filter(r => r.date === '2026-08-08' && r.storeIdx === 0);
    return {
      count: recs.length,
      outs: recs.map(r => r.qtyOut),
      goods: recs.map(r => r.goodsName),
      qtyIn: recs.some(r => r.qtyIn > 0)
    };
  });
  T('保存 5 条记录（5 筐）', r4.count === 5, 'got ' + r4.count);
  T('回收数量正确', JSON.stringify(r4.outs) === JSON.stringify([3,5,2,1,12]), JSON.stringify(r4.outs));
  T('筐类型齐全', JSON.stringify(r4.goods) === JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']), JSON.stringify(r4.goods));
  T('无发出数量（qtyIn 全 0）', !r4.qtyIn, '');

  // ===== 5. 通知点击消费：记录回筐（recycle）→ 回收页单店视图 =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_arrival_last_store', '35-03 温州永嘉桥下店');
    currentStoreIdx = 0;
    renderStoreChips();
    window.__pendingArrival = { storeName: '35-03 温州永嘉桥下店', action: 'recycle' };
    checkPendingArrival();
  });
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => ({
    tipStore: document.getElementById('arrivalTipStore')?.textContent.trim(),
    curStore: document.querySelector('#recordStoreChips .store-chip.active')?.textContent.replace(/\s+/g, ' ').trim()
  }));
  T('recycle 动作 → 定位到通知带的店', (r5.curStore || '').includes('35-03 温州永嘉桥下店'), r5.curStore);
  T('提示条显示该店', r5.tipStore === '35-03 温州永嘉桥下店', r5.tipStore);

  // ===== 6. 通知点击消费：导航去下一家（navigate）→ 高德 =====
  await page.evaluate(() => {
    window.__pendingArrival = { storeName: '35-02 温州永嘉瓯北店', action: 'navigate' };
    window.__navUrl = null;
    checkPendingArrival();
  });
  await page.waitForTimeout(300);
  const r6 = await page.evaluate(() => window.__navUrl);
  T('navigate 动作 → 打开高德导航', !!r6 && r6.indexOf('uri.amap.com/navigation') >= 0 && r6.indexOf('120.66') >= 0, r6 || 'NONE');

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
