// 需求8 功能测试：每页帮助按钮 + 弹窗内容 + 使用说明第6/7步
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
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  // 测试各页面帮助弹窗标题
  const pages = [
    ['record', '首页'],
    ['history', '记录'],
    ['manage', '管理'],
    ['invite', '邀请好友'],
    ['invite-records', '邀请记录'],
    ['vip', '会员中心'],
    ['settings', '使用说明'],
    ['summary', '汇总'],
    ['reconcile', '对账'],
    ['perm', '权限管理']
  ];
  for (const [pg, name] of pages) {
    await page.evaluate((p) => switchPage(p), pg);
    await page.waitForTimeout(350);
    // 找该页帮助按钮并点击
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('.page-help-btn, .header-help');
      if (!btns.length) return false;
      btns[0].click();
      return true;
    });
    await page.waitForTimeout(350);
    const title = await page.evaluate(() => document.getElementById('pageHelpTitle').textContent);
    const shown = await page.evaluate(() => document.getElementById('pageHelpModal').classList.contains('show'));
    check(name + ' 帮助按钮存在', clicked);
    check(name + ' 弹窗打开且标题含' + name, shown && title.indexOf(name) >= 0, 'title=' + title);
    await page.evaluate(() => closePageHelp());
    await page.waitForTimeout(200);
  }

  // 使用说明页第6/7步
  await page.evaluate(() => switchPage('settings'));
  await page.waitForTimeout(400);
  const step67 = await page.evaluate(() => {
    const html = document.getElementById('page-settings').innerHTML;
    return {
      step6: html.indexOf('会员中心（VIP 权益）') >= 0,
      step7: html.indexOf('邀请拉新（推荐给朋友') >= 0,
      step6Content: html.indexOf('测试期') >= 0 && html.indexOf('月卡 12.8') >= 0,
      step7Content: html.indexOf('KW138000') >= 0 && html.indexOf('45 天') >= 0 && html.indexOf('每月最多 20 人') >= 0
    };
  });
  check('使用说明第6步 会员中心', step67.step6);
  check('使用说明第7步 邀请拉新', step67.step7);
  check('第6步内容(测试期/档位)', step67.step6Content);
  check('第7步内容(奖励/防作弊)', step67.step7Content);

  // 首页渲染无异常（关键元素存在）
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(400);
  const homeOK = await page.evaluate(() => {
    return {
      h1: document.querySelector('.header h1').textContent.indexOf('📦') < 0,
      pill: document.getElementById('loginPill').textContent.indexOf('🔑') < 0 && document.getElementById('loginPill').textContent.indexOf('👤') < 0,
      notice: document.getElementById('loginNotice').textContent.indexOf('🔒') < 0,
      offline: document.getElementById('offlineBanner').textContent.indexOf('📡') < 0
    };
  });
  check('首页 h1 无 📦', homeOK.h1);
  check('登录pill 无 emoji', homeOK.pill);
  check('登录横条无 🔒', homeOK.notice);
  check('离线横条无 📡', homeOK.offline);

  // 截图：邀请页帮助弹窗 + 使用说明页
  await page.evaluate(() => switchPage('invite'));
  await page.waitForTimeout(400);
  await page.evaluate(() => openPageHelp());
  await page.waitForTimeout(400);
  await page.screenshot({ path: '_shot_req8_help_invite_modal.png' });
  await page.evaluate(() => closePageHelp());
  await page.evaluate(() => switchPage('settings'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: '_shot_req8_help_settings_new.png', fullPage: true });

  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
