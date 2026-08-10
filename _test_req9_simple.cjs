// 需求9 极简模式验证：header 只在极简首页显示
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_simple_mode', '1'); // 极简模式
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200);
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });
  const vis = () => page.evaluate(() => {
    const h = document.querySelector('.header');
    return { display: getComputedStyle(h).display, rect: h.getBoundingClientRect() };
  });
  let pass = 0, fail = 0;
  const check = (n, ok) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n); } };

  // 当前应在极简首页 simple-home
  let s = await vis();
  check('极简首页(simple-home) header 显示', s.display !== 'none' && s.rect.height > 0);
  // 切极简记录页
  await page.evaluate(() => switchPage('simple-records'));
  await page.waitForTimeout(300);
  s = await vis();
  check('极简记录页 header 隐藏', s.display === 'none');
  // 切极简设置页
  await page.evaluate(() => switchPage('simple-settings'));
  await page.waitForTimeout(300);
  s = await vis();
  check('极简设置页 header 隐藏', s.display === 'none');
  // 切回极简首页
  await page.evaluate(() => switchPage('simple-home'));
  await page.waitForTimeout(300);
  s = await vis();
  check('切回极简首页 header 恢复', s.display !== 'none' && s.rect.height > 0);
  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
