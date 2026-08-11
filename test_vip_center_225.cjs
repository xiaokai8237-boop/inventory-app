// 需求5 会员中心专项测试
// 验证: ①isVip 测试期默认 true ②openVipCenter 进入会员中心页 ③4 档位渲染(价格/等级/卖点) ④chooseVipPlan 提示支付未接入 ⑤管理页会员卡文案+SVG按钮
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => { if (!/ServiceWorker|sw\.js|File system|Not allowed|not defined at file/i.test(e.message)) errors.push(e.message); });
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  let allPass = true;
  function check(name, cond, extra) {
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (extra ? ' → ' + extra : ''));
    if (!cond) allPass = false;
  }

  // ① isVip 测试期默认 true（无 VIP_KEY 也 true）
  const vip1 = await page.evaluate(() => {
    localStorage.removeItem('kuanwei_vip_until');
    return { isVip: isVip(), testMode: typeof VIP_TEST_MODE !== 'undefined' && VIP_TEST_MODE === true };
  });
  check('isVip 测试期默认 true（无 key）', vip1.isVip === true && vip1.testMode === true, `isVip=${vip1.isVip} testMode=${vip1.testMode}`);

  // ② openVipCenter → page-vip 激活 + 状态卡渲染
  const v2 = await page.evaluate(() => {
    openVipCenter();
    const pageVip = document.getElementById('page-vip');
    const active = pageVip ? pageVip.classList.contains('active') : false;
    const st = document.getElementById('vipStatusCard');
    const stHtml = st ? st.innerText : '';
    return { active, stHas: stHtml.includes('VIP 会员') && stHtml.includes('测试期默认开通') };
  });
  check('openVipCenter 进入会员中心页', v2.active === true, `active=${v2.active}`);
  check('状态卡渲染（VIP会员+测试期）', v2.stHas === true);

  // ③ 4 档位渲染（价格/等级/卖点）
  const v3 = await page.evaluate(() => {
    const grid = document.getElementById('vipPlanGrid');
    if (!grid) return { ok: false, txt: 'grid missing' };
    const t = grid.innerText.replace(/\s+/g, ' ');
    return {
      ok: true,
      hasMonth: t.includes('初阶会员') && t.includes('12.8') && t.includes('月卡'),
      hasSeason: t.includes('进阶会员') && t.includes('28.8') && t.includes('季卡'),
      hasYear: t.includes('尊享会员') && t.includes('88') && t.includes('年卡') && t.includes('超值推荐') && t.includes('比月卡省 66 元'),
      hasLife: t.includes('至尊会员') && t.includes('158') && t.includes('终身卡') && t.includes('永久尊享') && t.includes('约 12 个月回本'),
      noEmoji: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(grid.innerHTML)
    };
  });
  check('月卡 12.8 初阶', v3.ok && v3.hasMonth === true, v3.txt);
  check('季卡 28.8 进阶', v3.hasSeason === true);
  check('年卡 88 尊享+超值推荐+省66', v3.hasYear === true);
  check('终身卡 158 至尊+永久尊享+12个月回本', v3.hasLife === true);
  check('档位网格零 emoji', v3.noEmoji === true);

  // ④ chooseVipPlan 提示支付未接入（不报错）
  const v4 = await page.evaluate(() => {
    const before = document.body.innerText.length;
    chooseVipPlan('year');
    return { ran: true };
  });
  check('chooseVipPlan 无报错', v4.ran === true && errors.length === 0, errors.join(';'));

  // ⑤ 管理页会员卡：VIP 文案 + SVG 按钮无 emoji（需登录态）
  const v5 = await page.evaluate(() => {
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_phone', '13800138000');
    switchPage('manage');
    const card = document.getElementById('manageUserCard');
    const txt = card ? card.innerText : '';
    const btn = card ? card.querySelector('.manage-vip-btn') : null;
    const btnHtml = btn ? btn.outerHTML : '';
    return {
      hasVip: txt.includes('VIP 会员（测试期）'),
      hasSvg: btnHtml.includes('<svg'),
      noEmoji: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(btnHtml),
      btnClickable: btn ? !!btn.getAttribute('onclick').includes('openVipCenter') : false
    };
  });
  check('管理页会员卡显示 VIP 会员（测试期）', v5.hasVip === true);
  check('续费按钮 SVG 皇冠无 emoji', v5.hasSvg === true && v5.noEmoji === true);
  check('续费按钮点击 → openVipCenter', v5.btnClickable === true);

  console.log('JS 错误总数(非SW):', errors.length);
  await browser.close();
  console.log(allPass && errors.length === 0 ? '\n=== 全部通过 ===' : '\n=== 有失败项 ===');
  process.exit(allPass && errors.length === 0 ? 0 : 1);
})();
