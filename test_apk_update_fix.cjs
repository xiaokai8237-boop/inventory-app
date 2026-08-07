// APK 更新修复验证：不再信任本地缓存坏文件，一律重新下载
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18695;
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

  // 1. showApkUpdate：即使 apkDownloadedCache=true，按钮文字保持"立即更新"（不显示"立即安装"）
  const r1 = await page.evaluate(() => {
    apkDownloadedCache = true; // 模拟：本地缓存了旧下载包
    showApkUpdate({ versionName: '7.3.7', note: 'test', apkUrl: 'https://x/app-v7.3.7.apk' });
    const btn = document.getElementById('apkUpdateBtn');
    const text = btn ? btn.textContent.trim() : '';
    const modalShown = document.getElementById('apkUpdateModal').classList.contains('show');
    return { text, modalShown };
  });
  T('弹窗打开', r1.modalShown, '');
  T('按钮不显示"立即安装"（避免装缓存坏文件）', r1.text !== '立即安装', 'got: ' + r1.text);
  T('按钮显示"立即更新/立即下载"', /立即/.test(r1.text), 'got: ' + r1.text);

  // 2. doApkUpdate：apkDownloadedCache=true 时仍走下载分支（不直接 installDownloaded）
  const r2 = await page.evaluate(() => {
    // 模拟 Capacitor AppUpdate 插件
    const calls = [];
    window.Capacitor = { Plugins: { AppUpdate: {
      downloadAndInstall: (o) => { calls.push('download:' + o.url); return Promise.resolve(); },
      installDownloaded: () => { calls.push('install'); return Promise.resolve(); },
      getDownloadProgress: () => Promise.resolve({ progress: 50, status: 2 })
    } } };
    apkDownloadedCache = true;
    doApkUpdate();
    return { calls: calls.slice() };
  });
  T('doApkUpdate 走重新下载（downloadAndInstall）', r2.calls.length > 0 && r2.calls[0].startsWith('download:'), JSON.stringify(r2.calls));
  T('下载的是新 URL', r2.calls[0] === 'download:https://x/app-v7.3.7.apk', JSON.stringify(r2.calls));
  T('没有直接 installDownloaded', !r2.calls.includes('install'), JSON.stringify(r2.calls));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
