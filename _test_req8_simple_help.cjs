const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_simple_mode', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200); // 等 initSimpleMode
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });
  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };
  const pages = [['simple-home', '极简录入'], ['simple-records', '极简记录'], ['simple-settings', '极简设置']];
  for (const [pg, name] of pages) {
    await page.evaluate((p) => switchPage(p), pg);
    await page.waitForTimeout(350);
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('.page-help-btn');
      if (!b) return false;
      b.click(); return true;
    });
    await page.waitForTimeout(350);
    const title = await page.evaluate(() => document.getElementById('pageHelpTitle').textContent);
    const shown = await page.evaluate(() => document.getElementById('pageHelpModal').classList.contains('show'));
    check(name + ' 帮助按钮', clicked);
    check(name + ' 弹窗标题', shown && title.indexOf(name) >= 0, 'title=' + title);
    await page.evaluate(() => closePageHelp());
    await page.waitForTimeout(200);
  }
  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
