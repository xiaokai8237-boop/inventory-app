// #51 verifyModal 恢复数据弹窗专项测试（线上 v6.0.109）
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
    // 1. 首页加载
    await page.goto(URL, { waitUntil: 'commit' });
    await page.waitForTimeout(4000);
    report('首页加载', await page.locator('#page-record').isVisible().catch(() => false));
    try { await page.locator("#welcomeModal.show button:has-text('开始使用')").first.click({ timeout: 2000 }); await page.waitForTimeout(500); } catch {}

    // 2. 清空登录态
    await page.evaluate(`localStorage.clear(); localStorage.setItem('kuanwei_privacy_consent','1')`);
    await page.reload({ waitUntil: 'commit' });
    await page.waitForTimeout(4000);
    try { await page.locator("#welcomeModal.show button:has-text('开始使用')").first.click({ timeout: 2000 }); await page.waitForTimeout(500); } catch {}

    // 3. JS 点「管理」tab 进入管理页
    const tabClicked = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab');
      for (const t of tabs) {
        if ((t.textContent || '').includes('管理')) { t.click(); return true; }
      }
      return false;
    }).catch(() => false);
    report('进入管理页', tabClicked);
    await page.waitForTimeout(1200);

    // 4. 管理页点「备份与恢复」入口（openBackupPanel 或 JS 调用）
    let bclicked = false;
    for (const sel of ["button:has-text('备份与恢复')", "button:has-text('云端同步')"]) {
      try { const el = page.locator(sel).first; if (await el.isVisible({ timeout: 3000 })) { await el.click(); bclicked = true; break; } } catch {}
    }
    if (!bclicked) {
      bclicked = await page.evaluate(() => {
        if (typeof openBackupPanel === 'function') { openBackupPanel(); return true; }
        return false;
      }).catch(() => false);
    }
    report('打开备份面板', bclicked);
    await page.waitForTimeout(1000);

    // 5. 点恢复数据（openVerifyModal，未登录走 showModal('verifyModal')）
    let rclicked = false;
    try { const el = page.locator("button:has-text('恢复云端数据')").first; if (await el.isVisible({ timeout: 2000 })) { await el.click(); rclicked = true; } } catch {}
    if (!rclicked) {
      rclicked = await page.evaluate(() => {
        if (typeof openVerifyModal === 'function') { openVerifyModal(); return true; }
        return false;
      }).catch(() => false);
    }
    report('点击恢复数据', rclicked);
    await page.waitForTimeout(1000);

    const vm = page.locator('#verifyModal');
    const vmVisible = await vm.isVisible();
    report('verifyModal 显示', vmVisible);

    if (vmVisible) {
      const bg = await page.evaluate("getComputedStyle(document.getElementById('verifyModal')).backgroundColor");
      report('遮罩深空蓝晶', /4,\s*24,\s*32/.test(bg), bg);
      const cbg = await page.evaluate("getComputedStyle(document.querySelector('#verifyModal .vm-content')).backgroundColor");
      report('卡片#0E3340', /14,\s*51,\s*64/.test(cbg), cbg);
      const border = await page.evaluate("getComputedStyle(document.querySelector('#verifyModal .vm-content')).borderColor");
      report('金色描边', /245,\s*220,\s*146/.test(border), border);
      const tc = await page.evaluate("getComputedStyle(document.querySelector('#verifyModal .vm-title')).color");
      report('标题金色', /245,\s*220,\s*146/.test(tc), tc);
      report('标题SVG图标', (await page.locator('#verifyModal .vm-title svg').count()) > 0);
      const eyeHtml = await page.locator('#verifyPwd_eye').innerHTML();
      report('眼睛SVG', eyeHtml.includes('svg') && !eyeHtml.includes('👁'));
      for (const idn of ['verifyPhone', 'verifyPwd', 'verifyLockMsg']) {
        report(`元素#${idn}`, (await page.locator('#' + idn).count()) > 0);
      }
      const btnHtml = await page.locator('#verifyModal .vm-btns').innerText();
      report('按钮无emoji', !btnHtml.includes('📥') && !btnHtml.includes('👁'));
      report('无JS错误', errors.length === 0, errors.slice(0, 3).join('; '));

      // 6. 点取消关闭
      await page.locator('#verifyModal .vm-outline').click({ timeout: 2000 });
      await page.waitForTimeout(600);
      report('取消关闭', !(await vm.isVisible()));

      // 7. 错误密码反馈
      try { const el = page.locator("text=恢复云端数据").first; if (await el.isVisible({ timeout: 2000 })) await el.click(); } catch {}
      await page.waitForTimeout(600);
      if (await vm.isVisible()) {
        await page.fill('#verifyPhone', '13800138000');
        await page.fill('#verifyPwd', 'wrongpass');
        await page.locator('#verifyModal .vm-primary').click({ timeout: 3000 });
        await page.waitForTimeout(1800);
        const lockMsg = await page.locator('#verifyLockMsg').innerText().catch(() => '');
        const toast = await page.locator('#toast').innerText().catch(() => '');
        report('错误密码有反馈', !!lockMsg || toast.includes('验证失败') || toast.includes('次数'), `lock=${lockMsg} toast=${toast}`);
      }
    }
  } catch (e) {
    report('测试异常', false, String(e).slice(0, 100));
  }

  await browser.close();
  const ok = results.filter(r => r.ok).length;
  console.log(`\n=== ${ok}/${results.length} 通过 ===`);
  process.exit(ok === results.length ? 0 : 1);
})();
