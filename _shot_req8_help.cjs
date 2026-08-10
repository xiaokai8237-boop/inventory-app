// 需求8 现状截图：使用说明页 / 首页 / 发出页
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });

  // 1. 使用说明页（settings）
  await page.evaluate(() => switchPage('settings'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: '_shot_req8_help_settings.png', fullPage: false });
  // 使用说明页整页
  await page.screenshot({ path: '_shot_req8_help_settings_full.png', fullPage: true });

  // 2. 首页
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '_shot_req8_help_home.png' });

  // 3. 发出页（入口态）
  await page.evaluate(() => openEmitFlow());
  await page.waitForTimeout(500);
  await page.screenshot({ path: '_shot_req8_help_emit.png' });

  await browser.close();
  console.log('截图完成');
})();
