// #229 需求9 验证：header 只在首页显示 + 随滚动消失
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(m => m.classList.remove('show')); });

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  // 1. 首页 header 显示
  const vis = () => page.evaluate(() => {
    const h = document.querySelector('.header');
    return { display: getComputedStyle(h).display, rect: h.getBoundingClientRect() };
  });
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(400);
  let s = await vis();
  check('首页(record) header 显示', s.display !== 'none' && s.rect.height > 0);

  // 2. 滚动 600px 后 header 随滚动消失（top 为负/滚出视口）
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);
  s = await vis();
  check('滚动600px后 header 滚出视口(顶部)', s.rect.top <= 0 && s.rect.bottom < 844, 'top=' + s.rect.top.toFixed(0) + ' bottom=' + s.rect.bottom.toFixed(0));
  const scrolled = await page.evaluate(() => window.scrollY);
  check('页面确实滚动了(header已滚出视口)', scrolled > 50, 'scrollY=' + scrolled);

  // 3. 切记录页 → header 隐藏
  await page.evaluate(() => switchPage('history'));
  await page.waitForTimeout(300);
  s = await vis();
  check('记录页(history) header 隐藏', s.display === 'none');

  // 4. 切管理页 → header 隐藏
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(300);
  s = await vis();
  check('管理页(manage) header 隐藏', s.display === 'none');

  // 5. 切回首页 → header 恢复显示
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(300);
  s = await vis();
  check('切回首页 header 恢复显示', s.display !== 'none' && s.rect.height > 0);

  // 6. 邀请页 → header 隐藏
  await page.evaluate(() => switchPage('invite'));
  await page.waitForTimeout(300);
  s = await vis();
  check('邀请页(invite) header 隐藏', s.display === 'none');

  // 7. 截图：首页顶部
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: '_shot_req9_home_top.png' });
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '_shot_req9_home_scrolled.png' });

  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
