// #149 极简模式测试：切换机制 + 独立导航 + 总数录入 + 范围记录 + 差额 + 数据独立
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18762;
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
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    window.Notification = { permission: 'granted' };
    // 清掉旧极简数据
    localStorage.removeItem('kuanwei_simple_records__13800000000');
    localStorage.removeItem('kuanwei_simple_mode');
  });
  await page.waitForTimeout(400);

  // ===== 1. 标准模式：设置页有「界面风格」切换卡 =====
  console.log('=== 1. 标准模式切换入口 ===');
  await page.evaluate(() => switchPage('settings'));
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => ({
    hasCard: !!document.querySelector('.style-switch-card'),
    btnText: document.querySelector('.style-switch-card .ssc-btn')?.textContent.replace(/\s+/g, ' ').trim()
  }));
  T('设置页有界面风格切换卡', r1.hasCard, JSON.stringify(r1));
  T('切换按钮「切换到极简」', (r1.btnText || '').includes('切换到极简'), r1.btnText);

  // ===== 2. 切换极简 =====
  console.log('=== 2. 切换极简 ===');
  await page.evaluate(() => setSimpleMode(true));
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => ({
    bodySimple: document.body.classList.contains('simple-mode'),
    simpleHomeActive: document.querySelector('#page-simple-home')?.classList.contains('active'),
    stdTabsHidden: getComputedStyle(document.querySelector('.tabs')).display === 'none',
    simpleTabsShown: getComputedStyle(document.querySelector('.simple-tabs')).display === 'flex',
    stdPagesHidden: getComputedStyle(document.querySelector('#page-record')).display === 'none',
    labels: [...document.querySelectorAll('.simple-tabs .st-item')].map(n => n.textContent.trim()),
    active: document.querySelector('.simple-tabs .st-item.active')?.textContent.trim(),
    modeSaved: localStorage.getItem('kuanwei_simple_mode')
  }));
  T('body 有 simple-mode', r2.bodySimple, '');
  T('极简首页激活', r2.simpleHomeActive, '');
  T('标准底部导航隐藏', r2.stdTabsHidden, '');
  T('极简底部导航显示', r2.simpleTabsShown, '');
  T('标准页面隐藏', r2.stdPagesHidden, '');
  T('独立导航=首页/记录/设置', JSON.stringify(r2.labels) === JSON.stringify(['首页','记录','设置']), JSON.stringify(r2.labels));
  T('首页按钮高亮', r2.active === '首页', r2.active);
  T('模式持久化=1', r2.modeSaved === '1', r2.modeSaved);

  // ===== 3. 极简首页：5 筐行 + 日期/时间默认 =====
  console.log('=== 3. 极简首页 ===');
  const r3 = await page.evaluate(() => {
    const today = new Date();
    const td = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    const now = String(today.getHours()).padStart(2,'0') + ':' + String(today.getMinutes()).padStart(2,'0');
    return {
      rows: document.querySelectorAll('#simpleGoodsList .sim-row').length,
      outInputs: document.querySelectorAll('#simpleGoodsList .sr-out').length,
      recInputs: document.querySelectorAll('#simpleGoodsList .sr-rec').length,
      names: [...document.querySelectorAll('#simpleGoodsList .sr-name')].map(n => n.textContent.replace(/\s+/g, '').trim()),
      dateVal: document.getElementById('simpleDate')?.value,
      timeVal: document.getElementById('simpleTime')?.value,
      dateOk: document.getElementById('simpleDate')?.value === td,
      timeOk: (document.getElementById('simpleTime')?.value || '').startsWith(now.slice(0,2)),
      saveBtn: document.querySelector('.sim-save')?.textContent.replace(/\s+/g, ' ').trim()
    };
  });
  T('5 筐行渲染', r3.rows === 5, String(r3.rows));
  T('每筐有发出+回收输入框', r3.outInputs === 5 && r3.recInputs === 5, r3.outInputs + '/' + r3.recInputs);
  T('筐名=5 种', r3.names.length === 5, JSON.stringify(r3.names));
  T('日期默认今天', r3.dateOk, r3.dateVal);
  T('时间默认当前小时', r3.timeOk, r3.timeVal);
  T('保存按钮文案=保存', (r3.saveBtn || '').includes('保存'), r3.saveBtn);

  // ===== 4. 保存：数据独立 + 时间默认当前 =====
  console.log('=== 4. 保存 ===');
  await page.evaluate(() => {
    document.getElementById('simpleDate').value = '2026-08-09';
    document.getElementById('simOut_0').value = '12';
    document.getElementById('simRec_0').value = '10';
    document.getElementById('simOut_4').value = '83';
    document.getElementById('simRec_4').value = '80';
  });
  const r4 = await page.evaluate(() => {
    saveSimpleRecord();
    const rows = JSON.parse(localStorage.getItem('kuanwei_simple_records__13800000000') || '[]');
    return { rows: rows.length, last: rows[rows.length - 1] };
  });
  T('保存 1 条', r4.rows === 1, String(r4.rows));
  T('日期正确', r4.last && r4.last.d === '2026-08-09', JSON.stringify(r4.last && r4.last.d));
  T('时间=当前时间(未改)', r4.last && /^\d{2}:\d{2}$/.test(r4.last.t || ''), r4.last && r4.last.t);
  T('发出数正确', JSON.stringify(r4.last && r4.last.out) === JSON.stringify([12,0,0,0,83]), JSON.stringify(r4.last && r4.last.out));
  T('回收数正确', JSON.stringify(r4.last && r4.last.rec) === JSON.stringify([10,0,0,0,80]), JSON.stringify(r4.last && r4.last.rec));
  // 标准模式数据 key 未被污染
  const stdData = await page.evaluate(() => localStorage.getItem('kuanwei_inventory_data'));
  T('标准模式数据未污染', stdData === null, 'stdData=' + String(stdData).slice(0, 30));

  // ===== 5. 时间改了用改的值 =====
  console.log('=== 5. 改时间保存 ===');
  await page.evaluate(() => {
    const tEl = document.getElementById('simpleTime');
    tEl.value = '14:30';
    tEl.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('simOut_1').value = '5';
    saveSimpleRecord();
  });
  const r5 = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('kuanwei_simple_records__13800000000') || '[]');
    return { rows: rows.length, lastT: rows[rows.length - 1].t, lastOut1: rows[rows.length - 1].out[1] };
  });
  T('共 2 条', r5.rows === 2, String(r5.rows));
  T('时间=用户改的 14:30', r5.lastT === '14:30', r5.lastT);
  T('第2条面包发出 5', r5.lastOut1 === 5, String(r5.lastOut1));

  // ===== 6. 记录页：范围统计 + 差额 =====
  console.log('=== 6. 记录统计 ===');
  await page.evaluate(() => switchPage('simple-records'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('simpleFrom').value = '2026-08-01T00:00';
    document.getElementById('simpleTo').value = '2026-08-09T23:59';
    renderSimpleRecords();
  });
  const r6 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#simpleRecRows .rt-row').length,
    diff0: document.querySelector('#simpleRecRows .rt-row .rt-diff')?.textContent.trim(),
    diff0Cls: document.querySelector('#simpleRecRows .rt-row .rt-diff')?.className,
    diff1: document.querySelectorAll('#simpleRecRows .rt-row .rt-diff')[1]?.textContent.trim(),
    diff4: document.querySelectorAll('#simpleRecRows .rt-row .rt-diff')[4]?.textContent.trim(),
    emptyHidden: document.getElementById('simpleRecEmpty')?.style.display === 'none'
  }));
  T('5 筐行显示', r6.rows === 5, String(r6.rows));
  T('鲜食差额=-2(回收10-发出12)', r6.diff0 === '-2', r6.diff0);
  T('差额负数为红色类', (r6.diff0Cls || '').includes('neg'), r6.diff0Cls);
  T('面包差额=-5(回收0-发出5)', r6.diff1 === '-5', r6.diff1);
  T('常温差额=-3', r6.diff4 === '-3', r6.diff4);
  T('空态隐藏', r6.emptyHidden, '');

  // ===== 7. 记录范围外不统计 =====
  console.log('=== 7. 范围过滤 ===');
  await page.evaluate(() => {
    document.getElementById('simpleFrom').value = '2026-08-10T00:00';
    document.getElementById('simpleTo').value = '2026-08-11T00:00';
    renderSimpleRecords();
  });
  const r7 = await page.evaluate(() => ({
    emptyShown: document.getElementById('simpleRecEmpty')?.style.display === 'block',
    rows: document.querySelectorAll('#simpleRecRows .rt-row').length
  }));
  T('范围外显示空态', r7.emptyShown && r7.rows === 0, JSON.stringify(r7));

  // ===== 8. 极简设置页 =====
  console.log('=== 8. 极简设置 ===');
  await page.evaluate(() => switchPage('simple-settings'));
  await page.waitForTimeout(300);
  const r8 = await page.evaluate(() => ({
    segs: [...document.querySelectorAll('#page-simple-settings .sim-set-card .sim-seg .sg')].slice(0, 2).map(s => s.textContent.trim()),
    segOn: document.querySelector('#page-simple-settings .sim-set-card .sim-seg .sg.on')?.textContent.trim(),
    loginSeg: document.getElementById('simpleAccountSeg')?.textContent.trim(),
    expLines: document.querySelectorAll('.sim-exp .e-line').length,
    ver: document.getElementById('simpleVersion')?.textContent.trim()
  }));
  T('界面风格=标准/极简', JSON.stringify(r8.segs) === JSON.stringify(['标准','极简']), JSON.stringify(r8.segs));
  T('极简为当前选中', r8.segOn === '极简', r8.segOn);
  T('账号段显示已登录手机号', (r8.loginSeg || '').includes('13800000000'), r8.loginSeg);
  T('极简说明 4 条', r8.expLines === 4, String(r8.expLines));
  T('版本号显示', (r8.ver || '').startsWith('v7.8'), r8.ver);

  // ===== 9. 切回标准 =====
  console.log('=== 9. 切回标准 ===');
  await page.evaluate(() => setSimpleMode(false));
  await page.waitForTimeout(300);
  const r9 = await page.evaluate(() => ({
    bodySimple: document.body.classList.contains('simple-mode'),
    recordActive: document.querySelector('#page-record')?.classList.contains('active'),
    stdTabsShown: getComputedStyle(document.querySelector('.tabs')).display !== 'none',
    modeSaved: localStorage.getItem('kuanwei_simple_mode')
  }));
  T('body 移除 simple-mode', !r9.bodySimple, '');
  T('回到标准首页', r9.recordActive, '');
  T('标准导航恢复', r9.stdTabsShown, '');
  T('模式持久化=0', r9.modeSaved === '0', r9.modeSaved);

  // ===== 10. 未登录拦截 =====
  console.log('=== 10. 未登录拦截 ===');
  await page.evaluate(() => { localStorage.setItem('kuanwei_logged_in', '0'); setSimpleMode(true); });
  await page.waitForTimeout(300);
  const r10 = await page.evaluate(() => {
    const before = localStorage.getItem('kuanwei_simple_records__13800000000') || '[]';
    const cntBefore = JSON.parse(before).length;
    document.getElementById('simOut_0').value = '9';
    saveSimpleRecord();
    const after = JSON.parse(localStorage.getItem('kuanwei_simple_records__13800000000') || '[]').length;
    const authOpen = document.querySelector('#page-login')?.classList.contains('active');
    return { cntBefore, after, authOpen };
  });
  T('未登录不保存', r10.after === r10.cntBefore, r10.cntBefore + '->' + r10.after);
  T('弹出登录页', r10.authOpen, '');

  T('全程 JS 零错误', errs.length === 0, errs.join(';'));
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})();
