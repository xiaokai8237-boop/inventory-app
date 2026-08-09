// 定位覆盖修复专项测试（#226 需求3 之后用户反馈：保存定位后重开被云端旧数据覆盖）
// 验证：restoreFromCloud 在"本地店面比云端新"时，不得用云端旧 storeConfig 覆盖本地定位
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const PORT = 18791;

const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(path.join(DIR, f))); }
  catch(e) { res.writeHead(404); res.end(); }
});

let passed = 0, failed = 0;
function T(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '  => ' + extra : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });

  // 1. stub fetch：云端备份时间是旧的，storeConfig 是旧定位
  await page.addInitScript(() => {
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).includes('/backup')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            backupTime: '2026-08-08T10:00:00.000Z', // 云端旧（昨天）
            records: [],
            storeConfig: [
              { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0, lat: 27.9000, lng: 120.8000, address: '旧定位地址' }
            ],
            goodsConfig: [],
            uiState: null,
            simpleRecords: []
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 2. 先本地保存店面：定位是新值，本地保存时间 = 现在（比云端新）
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0, lat: 28.1000, lng: 121.2000, address: '新定位地址' }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_last_save', new Date().toISOString()); // 本地比云端新
    localStorage.removeItem('kuanwei_last_delete');
  });

  // 3. 触发启动兜底恢复（模拟重开 APP）
  await page.evaluate(async () => {
    try { await restoreFromCloud(); } catch(e) {}
  });
  await page.waitForTimeout(600);

  // 4. 断言：本地定位保留新值，没被云端旧值覆盖
  const result = await page.evaluate(() => {
    const cfg = loadStoreConfig();
    const s = cfg[0];
    return { lat: s.lat, lng: s.lng, address: s.address, name: s.name };
  });

  T('本地店面比云端新 → 定位保留新值', result.lat === 28.1000 && result.lng === 121.2000,
    '实际 lat=' + result.lat + ' lng=' + result.lng + ' addr=' + result.address);
  T('地址保留新值', result.address === '新定位地址', '实际=' + result.address);
  T('店面名未被清空', result.name === '35-01 温州永嘉上塘下堡店', '实际=' + result.name);

  // 5. 反向场景：本地店面为空 → 云端店面应恢复
  await page.evaluate(() => {
    localStorage.removeItem('kuanwei_stores__13800000000');
    localStorage.removeItem('kuanwei_last_save');
  });
  await page.evaluate(async () => { try { await restoreFromCloud(); } catch(e) {} });
  await page.waitForTimeout(600);
  const restored = await page.evaluate(() => {
    const cfg = loadStoreConfig();
    return { len: cfg.length, lat: cfg[0] ? cfg[0].lat : null };
  });
  T('本地店面为空 → 从云端恢复店面', restored.len === 1 && restored.lat === 27.9000,
    '实际 len=' + restored.len + ' lat=' + restored.lat);

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
