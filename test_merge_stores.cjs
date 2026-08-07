// 店面管理融合测试（#137 删除 + 定位行 + 通知栏管理按钮 + 深青金主题）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 18634;
const server = http.createServer((req, res) => {
  if (req.url === '/index.html' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.resolve('index.html')));
  } else {
    res.writeHead(404); res.end();
  }
});
const URL = `http://127.0.0.1:${PORT}/index.html`;
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      localStorage.setItem('kuanwei_welcome_seen', '1');
      localStorage.setItem('kuanwei_privacy_consent', '1');
      // 模拟登录态 + 预置店面数据（含一台已定位、一台未定位）
      localStorage.setItem('kuanwei_phone', '13800000000');
      localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify([
        { name: '35-12 温州永嘉上塘下堡店', aliases: [], sort: 1, lat: 28.154, lng: 120.699, address: '温州市永嘉县上塘镇下堡村' },
        { name: '18-06 罗森', aliases: [], sort: 2 }
      ]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    report('页面加载', await page.locator('#page-record').isVisible().catch(() => false));
    try { await page.locator("#welcomeModal.show button").first.click({ timeout: 1500 }); await page.waitForTimeout(300); } catch {}

    // 1. 管理页：店铺管理入口已删、通知栏管理已加、店面管理副标题更新
    await page.evaluate(() => switchPage('manage'));
    await page.waitForTimeout(300);
    report('店铺管理入口已删', await page.evaluate(() => {
      return ![...document.querySelectorAll('#page-manage .manage-item')].some(b => b.textContent.includes('店铺管理'));
    }));
    report('通知栏管理入口已加', await page.evaluate(() => {
      const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('通知栏管理'));
      return !!b && b.textContent.includes('提醒样式') && b.querySelector('svg');
    }));
    report('店面管理副标题更新', await page.evaluate(() => {
      const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('店面管理'));
      return b && b.textContent.includes('到店提醒') && b.textContent.includes('定位') && b.textContent.includes('家店');
    }));
    report('reminderStoresPanel 已删', await page.evaluate(() => !document.getElementById('reminderStoresPanel')));
    report('reminderStoreEditModal 已删', await page.evaluate(() => !document.getElementById('reminderStoreEditModal')));

    // 2. 打开店面管理面板：深青金主题生效 + 店卡渲染 + 定位行
    await page.evaluate(() => openStorePanel());
    await page.waitForTimeout(400);
    report('店面管理面板打开', await page.evaluate(() => {
      const p = document.getElementById('storeManagePanel');
      return p && p.style.display !== 'none';
    }));
    report('深青金主题生效', await page.evaluate(() => {
      const p = document.getElementById('storeManagePanel');
      const cs = getComputedStyle(p);
      return cs.getPropertyValue('--primary').trim() === '#E0C080';
    }));
    report('店卡渲染2家', await page.evaluate(() => document.querySelectorAll('#storeManagePanel .store-card').length === 2));
    report('已定位店显示定位', await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#storeManagePanel .store-card')];
      return cards.some(c => c.textContent.includes('已定位') && c.textContent.includes('下堡村'));
    }));
    report('未定位店显示点此录入', await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#storeManagePanel .store-card')];
      return cards.some(c => c.textContent.includes('未录定位') && c.textContent.includes('点此录入'));
    }));
    report('无emoji图标（店面面板）', await page.evaluate(() => {
      const p = document.getElementById('storeManagePanel');
      const html = p.innerHTML;
      return !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html);
    }));

    // 3. 定位行按钮点击 → toast 开发中
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#storeManagePanel .store-card')]
        .find(c => c.textContent.includes('未录定位')).querySelector('button');
      btn.click();
    });
    await page.waitForTimeout(200);
    report('点此录入提示开发中', await page.evaluate(() => {
      const t = document.querySelector('.toast');
      return t && (t.textContent.includes('开发中') || t.textContent.includes('定位录入'));
    }));

    // 4. 保存修改仍可用（店名编辑保存到 storeConfig；含编号自动提取为别名逻辑）
    await page.fill('#sName0', '35-12 温州永嘉(改)');
    await page.evaluate(() => saveStorePanelChanges());
    await page.waitForTimeout(300);
    report('保存修改仍可用', await page.evaluate(() => {
      const cfg = JSON.parse(localStorage.getItem('kuanwei_stores__13800000000'));
      // 编号 35-12 被自动提取为别名，店名保留纯店名
      return cfg[0].name === '温州永嘉(改)' && cfg[0].aliases.includes('35-12');
    }));

    // 5. 返回管理页
    await page.evaluate(() => backFromStorePanel());
    await page.waitForTimeout(300);
    report('返回管理页', await page.evaluate(() => document.getElementById('page-manage').classList.contains('active')));

    // 6. 通知栏管理按钮点击 → toast 开发中
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('通知栏管理'));
      b.click();
    });
    await page.waitForTimeout(200);
    report('通知栏管理点击提示', await page.evaluate(() => {
      const t = document.querySelector('.toast');
      return t && t.textContent.includes('开发中');
    }));

    // 7. 无 JS 错误
    const realErrors = errors.filter(e => !e.includes('Service worker') && !e.includes('file:') && !e.includes('401') && !e.includes('404'));
    report('无JS错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  } catch (e) {
    console.log('EXCEPTION: ' + e.message);
  } finally {
    await browser.close();
    server.close();
  }
  const pass = results.filter(r => r.ok).length;
  console.log(`===== ${pass} 通过 / ${results.length - pass} 失败 =====`);
  if (results.some(r => !r.ok)) process.exit(1);
})();
