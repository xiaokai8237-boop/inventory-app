// 截 #238 新界面：框名设置面板 + 新增框弹窗
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
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  // 1. 新面板
  await page.evaluate(() => { switchPage('manage'); openGoodsPanel(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '_shot_req238_new_panel.png' });
  // 2. 新增弹窗
  await page.evaluate(() => showAddGoodsModal());
  await page.waitForTimeout(300);
  await page.screenshot({ path: '_shot_req238_add_modal.png' });
  await browser.close();
  console.log('OK');
})();
