// #153 模式选择页测试：设置页入口 + 双模式切换 + 说明 + 当前标记 + 返回
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18766;
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(f)); }
  catch(e) { res.writeHead(404); res.end(); }
});

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_perm_guide_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.removeItem('kuanwei_simple_mode');
    window.Notification = { permission: 'granted' };
  });
  await page.waitForTimeout(300);

  // ===== 1. 标准设置页模式选择入口 =====
  console.log('=== 1. 标准设置页无模式选择入口（已删除）===');
  await page.evaluate(() => switchPage('settings'));
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => ({
    hasCard: !!document.querySelector('.style-switch-card'),
    hasSsc: !!document.querySelector('.ssc-btn')
  }));
  T('使用说明页无模式选择入口卡', !r1.hasCard && !r1.hasSsc, JSON.stringify(r1));

  // ===== 2. 标准态模式选择页（直接打开）=====
  console.log('=== 2. 模式选择页（标准态）===');
  await page.evaluate(() => openModeSelect());
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => ({
    active: document.querySelector('#page-mode-select')?.classList.contains('active'),
    stdCur: document.getElementById('msStdCur')?.textContent.trim(),
    minCur: document.getElementById('msMinCur')?.textContent.trim(),
    stdBtnCur: document.getElementById('msStdBtn')?.classList.contains('cur'),
    minBtnText: document.getElementById('msMinBtn')?.textContent.replace(/\s+/g, ' ').trim(),
    stdLi: document.querySelectorAll('.ms-card.std .mc-li').length,
    minLi: document.querySelectorAll('.ms-card.min .mc-li').length,
    noEmoji: !(document.querySelector('#page-mode-select').textContent.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/u))
  }));
  T('模式选择页打开', r2.active, '');
  T('标准=当前使用中', r2.stdCur === '当前使用中', r2.stdCur);
  T('极简=未使用', r2.minCur === '未使用', r2.minCur);
  T('标准按钮置灰', r2.stdBtnCur, '');
  T('极简按钮=切换到极简', (r2.minBtnText || '').includes('切换到极简'), r2.minBtnText);
  T('两模式各 4 条说明', r2.stdLi === 4 && r2.minLi === 4, r2.stdLi + '/' + r2.minLi);
  T('零 emoji', r2.noEmoji, '');

  // ===== 3. 切极简 =====
  console.log('=== 3. 切极简 ===');
  await page.evaluate(() => doModeSwitch(true));
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => ({
    simple: document.body.classList.contains('simple-mode'),
    home: document.querySelector('#page-simple-home')?.classList.contains('active'),
    mode: localStorage.getItem('kuanwei_simple_mode')
  }));
  T('进入极简模式', r3.simple, '');
  T('进入极简首页', r3.home, '');
  T('模式持久化=1', r3.mode === '1', r3.mode);

  // ===== 4. 极简设置页入口 → 模式选择页（极简态）=====
  console.log('=== 4. 极简态模式选择页 ===');
  await page.evaluate(() => switchPage('simple-settings'));
  await page.waitForTimeout(300);
  await page.click('.sim-set-card[onclick*="openModeSelect"]');
  await page.waitForTimeout(300);
  const r4 = await page.evaluate(() => ({
    active: document.querySelector('#page-mode-select')?.classList.contains('active'),
    visible: getComputedStyle(document.querySelector('#page-mode-select')).display !== 'none',
    stdCur: document.getElementById('msStdCur')?.textContent.trim(),
    minCur: document.getElementById('msMinCur')?.textContent.trim(),
    minBtnCur: document.getElementById('msMinBtn')?.classList.contains('cur'),
    stdBtnText: document.getElementById('msStdBtn')?.textContent.replace(/\s+/g, ' ').trim()
  }));
  T('极简态模式选择页可打开且显示', r4.active && r4.visible, JSON.stringify(r4));
  T('极简=当前使用中', r4.minCur === '当前使用中' && r4.minBtnCur, r4.minCur);
  T('标准=未使用且可切换', r4.stdCur === '未使用' && (r4.stdBtnText || '').includes('切换到标准'), r4.stdCur);

  // ===== 5. 返回 =====
  console.log('=== 5. 返回 ===');
  await page.evaluate(() => backFromModeSelect());
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => document.querySelector('#page-simple-settings')?.classList.contains('active'));
  T('返回极简设置页', r5, '');

  // ===== 6. 切回标准 =====
  console.log('=== 6. 切回标准 ===');
  await page.evaluate(() => { switchPage('simple-settings'); openModeSelect(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => doModeSwitch(false));
  await page.waitForTimeout(300);
  const r6 = await page.evaluate(() => ({
    simple: document.body.classList.contains('simple-mode'),
    record: document.querySelector('#page-record')?.classList.contains('active'),
    mode: localStorage.getItem('kuanwei_simple_mode')
  }));
  T('退出极简模式', !r6.simple, '');
  T('回标准首页', r6.record, '');
  T('模式持久化=0', r6.mode === '0', r6.mode);

  // ===== 7. 标准模式返回入口 =====
  console.log('=== 7. 标准模式返回 ===');
  await page.evaluate(() => { switchPage('settings'); openModeSelect(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => backFromModeSelect());
  await page.waitForTimeout(300);
  const r7 = await page.evaluate(() => document.querySelector('#page-settings')?.classList.contains('active'));
  T('返回标准设置页', r7, '');

  T('全程 JS 零错误', errs.length === 0, errs.join(';'));
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})();
