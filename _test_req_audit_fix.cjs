// 走查修复冒烟：manualEntry拦截/极简版本号/对账帮助按钮/今日状态无emoji
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  console.log('=== 1. 未登录点回收 → 拦截切登录页 ===');
  await page.evaluate(() => manualEntry('out'));
  await page.waitForTimeout(400);
  const loginShown = await page.evaluate(() => document.getElementById('page-login') && document.getElementById('page-login').classList.contains('active'));
  const formShown = await page.evaluate(() => document.getElementById('manualForm').style.display === 'block');
  check('未登录切到登录页', !!loginShown);
  check('未登录不进表单', !formShown);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  console.log('=== 2. 已登录点回收 → 进表单 ===');
  await page.evaluate(() => { localStorage.setItem('kuanwei_phone','13800138000'); localStorage.setItem('kuanwei_logged_in','1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => manualEntry('out'));
  await page.waitForTimeout(300);
  const formShown2 = await page.evaluate(() => document.getElementById('manualForm').style.display === 'block');
  check('已登录进表单', formShown2);

  console.log('=== 3. 极简版本号动态 ===');
  await page.evaluate(() => { localStorage.setItem('kuanwei_simple_mode','1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => switchPage('simple-settings'));
  await page.waitForTimeout(300);
  const ver = await page.evaluate(() => document.getElementById('simpleVersion')?.textContent);
  check('极简版本号 = v8.2.14', ver === 'v8.2.14', 'got=' + ver);
  await page.evaluate(() => { localStorage.setItem('kuanwei_simple_mode','0'); localStorage.removeItem('kuanwei_simple_mode'); });

  console.log('=== 4. 对账页帮助按钮 ===');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => switchPage('reconcile'));
  await page.waitForTimeout(300);
  const helpBtn = await page.evaluate(() => {
    const b = document.querySelector('#page-reconcile .page-help-btn');
    return !!b;
  });
  check('对账页有帮助按钮', helpBtn);
  const helpOpens = await page.evaluate(() => {
    const b = document.querySelector('#page-reconcile .page-help-btn');
    b.click();
    return document.getElementById('pageHelpModal').classList.contains('show');
  });
  check('点帮助弹窗打开', helpOpens);
  await page.evaluate(() => closePageHelp());

  console.log('=== 5. 今日状态卡无emoji ===');
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(400);
  const statusHtml = await page.evaluate(() => document.getElementById('todayStatusCard').innerHTML);
  const emojiRe = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu;
  check('今日状态卡零 emoji', !emojiRe.test(statusHtml));

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
