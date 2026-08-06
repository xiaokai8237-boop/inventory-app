// #53 changePwdModal 更改密码弹窗专项测试（线上 v6.0.110）
const { chromium } = require('playwright');
const URL = 'https://inventory-app-9ql.pages.dev/';
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(4000);
    try { await page.locator("#welcomeModal.show button:has-text('开始使用')").first.click({ timeout: 2000 }); } catch {}
    await page.evaluate(`localStorage.clear(); localStorage.setItem('kuanwei_privacy_consent','1')`);
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(4000);
    try { await page.locator("#welcomeModal.show button:has-text('开始使用')").first.click({ timeout: 2000 }); } catch {}

    report('首页加载', await page.locator('#page-record').isVisible().catch(() => false));

    // 先关掉所有 .show 弹窗（welcomeModal 等可能残留）
    await page.evaluate(() => {
      document.querySelectorAll('.show').forEach(el => el.classList.remove('show'));
    }).catch(() => {});
    await page.waitForTimeout(300);

    // 点首页左上角登录胶囊打开账号菜单（JS 调用 toggleAccountMenu）
    const menuOpened = await page.evaluate(() => {
      try { toggleAccountMenu({ stopPropagation: () => {} }); return true; } catch(e) { return false; }
    }).catch(() => false);
    report('打开账号菜单', menuOpened);
    await page.waitForTimeout(800);

    // 点「更改密码」：未登录菜单无此项，JS 直接调用 openChangePwdModal()
    const cpClicked = await page.evaluate(() => {
      try { openChangePwdModal(); return true; } catch(e) { return false; }
    }).catch(() => false);
    report('点击更改密码', cpClicked);
    await page.waitForTimeout(1000);

    const cp = page.locator('#changePwdModal');
    const cpVisible = await cp.isVisible();
    report('changePwdModal 显示', cpVisible);

    if (cpVisible) {
      const bg = await page.evaluate("getComputedStyle(document.getElementById('changePwdModal')).backgroundColor");
      report('遮罩深空蓝晶', /4,\s*24,\s*32/.test(bg), bg);
      const cbg = await page.evaluate("getComputedStyle(document.querySelector('#changePwdModal .cp-content')).backgroundColor");
      report('卡片#0E3340', /14,\s*51,\s*64/.test(cbg), cbg);
      const border = await page.evaluate("getComputedStyle(document.querySelector('#changePwdModal .cp-content')).borderColor");
      report('金色描边', /245,\s*220,\s*146/.test(border), border);
      const tc = await page.evaluate("getComputedStyle(document.querySelector('#changePwdModal .cp-title')).color");
      report('标题金色', /245,\s*220,\s*146/.test(tc), tc);
      report('标题SVG图标', (await page.locator('#changePwdModal .cp-title svg').count()) > 0);
      for (const idn of ['cpPhone', 'cpOldPwd', 'cpOldPwd_eye', 'cpNewPwd', 'cpNewPwd_eye', 'cpNewPwd2', 'cpNewPwd2_eye']) {
        report(`元素#${idn}`, (await page.locator('#' + idn).count()) > 0);
      }
      // 眼睛按钮 SVG 非 emoji
      const eye1 = await page.locator('#cpOldPwd_eye').innerHTML();
      const eye2 = await page.locator('#cpNewPwd_eye').innerHTML();
      const eye3 = await page.locator('#cpNewPwd2_eye').innerHTML();
      report('眼睛SVG(3个)', eye1.includes('svg') && eye2.includes('svg') && eye3.includes('svg') && !eye1.includes('👁'));
      const btnHtml = await page.locator('#changePwdModal .cp-btns').innerText();
      report('按钮无emoji', !btnHtml.includes('✅') && !btnHtml.includes('✏️'));
      report('无JS错误', errors.length === 0, errors.slice(0, 3).join('; '));

      // 点取消关闭
      await page.locator('#changePwdModal .cp-outline').click({ timeout: 2000 });
      await page.waitForTimeout(600);
      report('取消关闭', !(await cp.isVisible()));
    }
  } catch (e) {
    report('测试异常', false, String(e).slice(0, 100));
  }

  await browser.close();
  const ok = results.filter(r => r.ok).length;
  console.log(`\n=== ${ok}/${results.length} 通过 ===`);
  process.exit(ok === results.length ? 0 : 1);
})();
