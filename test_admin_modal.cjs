// #57 adminModal 专项测试 — 深空蓝晶壳替换后验证
// 关键路径：设置隐私同意 → 清理残留 .show → JS 调用 openAdminModal() → 弹窗结构 + 动态渲染验证
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
  await page.evaluate(() => { openAdminModal(); });
  await page.waitForTimeout(400);

  // 1. 弹窗显示 + 深空蓝晶壳
  ok('弹窗显示', await page.evaluate(() => document.getElementById('adminModal').classList.contains('show')));
  ok('am-content 壳存在', await page.evaluate(() => !!document.querySelector('#adminModal .am-content')));
  const shell = await page.evaluate(() => {
    const c = document.querySelector('#adminModal .am-content');
    const cs = getComputedStyle(c);
    return { bg: cs.backgroundColor, border: cs.borderColor, radius: cs.borderRadius };
  });
  console.log('  壳样式:', JSON.stringify(shell));
  ok('背景 #0E3340', shell.bg === 'rgb(14, 51, 64)');
  ok('金色描边', shell.border.indexOf('rgba(245, 220, 146') !== -1 || shell.border.indexOf('rgba(245,220,146') !== -1);
  ok('圆角 22px', shell.radius === '22px');

  // 2. 标题 + SVG
  ok('标题为「管理员面板」', await page.evaluate(() => document.querySelector('#adminModal .am-title').textContent.trim().includes('管理员面板')));
  ok('标题含 SVG 扳手图标', await page.evaluate(() => !!document.querySelector('#adminModal .am-title svg')));
  ok('关闭按钮含 SVG', await page.evaluate(() => !!document.querySelector('#adminModal .am-close svg')));

  // 3. 统计卡
  ok('统计卡 am-stats 存在', await page.evaluate(() => !!document.querySelector('#adminModal .am-stats')));
  ok('统计卡标签含 SVG', await page.evaluate(() => !!document.querySelector('#adminModal .am-stats-label svg')));
  ok('adminUserCount 存在', await page.evaluate(() => !!document.getElementById('adminUserCount')));
  ok('刷新统计按钮含 SVG', await page.evaluate(() => [...document.querySelectorAll('#adminModal .am-stats-btn svg')].length > 0));

  // 4. 重置区
  ok('adminPhone 存在', await page.evaluate(() => !!document.getElementById('adminPhone')));
  ok('重置按钮含 SVG', await page.evaluate(() => [...document.querySelectorAll('#adminModal .am-danger-btn svg')].length > 0));
  ok('说明文字 12345678', await page.evaluate(() => document.querySelector('#adminModal .am-note').textContent.includes('12345678')));

  // 5. 用户列表区
  ok('用户列表标题含 SVG', await page.evaluate(() => !!document.querySelector('#adminModal .am-section-title svg')));
  ok('adminSearch 存在', await page.evaluate(() => !!document.getElementById('adminSearch')));
  ok('adminUserList 存在', await page.evaluate(() => !!document.getElementById('adminUserList')));

  // 6. 待恢复区
  ok('待恢复标题含 SVG', await page.evaluate(() => {
    const t = [...document.querySelectorAll('#adminModal .am-section-title')].find(x => x.textContent.includes('已注销'));
    return !!t && !!t.querySelector('svg');
  }));
  ok('adminPendingList 存在', await page.evaluate(() => !!document.getElementById('adminPendingList')));

  // 7. 动态渲染：模拟数据验证 renderAdminUsers / renderAdminPending 无 emoji + SVG 化
  await page.evaluate(() => {
    adminUsers = [{ phone: '13800008000', password: '12345678' }, { phone: '13900009000', password: '87654321' }];
    adminPending = [{ code: 'TMP-A1B2C3', originalPhone: '13800008000', deletedAt: '2026-08-01T00:00:00' }];
    renderAdminUsers();
    renderAdminPending();
  });
  await page.waitForTimeout(200);
  ok('用户列表渲染 2 条', await page.evaluate(() => document.querySelectorAll('#adminUserList .am-user-item').length === 2));
  ok('用户列表含手机 SVG', await page.evaluate(() => document.querySelectorAll('#adminUserList .am-user-phone svg').length === 2));
  ok('用户列表密码含锁 SVG', await page.evaluate(() => document.querySelectorAll('#adminUserList .am-user-pwd svg').length === 2));
  ok('待恢复列表渲染 1 条', await page.evaluate(() => document.querySelectorAll('#adminPendingList .am-pending-item').length === 1));
  ok('待恢复列表恢复按钮含 SVG', await page.evaluate(() => [...document.querySelectorAll('#adminPendingList .am-pending-btns .am-green-btn svg')].length === 1));
  ok('待恢复列表删除按钮含 SVG', await page.evaluate(() => [...document.querySelectorAll('#adminPendingList .am-pending-btns .am-danger-btn svg')].length === 1));

  // 8. emoji 扫描（弹窗 + 动态渲染内容）
  const emojiInModal = await page.evaluate(() => {
    const txt = document.getElementById('adminModal').innerText;
    return [...txt].filter(ch => {
      const cp = ch.codePointAt(0);
      return (cp >= 0x1F300 && cp <= 0x1F9FF) || (cp >= 0x2600 && cp <= 0x27BF);
    });
  });
  ok('弹窗内无 emoji', emojiInModal.length === 0);

  // 9. 搜索过滤仍工作
  await page.evaluate(() => {
    document.getElementById('adminSearch').value = '139';
    renderAdminUsers();
  });
  ok('搜索过滤生效', await page.evaluate(() => document.querySelectorAll('#adminUserList .am-user-item').length === 1));

  // 10. 关闭
  await page.evaluate(() => { closeAdminModal(); });
  await page.waitForTimeout(200);
  ok('关闭后 .show 移除', await page.evaluate(() => !document.getElementById('adminModal').classList.contains('show')));

  // 11. 无页面错误（过滤 file:// 环境噪音）
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
