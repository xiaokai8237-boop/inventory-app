// 需求239 前端冒烟：管理员列表渲染最近登录时间
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  console.log('=== 1. fmtLoginTime 格式化 ===');
  const f1 = await page.evaluate(() => fmtLoginTime('2026-08-11T03:20:00.000Z'));
  check('ISO→本地绝对时间 YYYY-MM-DD HH:mm', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(f1), f1);
  const f2 = await page.evaluate(() => fmtLoginTime(''));
  check('空值→暂无记录', f2 === '暂无记录', f2);
  const f3 = await page.evaluate(() => fmtLoginTime('invalid'));
  check('非法值→暂无记录', f3 === '暂无记录', f3);

  console.log('=== 2. renderAdminUsers 渲染时间行 ===');
  await page.evaluate(() => {
    adminUsers = [
      { phone: '13800138000', password: 'Abc@123456', lastLoginAt: '2026-08-11T03:20:00.000Z' },
      { phone: '13900139000', password: '', lastLoginAt: '' } // 历史账号
    ];
    // 伪造 adminUserList 容器
    const box = document.createElement('div');
    box.id = 'adminUserList';
    document.body.appendChild(box);
    const search = document.createElement('input');
    search.id = 'adminSearch';
    search.value = '';
    document.body.appendChild(search);
    renderAdminUsers();
  });
  const items = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.am-user-item')];
    return list.map(el => ({ time: el.querySelector('.am-user-time') ? el.querySelector('.am-user-time').textContent : null }));
  });
  check('渲染 2 个用户项', items.length === 2, 'count=' + items.length);
  check('用户1 显示最近登录时间', items[0] && items[0].time && items[0].time.indexOf('最近登录：') >= 0 && items[0].time.indexOf('暂无记录') < 0, JSON.stringify(items[0]));
  check('用户2(历史) 显示暂无记录', items[1] && items[1].time && items[1].time.indexOf('暂无记录') >= 0, JSON.stringify(items[1]));
  const timeText = await page.evaluate(() => document.querySelectorAll('.am-user-item')[0].querySelector('.am-user-time').textContent);
  check('时间文本含日期', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(timeText), timeText);

  console.log('=== 3. 搜索过滤仍工作 ===');
  await page.evaluate(() => { document.getElementById('adminSearch').value = '1380'; renderAdminUsers(); });
  const filtered = await page.evaluate(() => document.querySelectorAll('.am-user-item').length);
  check('搜索 1380 → 1 项', filtered === 1, 'count=' + filtered);

  console.log('=== 4. 零 emoji + 零 pageerror ===');
  const emoji = await page.evaluate(() => {
    const html = document.querySelector('#adminUserList').innerHTML;
    return /[\u{1F300}-\u{1F9FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/u.test(html);
  });
  check('列表无 emoji', !emoji);

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
