// 需求6 拉新功能专项测试
// 验证: ①管理页入口接通 ②邀请码生成(KW+手机号后6位) ③邀请链接 ④文案5种渲染+替换code ⑤海报Canvas生成 ⑥复制 ⑦未登录提示 ⑧启动invite参数记录
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => { if (!/ServiceWorker|sw\.js|not defined at file/i.test(e.message)) errors.push(e.message); });
  // 模拟带 invite 参数打开
  await page.goto('file://' + path.resolve('index.html') + '?invite=KW123456', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  let allPass = true;
  function check(name, cond, extra) {
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (extra ? ' → ' + extra : ''));
    if (!cond) allPass = false;
  }

  // ⑧ 启动 invite 参数记录
  const inv8 = await page.evaluate(() => {
    const raw = localStorage.getItem('kuanwei_invited_by');
    return { saved: !!raw, code: raw ? JSON.parse(raw).code : '' };
  });
  check('启动检测 invite 参数并记录', inv8.saved === true && inv8.code === 'KW123456', JSON.stringify(inv8));

  // ① 管理页入口
  const v1 = await page.evaluate(() => {
    switchPage('manage');
    const btn = document.querySelector('[onclick*="openInvitePage"]');
    return { exists: !!btn, noEmoji: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(btn ? btn.outerHTML : ''), txt: btn ? btn.innerText : '' };
  });
  check('管理页邀请好友入口接通', v1.exists === true, v1.txt.replace(/\s+/g,' '));
  check('入口 SVG 图标无 emoji', v1.noEmoji === true);

  // 登录态下进入拉新页
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_phone', '13800138000');
    openInvitePage();
  });
  await page.waitForTimeout(400);

  // ② 邀请码
  const v2 = await page.evaluate(() => {
    const code = getInviteCode();
    const link = getInviteLink();
    return {
      code,
      codeOk: code === 'KW138000',
      linkOk: link === 'https://inventory-app-9ql.pages.dev/?invite=KW138000',
      displayOk: document.getElementById('invCodeVal').textContent === 'KW138000'
    };
  });
  check('邀请码 KW+手机号后6位', v2.codeOk && v2.displayOk === true, v2.code);
  check('邀请链接格式', v2.linkOk === true, v2.link);

  // ③ 文案 5 种渲染 + 替换 code
  const v3 = await page.evaluate(() => {
    const list = document.getElementById('invTextList');
    const items = list ? list.querySelectorAll('.inv-text-item') : [];
    const bodies = Array.from(items).map(i => i.querySelector('.it-body').innerText);
    return {
      count: items.length,
      allReplaced: bodies.every(b => b.includes('KW138000') && !b.includes('{code}')),
      styles: Array.from(items).map(i => i.querySelector('.it-name').innerText)
    };
  });
  check('邀请文案 5 种风格', v3.count === 5, v3.styles.join('/'));
  check('文案已替换邀请码', v3.allReplaced === true);

  // ④ 海报 Canvas 生成
  const v4 = await page.evaluate(() => {
    const canvas = document.getElementById('invPosterCanvas');
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, 750, 1200).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 30 || d[i+1] > 30 || d[i+2] > 30) { nonBg++; }
    }
    return { hasCanvas: !!canvas, painted: nonBg > 10000, size: canvas.width + 'x' + canvas.height };
  });
  check('海报 Canvas 已绘制(750x1200 有内容)', v4.hasCanvas === true && v4.painted === true, v4.size);

  // ⑤ 复制（clipboard mock 不可用则走 fallback，不报错即可）
  const v5 = await page.evaluate(() => {
    try { copyInviteCode(); return { ran: true }; } catch(e) { return { ran: false, err: e.message }; }
  });
  check('copyInviteCode 无报错', v5.ran === true, v5.err || '');

  // ⑥ 未登录提示
  const v6 = await page.evaluate(() => {
    localStorage.removeItem('kuanwei_logged_in');
    localStorage.removeItem('kuanwei_phone');
    openInvitePage();
    const tip = document.getElementById('invLoginTip');
    const codeEl = document.getElementById('invCodeVal');
    return { tipVisible: tip.style.display === 'flex', codeTxt: codeEl.textContent };
  });
  check('未登录显示登录引导', v6.tipVisible === true && v6.codeTxt === '请先登录', `tip=${v6.tipVisible} code=${v6.codeTxt}`);

  // ⑦ shareInvite 无 share API → 复制兜底不报错
  const v7 = await page.evaluate(() => {
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_phone', '13800138000');
    try { shareInvite(); return { ran: true }; } catch(e) { return { ran: false, err: e.message }; }
  });
  check('shareInvite 复制兜底无报错', v7.ran === true, v7.err || '');

  console.log('JS 错误总数(非SW):', errors.length, errors.length ? errors.join(';') : '');
  await browser.close();
  console.log(allPass && errors.length === 0 ? '\n=== 全部通过 ===' : '\n=== 有失败项 ===');
  process.exit(allPass && errors.length === 0 ? 0 : 1);
})();
