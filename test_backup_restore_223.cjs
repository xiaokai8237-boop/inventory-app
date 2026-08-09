// #223 云端备份与恢复深度检查：极简数据 6 条路径一致性专项测试
// 覆盖：restoreFromCloud(启动兜底) + exportData(导出) + finishImport(导入) 三处修复
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const PORT = 18780;

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
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_perm_guide_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });

  // ===== 1. 代码级：三处修复点存在 =====
  const src = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  console.log('=== 1. 代码级三处修复点 ===');
  T('restoreFromCloud 兜底恢复 simpleRecords', src.includes("if (cloud.simpleRecords && Array.isArray(cloud.simpleRecords)) saveSimpleRecords(cloud.simpleRecords)"), '');
  const ri = src.indexOf('async function restoreFromCloud');
  T('restoreFromCloud 兜底恢复 uiState', src.indexOf("if (cloud.uiState && typeof applyUiState === 'function') applyUiState(cloud.uiState)", ri) > ri, '');
  T('exportData 导出 simpleRecords', src.includes('simpleRecords: loadSimpleRecords()'), '');
  T('finishImport 导入 simpleRecords', src.includes('if (obj.simpleRecords && Array.isArray(obj.simpleRecords))'), '');

  // ===== 2. 行为级：restoreFromCloud 启动兜底恢复极简数据 =====
  console.log('=== 2. restoreFromCloud 兜底恢复 ===');
  await page.evaluate(() => {
    window.__cloudPayload = {
      data: {
        records: [{ date: '2026-08-01', storeIdx: 0, goodsIdx: 0, qty: 3 }],
        goodsConfig: [{ name: '鲜食筐', aliases: [] }],
        storeConfig: [{ name: '测试店', aliases: [], sort: 0 }],
        uiState: { simpleMode: true },
        simpleRecords: [{ d: '2026-08-01', t: '10:00', out: [1,2,3,4,5], rec: [0,0,0,0,0] }],
        backupTime: '2099-01-01T00:00:00Z'
      }
    };
    window.__origFetch = window.fetch;
    window.fetch = async () => ({ json: async () => window.__cloudPayload });
  });
  await page.evaluate(() => restoreFromCloud());
  await page.waitForTimeout(600);
  const r2 = await page.evaluate(() => {
    const recs = JSON.parse(localStorage.getItem(scopeKey(SIMPLE_REC_KEY)) || '[]');
    return recs;
  });
  T('兜底恢复写入极简记录', Array.isArray(r2) && r2.length === 1 && r2[0].out[0] === 1, JSON.stringify(r2));
  await page.evaluate(() => { window.fetch = window.__origFetch; });

  // ===== 3. 行为级：exportData 导出文件含极简数据 =====
  console.log('=== 3. exportData 导出文件 ===');
  const r3 = await page.evaluate(() => {
    saveSimpleRecords([{ d: '2026-08-02', t: '11:00', out: [2,2,2,2,2], rec: [1,1,1,1,1] }]);
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:fake'; };
    exportData();
    URL.createObjectURL = origCreate;
    return new Promise((resolve) => {
      if (!captured) return resolve({ ok: false, err: 'no blob' });
      const reader = new FileReader();
      reader.onload = () => resolve({ ok: true, txt: reader.result });
      reader.readAsText(captured);
    });
  });
  if (r3.ok) {
    try {
      const obj = JSON.parse(r3.txt);
      const ok = Array.isArray(obj.simpleRecords) && obj.simpleRecords.length === 1 && obj.simpleRecords[0].d === '2026-08-02';
      T('导出文件含 simpleRecords', ok, obj.simpleRecords ? JSON.stringify(obj.simpleRecords) : 'missing key');
    } catch(e) { T('导出文件含 simpleRecords', false, 'parse err ' + e.message); }
  } else {
    T('导出文件含 simpleRecords', false, r3.err);
  }

  // ===== 4. 行为级：finishImport 导入极简数据 =====
  console.log('=== 4. finishImport 导入 ===');
  await page.evaluate(() => { localStorage.removeItem(scopeKey(SIMPLE_REC_KEY)); });
  await page.evaluate(() => {
    finishImport({ records: [], simpleRecords: [{ d: '2026-08-03', t: '09:00', out: [3,3,3,3,3], rec: [0,0,0,0,0] }] }, true);
  });
  const r4 = await page.evaluate(() => JSON.parse(localStorage.getItem(scopeKey(SIMPLE_REC_KEY)) || '[]'));
  T('finishImport 写入极简记录', Array.isArray(r4) && r4.length === 1 && r4[0].d === '2026-08-03', JSON.stringify(r4));

  // ===== 5. 回归确认：极简记录正常读写函数未破坏 =====
  console.log('=== 5. 极简记录读写回归 ===');
  await page.evaluate(() => { localStorage.removeItem(scopeKey(SIMPLE_REC_KEY)); });
  await page.evaluate(() => { saveSimpleRecords([{ d: '2026-08-04', t: '08:00', out: [4,4,4,4,4], rec: [0,0,0,0,0] }]); });
  const r5 = await page.evaluate(() => loadSimpleRecords());
  T('saveSimpleRecords/loadSimpleRecords 正常', Array.isArray(r5) && r5.length === 1 && r5[0].d === '2026-08-04', JSON.stringify(r5));

  await browser.close();
  server.close();
  console.log('\n结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
})();
