// #236 键盘弹出隐藏底部 Tab 测试
// 模拟：聚焦输入框 + 压缩视口（innerHeight 变矮）→ body.keyboard-open + .tabs/.simple-tabs 隐藏；恢复视口 → 恢复
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

  // 工具：聚焦临时输入框（测聚焦判定，不影响真实页面）
  const focusTemp = () => page.evaluate(() => {
    let el = document.getElementById('__kbTestInput');
    if (!el) { el = document.createElement('input'); el.id = '__kbTestInput'; el.style.cssText = 'position:fixed;top:-999px;left:0;'; document.body.appendChild(el); }
    el.focus();
    return document.activeElement === el;
  });

  console.log('=== 1. 标准模式：键盘弹出隐藏 .tabs ===');
  // 初始：无聚焦、全视口 → 无 keyboard-open
  let s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), tabs: getComputedStyle(document.querySelector('.tabs')).display }));
  check('初始无 keyboard-open', s.kb === false);
  check('初始 .tabs 显示', s.tabs !== 'none', s.tabs);

  // 聚焦输入框（不缩小视口）→ 不应触发隐藏（视口没变）
  await focusTemp();
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), tabs: getComputedStyle(document.querySelector('.tabs')).display }));
  check('聚焦但不弹键盘 → 不隐藏', s.kb === false && s.tabs !== 'none', JSON.stringify(s));

  // 聚焦 + 压缩视口（模拟键盘弹出压缩布局视口）
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), tabs: getComputedStyle(document.querySelector('.tabs')).display }));
  check('键盘弹出(视口压缩) → keyboard-open', s.kb === true, JSON.stringify(s));
  check('键盘弹出 → .tabs 隐藏', s.tabs === 'none', s.tabs);

  // 恢复视口（键盘收起）→ 恢复显示
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), tabs: getComputedStyle(document.querySelector('.tabs')).display }));
  check('键盘收起 → keyboard-open 移除', s.kb === false, JSON.stringify(s));
  check('键盘收起 → .tabs 恢复', s.tabs !== 'none', s.tabs);

  console.log('=== 2. 极简模式：键盘弹出隐藏 .simple-tabs ===');
  await page.evaluate(() => { localStorage.setItem('kuanwei_simple_mode', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), stabs: getComputedStyle(document.querySelector('.simple-tabs')).display }));
  check('极简初始无 keyboard-open', s.kb === false);
  check('极简初始 .simple-tabs 显示', s.stabs !== 'none', s.stabs);

  await focusTemp();
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), stabs: getComputedStyle(document.querySelector('.simple-tabs')).display }));
  check('极简键盘弹出 → keyboard-open', s.kb === true, JSON.stringify(s));
  check('极简键盘弹出 → .simple-tabs 隐藏', s.stabs === 'none', s.stabs);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({ kb: document.body.classList.contains('keyboard-open'), stabs: getComputedStyle(document.querySelector('.simple-tabs')).display }));
  check('极简键盘收起 → 恢复', s.kb === false && s.stabs !== 'none', JSON.stringify(s));

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
