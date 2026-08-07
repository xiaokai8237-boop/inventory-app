// #138 门店定位录入 Playwright 测试
// 覆盖：弹窗打开/未录定位状态/已定位状态/到店点一下(模拟)/地图搜索(模拟UI)/保存/清除/重录/店卡联动
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18643;
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
  page.setDefaultTimeout(15000);

  // 拦截高德脚本：不真实加载，模拟 window.AMap
  await page.route('**webapi.amap.com**', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.AMapLoadedStub=1;' });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 准备测试数据（真实键：kuanwei_stores__{phone}）
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-12 温州永嘉上塘下堡店', aliases: ['35-12'], sort: 0 },
      { name: '36-08 杭州滨江店', aliases: ['36-08'], sort: 1, lat: 30.2084, lng: 120.2111, address: '浙江省杭州市滨江区江南大道' },
      { name: '37-01 宁波鄞州店', aliases: ['37-01'], sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
  });

  // 打开店面管理
  await page.evaluate(() => {
    // 直接调用 openStorePanel（跳过登录等）
    try { openStorePanel(); } catch(e) { console.log('openStorePanel err:', e.message); }
  });
  await page.waitForTimeout(400);

  // ===== 1. 未录定位店卡显示 =====
  const cards = await page.$$eval('.store-card', els => els.length);
  T('店卡渲染 3 个', cards === 3, 'got ' + cards);

  const cardText = await page.$eval('#storeListPanel', el => el.textContent);
  T('未录定位文案存在', cardText.includes('未录定位'), '');
  T('已定位文案存在', cardText.includes('已定位 · 浙江省杭州市滨江区江南大道'), '');

  // ===== 2. 点「点此录入」打开弹窗 =====
  // 第一个店（未录定位）的点此录入按钮
  await page.evaluate(() => { openLocEntryModal(0); });
  await page.waitForTimeout(300);
  const modalShown = await page.evaluate(() => {
    const m = document.getElementById('locEntryModal');
    return m.classList.contains('show') && m.style.display === 'flex';
  });
  T('弹窗打开（show+flex）', modalShown, '');

  const storeName = await page.$eval('#locStoreName', el => el.textContent);
  T('门店名提示正确', storeName.includes('35-12 温州永嘉上塘下堡店'), storeName);

  const statusBarShown = await page.evaluate(() => document.getElementById('locStatusBar').style.display);
  T('未定位店不显示已定位状态条', statusBarShown === 'none', statusBarShown);

  const gpsBtn = await page.$eval('.loc-way-gps', el => el.textContent);
  T('到店点一下按钮存在', gpsBtn.includes('到店点一下'), '');

  // ===== 3. 模拟「到店点一下」成功 =====
  await page.evaluate(() => {
    // 模拟 geolocation（navigator.geolocation 是只读属性，需 defineProperty）
    let geoCb = null;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: function() {
        return {
          getCurrentPosition: function(ok, err, opts) { window.__geoOpts = opts; geoCb = ok; window.__geoCallback = ok; },
          watchPosition: function() {}
        };
      }
    });
  });
  await page.evaluate(() => { locGetGps(); });
  await page.waitForTimeout(200);
  // 逆地址需要 AMap，先设置 AMap mock（在触发 GPS 回调前，避免 locRegeo 走 loadAMap 分支）
  await page.evaluate(() => {
    window.AMap = {
      plugin: (plugins, cb) => { cb(); },
      Geocoder: function() {
        return { getAddress: (coord, cb2) => cb2('complete', { regeocode: { formattedAddress: '浙江省杭州市滨江区江南大道228号' } }) };
      }
    };
  });
  // 触发回调（模拟定位成功：杭州滨江）
  await page.evaluate(() => {
    window.__geoCallback({ coords: { latitude: 30.2084, longitude: 120.2111, accuracy: 10 } });
  });
  await page.waitForTimeout(300);
  const pendingText = await page.$eval('#locPendingText', el => el.textContent);
  T('到店点一下显示解析后地址', pendingText.includes('浙江省杭州市滨江区江南大道228号'), pendingText);

  // ===== 4. 保存定位 =====
  await page.evaluate(() => { locSave(); });
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('kuanwei_stores__13800000000'));
    return cfg[0];
  });
  T('保存写入 lat/lng/address', saved.lat === 30.2084 && saved.lng === 120.2111 && saved.address.includes('江南大道228号'), JSON.stringify(saved));

  const modalClosed = await page.evaluate(() => document.getElementById('locEntryModal').classList.contains('show'));
  T('保存后弹窗关闭', !modalClosed, '');
  T('店卡更新为已定位', (await page.$eval('#storeListPanel', el => el.textContent)).includes('已定位 · 浙江省杭州市滨江区江南大道228号'), '');

  // ===== 5. 重录：已定位店再点「重录」 =====
  await page.evaluate(() => { openLocEntryModal(0); });
  await page.waitForTimeout(300);
  const statusBarShown2 = await page.evaluate(() => document.getElementById('locStatusBar').style.display);
  T('已定位店显示状态条', statusBarShown2 === 'flex', statusBarShown2);

  // ===== 6. 清除定位 =====
  await page.evaluate(() => { clearLocForStore(); });
  await page.waitForTimeout(200);
  const clearedStatus = await page.evaluate(() => document.getElementById('locStatusBar').style.display);
  T('清除后状态条隐藏', clearedStatus === 'none', clearedStatus);

  // ===== 7. 地图搜索选点 UI =====
  await page.evaluate(() => { locToggleSearch(); });
  await page.waitForTimeout(200);
  const mapWrapShown = await page.evaluate(() => document.getElementById('locMapWrap').style.display);
  T('地图搜索展开', mapWrapShown === 'block', mapWrapShown);

  // 模拟搜索
  await page.evaluate(() => {
    document.getElementById('locSearchInput').value = '上塘下堡';
    var poi1 = { name: '上塘下堡村', pname: '浙江省', cityname: '温州市', adname: '永嘉县', address: '上塘镇下堡村', location: { lng: 120.6919, lat: 28.1539 } };
    var poi2 = { name: '上塘镇', pname: '浙江省', cityname: '温州市', adname: '永嘉县', address: '上塘镇', location: { lng: 120.6895, lat: 28.1542 } };
    window.AMap.PlaceSearch = function() {
      return {
        search: function(kw, cb) {
          cb('complete', { poiList: { pois: [poi1, poi2] } });
        }
      };
    };
  });
  await page.evaluate(() => { locDoSearch(); });
  await page.waitForTimeout(300);
  const resultItems = await page.$$eval('.loc-result-item', els => els.length);
  T('搜索结果渲染', resultItems === 2, 'got ' + resultItems);

  // 选点
  await page.evaluate(() => { locPickResult(0); });
  await page.waitForTimeout(200);
  const pickPending = await page.$eval('#locPendingText', el => el.textContent);
  T('选点显示地址', pickPending.includes('浙江省温州市永嘉县上塘下堡村'), pickPending);

  // 保存选点
  await page.evaluate(() => { locSave(); });
  await page.waitForTimeout(300);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_stores__13800000000'))[0]);
  T('地图选点保存成功', saved2.lat === 28.1539 && saved2.lng === 120.6919 && saved2.address.includes('上塘下堡村'), JSON.stringify(saved2));

  // ===== 8. 保存前未选定位 → 提示 =====
  await page.evaluate(() => { openLocEntryModal(1); });
  await page.waitForTimeout(200);
  // 已定位店1直接保存（保留旧定位）
  await page.evaluate(() => { locSave(); });
  await page.waitForTimeout(200);
  const keepOld = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_stores__13800000000'))[1]);
  T('重录未选新定位时保留旧定位', keepOld.lat === 30.2084 && keepOld.address.includes('江南大道'), JSON.stringify(keepOld));

  // 未录定位店直接保存 → 提示
  await page.evaluate(() => { openLocEntryModal(2); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = showToast;
    // 通过覆盖方式收集 toast（不依赖 DOM，因为 toast 会消失）
    showToast = function(m) { window.__toasts.push(m); return orig.apply(null, arguments); };
  });
  await page.evaluate(() => { locSave(); });
  await page.waitForTimeout(200);
  const toasts = await page.evaluate(() => window.__toasts);
  T('未选定位保存有提示', toasts.some(t => t.includes('请先选择定位方式')), JSON.stringify(toasts));

  // ===== 9. 关闭弹窗 =====
  await page.evaluate(() => { closeLocEntryModal(); });
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => !document.getElementById('locEntryModal').classList.contains('show'));
  T('弹窗关闭正常', closed, '');

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
