// #235 系统返回键逐级返回测试
// 场景：标准模式全页面返回目标 / 极简模式 / 弹窗关闭 / 面板关闭 / mode-select / auth 页 / 首页不退出
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
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  // 工具：切页 + 清弹窗 + 调 __handleNativeBack，返回 {handled, activePage, shows}
  // 弹窗优先逻辑在第 3 节单独验证；本工具测「无弹窗时页面逐级返回」
  async function backFrom(pg) {
    await page.evaluate((p) => switchPage(p), pg);
    await page.waitForTimeout(200);
    return await page.evaluate(() => {
      document.querySelectorAll('.show').forEach(m => m.classList.remove('show'));
      const shows = document.querySelectorAll('.show');
      const handled = __handleNativeBack();
      const act = document.querySelector('.page.active');
      return { handled, active: act ? act.id : 'none', showCount: shows.length };
    });
  }

  console.log('=== 1. 标准模式 逐级返回 ===');
  const cases = [
    ['record', false, 'page-record'],         // 首页 → 不退出
    ['history', true, 'page-record'],     // 记录tab → 首页
    ['manage', true, 'page-record'],      // 管理tab → 首页
    ['settings', true, 'page-manage'],    // 使用说明 → 管理页
    ['invite', true, 'page-manage'],      // 邀请好友 → 管理页
    ['invite-records', true, 'page-invite'], // 邀请记录 → 邀请页
    ['vip', true, 'page-manage'],         // 会员中心 → 管理页
    ['summary', true, 'page-manage'],     // 汇总 → 管理页
    ['reconcile', true, 'page-manage'],   // 对账 → 管理页
    ['perm', true, 'page-manage'],        // 权限 → 管理页
    ['login', true, 'page-record'],       // 登录页 → 首页
    ['setup', true, 'page-record'],       // 注册页 → 首页
    ['forgot', true, 'page-record'],      // 忘记密码 → 首页
  ];
  for (const [pg, handled, expectActive] of cases) {
    const r = await backFrom(pg);
    check(pg + ' handled=' + handled + ' → ' + expectActive, r.handled === handled && r.active === expectActive, JSON.stringify(r));
  }

  console.log('=== 2. mode-select 回来源页 ===');
  // 从管理页进模式选择 → 返回管理页
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(200);
  await page.evaluate(() => openModeSelect());
  await page.waitForTimeout(200);
  let r = await page.evaluate(() => { const h = __handleNativeBack(); const a = document.querySelector('.page.active'); return { handled: h, active: a.id }; });
  check('mode-select(从manage进) → manage', r.handled === true && r.active === 'page-manage', JSON.stringify(r));
  // 从设置页进模式选择 → 返回设置页（真实链路：mode-select 会弹权限引导弹窗，先关弹窗再退页）
  await page.evaluate(() => { switchPage('settings'); document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => openModeSelect());
  await page.waitForTimeout(200);
  // 第 1 次返回：弹窗优先 → 关权限引导弹窗（页面不动）
  r = await page.evaluate(() => {
    const h = __handleNativeBack();
    const a = document.querySelector('.page.active');
    const shows = [...document.querySelectorAll('.show')].map(m => m.id).join(',');
    return { handled: h, active: a.id, shows };
  });
  check('mode-select 第1次返回 关权限弹窗', r.handled === true && r.shows === '', JSON.stringify(r));
  // 第 2 次返回：页面层级 → 回设置页
  r = await page.evaluate(() => { const h = __handleNativeBack(); const a = document.querySelector('.page.active'); return { handled: h, active: a.id, mR: modeSelectReturn }; });
  check('mode-select(从settings进) 第2次返回 → settings', r.handled === true && r.active === 'page-settings', JSON.stringify(r));

  console.log('=== 3. 弹窗关闭（页面不变） ===');
  // 打开一个弹窗（帮助弹窗）→ 按返回 → 关弹窗 + 页面不变
  await page.evaluate(() => switchPage('invite'));
  await page.waitForTimeout(200);
  await page.evaluate(() => openPageHelp());
  await page.waitForTimeout(200);
  const modalShown = await page.evaluate(() => document.getElementById('pageHelpModal').classList.contains('show'));
  check('帮助弹窗已打开', modalShown);
  r = await page.evaluate(() => { const h = __handleNativeBack(); return { handled: h, modal: document.getElementById('pageHelpModal').classList.contains('show'), active: document.querySelector('.page.active').id }; });
  check('返回键关闭弹窗 handled=true', r.handled === true, JSON.stringify(r));
  check('弹窗已关闭', r.modal === false);
  check('页面仍停在邀请页', r.active === 'page-invite');

  console.log('=== 4. 面板关闭（店面管理面板） ===');
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { openStorePanel(); } catch (e) {} });
  await page.waitForTimeout(200);
  const panelShown = await page.evaluate(() => document.getElementById('storeManagePanel').style.display === 'block');
  check('店面面板已打开', panelShown);
  r = await page.evaluate(() => { const h = __handleNativeBack(); return { handled: h, panel: document.getElementById('storeManagePanel').style.display }; });
  check('返回键关闭面板 handled=true', r.handled === true, JSON.stringify(r));
  check('面板已关闭', r.panel === 'none' || r.panel === '');

  console.log('=== 5. 极简模式 ===');
  await page.evaluate(() => { localStorage.setItem('kuanwei_simple_mode', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200); // 等 initSimpleMode
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  const simCases = [
    ['simple-home', false, 'page-simple-home'],   // 极简首页 → 不退出
    ['simple-records', true, 'page-simple-home'], // 极简记录 → 极简首页
    ['simple-settings', true, 'page-simple-home'],// 极简设置 → 极简首页
  ];
  for (const [pg, handled, expectActive] of simCases) {
    const rr = await backFrom(pg);
    check('极简 ' + pg + ' handled=' + handled + ' → ' + expectActive, rr.handled === handled && rr.active === expectActive, JSON.stringify(rr));
  }
  // 极简下 mode-select → 回极简设置页
  await page.evaluate(() => openModeSelect());
  await page.waitForTimeout(200);
  r = await page.evaluate(() => { const h = __handleNativeBack(); const a = document.querySelector('.page.active'); return { handled: h, active: a.id }; });
  check('极简 mode-select → simple-settings', r.handled === true && r.active === 'page-simple-settings', JSON.stringify(r));

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
