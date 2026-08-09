const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // 1) 管理页：通知栏管理入口应消失
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(300);
  const hasNotifyEntry = await page.evaluate(() => !!document.querySelector('[onclick*="openNotifyManagePage"]'));
  const permEntry = await page.evaluate(() => !!document.querySelector('[onclick*="openPermPage"]'));
  // 2) 打开权限管理页 → 提醒设置应渲染 4 项
  await page.evaluate(() => openPermPage());
  await page.waitForTimeout(500);
  const remind = await page.evaluate(() => {
    const card = document.getElementById('ntmSetCard');
    if (!card) return { ok: false, html: 'ntmSetCard 不存在' };
    const t = card.innerText || '';
    return { ok: t.includes('到店提醒距离') && t.includes('响铃提醒') && t.includes('震动提醒') && t.includes('静默时段'), html: t.replace(/\s+/g, ' ') };
  });
  // 3) 点击响铃开关（toggleNotifyRing）无报错
  await page.evaluate(() => toggleNotifyRing());
  await page.waitForTimeout(300);
  console.log('通知栏管理入口消失:', hasNotifyEntry ? 'FAIL 还在' : 'OK 已删');
  console.log('权限管理入口存在:', permEntry ? 'OK' : 'FAIL');
  console.log('提醒设置 4 项渲染:', remind.ok ? 'OK' : 'FAIL', '→', remind.html);
  console.log('toggle 操作无报错:', errors.length === 0 ? 'OK' : 'FAIL: ' + errors.join('; '));
  console.log('JS 错误总数:', errors.length);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
