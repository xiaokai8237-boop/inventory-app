// 店面面板定位行修复测试：① 点击录入有反应（toast 不闪退）② 未录定位红色居中加大 ③ 点此录入按钮金色缩短
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

const PORT = 18638;
const server = http.createServer((req, res) => {
  if (req.url === '/index.html' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync('index.html'));
  } else { res.writeHead(404); res.end(); }
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

    // 1. 打开店面管理面板
    await page.evaluate(() => { switchPage('manage'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => openStorePanel());
    await page.waitForTimeout(400);

    // 2. 未录定位：红色 + 居中 + 字号加大
    report('未录定位红色', await page.evaluate(() => {
      const spans = [...document.querySelectorAll('#storeManagePanel .sc-loc-row span')];
      const s = spans.find(x => x.textContent.includes('未录定位'));
      return s && getComputedStyle(s).color === 'rgb(255, 82, 82)' && getComputedStyle(s).fontSize === '14px';
    }));
    report('未录定位居中', await page.evaluate(() => {
      const spans = [...document.querySelectorAll('#storeManagePanel .sc-loc-row span')];
      const s = spans.find(x => x.textContent.includes('未录定位'));
      return s && getComputedStyle(s).textAlign === 'center';
    }));

    // 3. 点此录入按钮：金色同添加按钮 + 缩短
    report('点此录入金色', await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#storeManagePanel .sc-loc-btn')];
      const b = btns[0];
      return b && getComputedStyle(b).backgroundColor === 'rgb(224, 192, 128)';
    }));
    report('点此录入缩短', await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#storeManagePanel .sc-loc-btn')];
      const b = btns[0];
      if (!b) return false;
      const w = b.getBoundingClientRect().width;
      return w <= 80; // 56px + padding
    }));

    // 4. 点击录入有反应（toast 显示且不立即消失）
    await page.evaluate(() => {
      const b = document.querySelector('#storeManagePanel .sc-loc-btn');
      b.click();
    });
    await page.waitForTimeout(50);
    report('点击后 toast 显示', await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('show') && t.textContent.includes('定位录入');
    }));
    await page.waitForTimeout(200);
    report('toast 未闪退（200ms后仍显示）', await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('show');
    }));

    // 5. 点击别处（非按钮）toast 立即消失（原#72行为保持）
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const t = document.getElementById('toast');
      if (t) t.classList.add('show'); // 手动显示再测点击消失
    });
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(50);
    report('点击别处仍可立即消失', await page.evaluate(() => {
      const t = document.getElementById('toast');
      return !t.classList.contains('show');
    }));

    // 6. 无 JS 错误
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
