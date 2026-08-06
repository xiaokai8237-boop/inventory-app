// #56 adminAuthModal 专项测试 — 深空蓝晶壳替换后验证
// 关键路径：设置隐私同意 → 清理残留 .show → JS 调用 openAdminAuthModal() → 弹窗结构验证
const { chromium } = require('playwright');
const path = 'file:///C:/Users/82375/Documents/框/inventory-app/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(path, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('PASS: ' + name); } else { fail++; console.log('FAIL: ' + name); } };

  await page.evaluate(() => { localStorage.setItem('kuanwei_privacy_consent', '1'); });
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(el => el.classList.remove('show')); });
  await page.evaluate(() => { openAdminAuthModal(); });
  await page.waitForTimeout(400);

  // 1. 弹窗显示 + 深空蓝晶壳
  ok('弹窗显示', await page.evaluate(() => document.getElementById('adminAuthModal').classList.contains('show')));
  ok('aa-content 壳存在', await page.evaluate(() => !!document.querySelector('#adminAuthModal .aa-content')));
  const shell = await page.evaluate(() => {
    const c = document.querySelector('#adminAuthModal .aa-content');
    const cs = getComputedStyle(c);
    return { bg: cs.backgroundColor, border: cs.borderColor, radius: cs.borderRadius };
  });
  console.log('  壳样式:', JSON.stringify(shell));
  ok('背景 #0E3340', shell.bg === 'rgb(14, 51, 64)');
  ok('金色描边', shell.border.indexOf('rgba(245, 220, 146') !== -1 || shell.border.indexOf('rgba(245,220,146') !== -1);
  ok('圆角 22px', shell.radius === '22px');

  // 2. 标题 + SVG
  ok('标题为「管理员验证」', await page.evaluate(() => document.querySelector('#adminAuthModal .aa-title').textContent.trim().includes('管理员验证')));
  ok('标题含 SVG 锁图标', await page.evaluate(() => !!document.querySelector('#adminAuthModal .aa-title svg')));
  ok('副标题存在', await page.evaluate(() => document.querySelector('#adminAuthModal .aa-sub').textContent.includes('请输入管理员密码')));
  ok('关闭按钮含 SVG', await page.evaluate(() => !!document.querySelector('#adminAuthModal .aa-close svg')));

  // 3. 密码输入行
  ok('adminAuthPwd 存在', await page.evaluate(() => !!document.getElementById('adminAuthPwd')));
  ok('输入行 aa-input-row 存在', await page.evaluate(() => !!document.querySelector('#adminAuthModal .aa-input-row')));
  ok('输入行含锁 SVG 图标', await page.evaluate(() => !!document.querySelector('#adminAuthModal .aa-input-row svg.ai-icon')));
  ok('adminAuthPwd_eye 含 SVG', await page.evaluate(() => !!document.querySelector('#adminAuthPwd_eye svg')));

  // 4. 错误提示初始隐藏 + 可显示
  ok('adminAuthErr 初始隐藏', await page.evaluate(() => document.getElementById('adminAuthErr').style.display === 'none'));
  await page.evaluate(() => { document.getElementById('adminAuthErr').style.display = 'block'; });
  ok('adminAuthErr 可显示', await page.evaluate(() => document.getElementById('adminAuthErr').style.display !== 'none'));
  await page.evaluate(() => { document.getElementById('adminAuthErr').style.display = 'none'; });

  // 5. 按钮
  ok('「取消」按钮', await page.evaluate(() => [...document.querySelectorAll('#adminAuthModal .aa-btn')].some(b => b.textContent.trim() === '取消')));
  ok('「验证」按钮', await page.evaluate(() => [...document.querySelectorAll('#adminAuthModal .aa-btn')].some(b => b.textContent.trim() === '验证')));
  ok('验证按钮 aa-primary 金色渐变', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#adminAuthModal .aa-btn')].find(x => x.textContent.trim() === '验证');
    return getComputedStyle(b).backgroundImage.includes('linear-gradient');
  }));

  // 6. 眼睛切换密码可见
  await page.evaluate(() => {
    document.getElementById('adminAuthPwd').value = '12345678';
    togglePwd('adminAuthPwd');
  });
  ok('眼睛切换后 type=text', await page.evaluate(() => document.getElementById('adminAuthPwd').type === 'text'));

  // 7. emoji 扫描（弹窗内）
  const emojiInModal = await page.evaluate(() => {
    const txt = document.getElementById('adminAuthModal').innerText;
    return [...txt].filter(ch => {
      const cp = ch.codePointAt(0);
      return (cp >= 0x1F300 && cp <= 0x1F9FF) || (cp >= 0x2600 && cp <= 0x27BF);
    });
  });
  ok('弹窗内无 emoji', emojiInModal.length === 0);

  // 8. 关闭
  await page.evaluate(() => { closeAdminAuthModal(); });
  await page.waitForTimeout(200);
  ok('关闭后 .show 移除', await page.evaluate(() => !document.getElementById('adminAuthModal').classList.contains('show')));

  // 9. 无页面错误（过滤 file:// 环境噪音）
  const realErrors = errors.filter(e =>
    !e.includes('Fetch API cannot load file://') &&
    !e.includes('Failed to get ServiceWorkerRegistration') &&
    !e.includes('InvalidStateError')
  );
  ok('无页面 JS 错误', realErrors.length === 0);
  if (realErrors.length) console.log('REAL ERRORS:', realErrors.slice(0, 5));

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
