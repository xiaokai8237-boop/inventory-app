// 需求2 字体替换后出图验证：首页 + 管理页 + 通知卡预览弹窗
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18666;
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(f)); }
  catch(e) { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], sort: 2 },
      { name: '35-04 温州永嘉黄田店', aliases: ['35-04'], sort: 3 },
      { name: '35-05 温州永嘉乌牛店', aliases: ['35-05'], sort: 4 },
      { name: '35-06 温州永嘉岩头店', aliases: ['35-06'], sort: 5 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    const today = new Date().toISOString().slice(0,10);
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([
      { id: 1, date: today, store: '35-01 温州永嘉上塘下堡店', goods: '鲜食筐', qtyIn: 12 },
      { id: 2, date: today, store: '35-02 温州永嘉瓯北店', goods: '冷藏筐', qtyIn: 8 },
      { id: 3, date: today, store: '35-03 温州永嘉桥下店', goods: '常温筐', qtyIn: 15 }
    ]));
    closeWelcome(false);
    localStorage.setItem('kuanwei_welcome_seen','1');
    document.querySelectorAll('#toast').forEach(t=>t.classList.remove('show'));
  });
  await page.waitForTimeout(300);
  // 首页
  await page.evaluate(() => { switchPage('record'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '_shot_221_font_home.png' });
  // 管理页
  await page.evaluate(() => { switchPage('manage'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '_shot_221_font_manage.png' });
  // 通知卡预览弹窗（用 .ntpv 的容器）
  await page.evaluate(() => {
    try { if (typeof openNotifyTemplatesPanel === 'function') openNotifyTemplatesPanel(); }
    catch(e) { console.log('no openNotifyTemplatesPanel'); }
  });
  await page.waitForTimeout(400);
  const ntp = await page.$('#notifyTemplatesPanel, #ntp-modal, .ntpv');
  if (ntp) {
    await ntp.screenshot({ path: '_shot_221_font_notify.png' });
    console.log('saved _shot_221_font_notify.png');
  }
  console.log('saved _shot_221_font_home.png / _shot_221_font_manage.png');
  await browser.close();
  server.close();
})();
