// 需求8 设计稿截图：_design_229_v1.html → _design_229_1-1-v1.png
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
  const file = 'file:///' + path.resolve(__dirname, '_design_229_v1.html').replace(/\\/g, '/');
  await page.goto(file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, '_design_229_1-1-v1.png'), fullPage: true });
  await browser.close();
  console.log('截图完成: _design_229_1-1-v1.png');
})();
