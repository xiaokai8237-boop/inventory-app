// 需求8b：未登录点击生成海报 → 弹登录引导；已登录 → 正常弹海报
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => openInvitePage());
  await page.waitForTimeout(300);

  let pass = 0, fail = 0;
  const check = (n, ok) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n); } };

  console.log('=== 1. 未登录点击生成海报 ===');
  await page.evaluate(() => openPosterModal());
  await page.waitForTimeout(300);
  const loginShown = await page.evaluate(() => document.getElementById('posterLoginModal').classList.contains('show'));
  check('弹「请先登录」引导弹窗', loginShown);
  const posterShown = await page.evaluate(() => document.getElementById('posterModal').classList.contains('show'));
  check('未登录不弹海报弹窗', !posterShown);
  await page.evaluate(() => { closePosterLoginModal(); authGoTo('login'); });
  await page.waitForTimeout(300);
  const loginModalOpen = await page.evaluate(() => {
    const lp = document.getElementById('page-login');
    return lp && lp.classList.contains('active');
  });
  check('「去登录」切到登录页', loginModalOpen);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  console.log('=== 2. 已登录点击生成海报 ===');
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => openInvitePage());
  await page.waitForTimeout(400);
  await page.evaluate(() => openPosterModal());
  await page.waitForTimeout(500);
  const posterShown2 = await page.evaluate(() => document.getElementById('posterModal').classList.contains('show'));
  check('已登录弹海报弹窗', posterShown2);
  const imgLoaded = await page.waitForFunction(() => {
    const img = document.getElementById('posterModalImg');
    return img && img.style.display === 'block' && img.complete && img.naturalWidth > 0;
  }, { timeout: 4000 }).then(() => true).catch(() => false);
  check('海报图片已加载显示', imgLoaded);

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
