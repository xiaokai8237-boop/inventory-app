// 截海报弹窗（JPEG 版 + 加载态）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => openInvitePage());
  await page.waitForTimeout(800); // 预加载完成
  // 测点击到图片显示的时间
  const t0 = Date.now();
  await page.evaluate(() => openPosterModal());
  await page.waitForFunction(() => {
    const img = document.getElementById('posterModalImg');
    return img && img.style.display === 'block';
  }, { timeout: 3000 });
  const elapsed = Date.now() - t0;
  await page.waitForTimeout(300);
  await page.screenshot({ path: '_shot_req8_speed.png' });
  await browser.close();
  console.log('预加载后 点击→图显示: ' + elapsed + 'ms');
})();
