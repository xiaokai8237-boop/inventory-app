// emoji 清理后综合冒烟：核心页面 + 面板渲染 + 无 JS 报错
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text().slice(0, 120)); });

  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  // 各页面切换无报错
  const pages = ['record', 'history', 'manage', 'settings', 'invite', 'invite-records', 'vip', 'summary', 'reconcile', 'perm'];
  for (const p of pages) {
    await page.evaluate((pp) => switchPage(pp), p);
    await page.waitForTimeout(300);
    const active = await page.evaluate((pp) => {
      const el = document.getElementById('page-' + pp);
      return el ? el.classList.contains('active') : 'NULL:' + pp;
    }, p);
    check('页面 ' + p + ' 切换', active === true, String(active));
  }

  // 打开关键面板
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(300);
  await page.evaluate(() => openStorePanel());
  await page.waitForTimeout(300);
  check('店面管理面板', await page.evaluate(() => document.getElementById('storeManagePanel').style.display !== 'none'));
  await page.evaluate(() => { const p = document.getElementById('storeManagePanel'); if (p) p.style.display = 'none'; });
  await page.evaluate(() => openBackupPanel());
  await page.waitForTimeout(300);
  check('备份面板', await page.evaluate(() => document.getElementById('backupPanel').style.display !== 'none'));
  await page.evaluate(() => { const p = document.getElementById('backupPanel'); if (p) p.style.display = 'none'; });
  await page.evaluate(() => openGoodsPanel());
  await page.waitForTimeout(300);
  check('框名面板', await page.evaluate(() => document.getElementById('goodsManagePanel').style.display !== 'none'));
  await page.evaluate(() => { const p = document.getElementById('goodsManagePanel'); if (p) p.style.display = 'none'; });

  // 记录页渲染（记录列表）
  await page.evaluate(() => switchPage('history'));
  await page.waitForTimeout(400);
  const histHas = await page.evaluate(() => {
    return !!document.getElementById('historyList');
  });
  check('记录页列表容器', histHas);

  // 管理页渲染（用户卡）
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(400);
  const manageHas = await page.evaluate(() => {
    const card = document.getElementById('manageUserCard');
    return card && card.innerHTML.length > 0;
  });
  check('管理页用户卡渲染', manageHas);

  // 管理页图标全部 SVG（无 emoji）
  const miOk = await page.evaluate(() => {
    const icons = document.querySelectorAll('#page-manage .mi-icon');
    return Array.from(icons).every(i => i.querySelector('svg') || i.textContent.trim() === '');
  });
  check('管理页图标全 SVG', miOk);

  // 首页关键功能
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(400);
  const homeHas = await page.evaluate(() => {
    return document.getElementById('homeWizard').style.display !== 'none';
  });
  check('首页向导显示', homeHas);

  // JS 报错检查（排除已知无害 CORS/file 类）
  const realErrors = errors.filter(e => !e.includes('CORS') && !e.includes('net::') && !e.includes('ERR_') && !e.includes('favicon'));
  check('无 JS 运行错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
