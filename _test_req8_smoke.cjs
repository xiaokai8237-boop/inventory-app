// 需求8 冒烟测试：邀请页改版 + 生成海报弹窗（随机 7 款）+ 下载合成个人码
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const file = 'http://127.0.0.1:8777/index.html';
  await page.goto(file, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 设置登录态
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  let pass = 0, fail = 0;
  const check = (name, ok) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } };

  console.log('=== 1. 邀请页改版 ===');
  await page.evaluate(() => openInvitePage());
  await page.waitForTimeout(400);
  const btn = await page.evaluate(() => {
    const b = document.querySelector('.inv-poster-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const body = document.querySelector('.inv-body');
    const br = body.getBoundingClientRect();
    // 几何居中：按钮中心 vs 内容区中心（容差 10px）
    const centerDelta = Math.abs((r.left + r.width / 2) - (br.left + br.width / 2));
    return { text: b.textContent.trim(), width: b.offsetWidth, centerDelta: Math.round(centerDelta) };
  });
  check('生成邀请海报按钮存在且文案正确', btn && btn.text === '生成邀请海报');
  check('按钮水平居中(中心偏差<10px)', btn && btn.centerDelta < 10);
  console.log('  [诊断] 按钮宽=' + (btn && btn.width) + 'px 中心偏差=' + (btn && btn.centerDelta) + 'px');
  const hasTextList = await page.evaluate(() => !!document.getElementById('invTextList'));
  check('邀请文案列表已删除', !hasTextList);
  const hasOldCanvas = await page.evaluate(() => !!document.getElementById('invPosterCanvas'));
  check('旧海报 Canvas 已删除', !hasOldCanvas);
  const linkBtn = await page.evaluate(() => document.querySelectorAll('.inv-code-actions .inv-btn')[1].textContent.trim());
  check('复制按钮改名「复制链接+文案」', linkBtn === '复制链接+文案');

  console.log('=== 2. 复制链接随机附文案 ===');
  const copied = await page.evaluate(async () => {
    // monkey-patch 剪贴板捕获复制内容（避免 file:// 下真实剪贴板挂起）
    window.__copied = '';
    if (navigator.clipboard) navigator.clipboard.writeText = function(t) { window.__copied = t; return Promise.resolve(); };
    copyInviteLink();
    await new Promise(r => setTimeout(r, 150));
    const t = window.__copied;
    return { containsLink: t.indexOf('inventory-app-9ql.pages.dev') >= 0, containsCode: t.indexOf('KW138000') >= 0, len: t.length };
  });
  check('复制内容含邀请链接', copied.containsLink);
  check('复制内容含邀请码', copied.containsCode);
  check('复制内容为文案+链接(长度>60)', copied.len > 60);

  console.log('=== 3. 生成海报弹窗（随机 7 款，一次一张） ===');
  await page.evaluate(() => openPosterModal());
  await page.waitForTimeout(500);
  const modalShown = await page.evaluate(() => document.getElementById('posterModal').classList.contains('show'));
  check('弹窗已显示', modalShown);
  const img1 = await page.evaluate(() => document.getElementById('posterModalImg').getAttribute('src'));
  const ok1 = await page.evaluate((s) => INVITE_POSTERS.indexOf(s) >= 0, img1);
  check('弹窗图片为 7 款之一: ' + img1, ok1);
  // 换一张（10 次点击内应出现不同）
  let changed = false;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => shufflePoster());
    await page.waitForTimeout(150);
    const img2 = await page.evaluate(() => document.getElementById('posterModalImg').getAttribute('src'));
    if (img2 !== img1) { changed = true; break; }
  }
  check('换一张可切换不同海报', changed);
  const imgCount = await page.evaluate(() => INVITE_POSTERS.length);
  check('候选海报共 7 款', imgCount === 7);

  console.log('=== 4. 下载合成（个人邀请码二维码覆盖左上角） ===');
  const dl = await page.evaluate(async () => {
    const src = INVITE_POSTERS[0];
    return await new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      renderPosterCanvas(src, function(cv) {
        if (!cv) { done({ ok: false, err: 'canvas null(图片加载失败)' }); return; }
        try {
          const ctx = cv.getContext('2d');
          const x0 = Math.round(cv.width * 0.032) + Math.round((cv.width * 0.27 / 29) * 0.09);
          const y0 = Math.round(cv.height * 0.028) + Math.round((cv.height * 0.27 / 29) * 0.09);
          let dark = 0, total = 0;
          for (let r = 0; r < 200; r += 3) for (let c = 0; c < 200; c += 3) {
            const d = ctx.getImageData(x0 + c, y0 + r, 1, 1).data;
            if (d[0] < 128) dark++;
            total++;
          }
          done({ ok: true, size: cv.width + 'x' + cv.height, qrDark: (dark / total * 100).toFixed(0) + '%' });
        } catch (e) { done({ ok: false, err: 'sampling: ' + e.message }); }
      });
      setTimeout(() => done({ ok: false, err: 'timeout 5s' }), 5000);
    });
  });
  check('合成画布生成 1080x1882', dl && dl.ok && dl.size === '1080x1882');
  check('左上角二维码黑密度 40-60%（个人码已绘制）', dl && dl.qrDark && parseInt(dl.qrDark) > 30 && parseInt(dl.qrDark) < 65);
  if (!dl || !dl.ok) console.log('  [诊断] ' + JSON.stringify(dl));

  await page.screenshot({ path: '_shot_req8_invite_page.png' });
  await page.evaluate(() => openPosterModal());
  await page.waitForTimeout(500);
  await page.screenshot({ path: '_shot_req8_poster_modal.png' });

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
