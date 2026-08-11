// #238 框名设置页重新设计 冒烟测试
// 覆盖：5筐卡片+徽章配色+SVG图标 / 名称别名保留 / 别名跟随配色 / 新增框弹窗(替换prompt) / 拖拽排序(名称别名不变)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  let pass = 0, fail = 0;
  const check = (n, ok, extra) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' -> ' + extra : '')); } };

  console.log('=== 1. 打开框名设置面板 ===');
  await page.evaluate(() => { switchPage('manage'); openGoodsPanel(); });
  await page.waitForTimeout(500);
  const panelShown = await page.evaluate(() => document.getElementById('goodsManagePanel').style.display === 'block');
  check('面板打开', panelShown);

  console.log('=== 2. 5 筐卡片 + 徽章配色 + SVG 图标 ===');
  const cards = await page.evaluate(() => {
    const cs = document.querySelectorAll('.goods-card');
    const badges = document.querySelectorAll('.goods-badge');
    return {
      count: cs.length,
      badges: [...badges].map(b => b.className).join(','),
      svgCount: [...badges].reduce((n, b) => n + b.querySelectorAll('svg').length, 0),
      dragHandles: document.querySelectorAll('.goods-drag').length
    };
  });
  check('5 筐卡片渲染', cards.count === 5, 'count=' + cards.count);
  check('徽章 5 个且配色 class g-b0..g-b4', cards.badges.indexOf('g-b0') >= 0 && cards.badges.indexOf('g-b4') >= 0, cards.badges);
  check('每个徽章含 SVG 图标', cards.svgCount === 5, 'svg=' + cards.svgCount);
  check('拖拽手柄 5 个', cards.dragHandles === 5, 'handles=' + cards.dragHandles);

  console.log('=== 3. 名称和别名保留（不动） ===');
  const names = await page.evaluate(() => loadGoodsConfig().map(g => g.name).join('|'));
  check('默认 5 筐名称未变', names === '鲜食筐|面包筐|冷藏筐|冷冻筐|常温筐', names);
  const aliasChips = await page.evaluate(() => document.querySelectorAll('.goods-alias-chip').length);
  check('别名 chips 渲染（跟随配色 class）', aliasChips >= 5, 'chips=' + aliasChips);
  const aliasFirstBg = await page.evaluate(() => {
    const c = document.querySelector('.goods-alias-chip');
    return c ? getComputedStyle(c).backgroundColor : '';
  });
  check('别名 chip 颜色跟随筐配色(绿系非旧版统一蓝)', aliasFirstBg.indexOf('74, 222, 128') >= 0 || aliasFirstBg.indexOf('74,222,128') >= 0, aliasFirstBg);

  console.log('=== 4. 新增框类型弹窗（替换 prompt） ===');
  await page.evaluate(() => showAddGoodsModal());
  await page.waitForTimeout(300);
  const modalShown = await page.evaluate(() => document.getElementById('goodsAddModal').classList.contains('show'));
  check('金色弹窗打开(非 prompt)', modalShown);
  // 取消
  await page.evaluate(() => cancelAddGoods());
  await page.waitForTimeout(200);
  const modalClosed = await page.evaluate(() => !document.getElementById('goodsAddModal').classList.contains('show'));
  check('取消关闭', modalClosed);
  // 新增成功
  await page.evaluate(() => {
    showAddGoodsModal();
    document.getElementById('goodsAddName').value = '甜品筐';
    confirmAddGoods();
  });
  await page.waitForTimeout(400);
  const afterAdd = await page.evaluate(() => {
    const cfg = loadGoodsConfig();
    const bs = document.querySelectorAll('.goods-badge');
    return { count: cfg.length, last: cfg[cfg.length - 1], cards: document.querySelectorAll('.goods-card').length, badge5: bs[5] ? bs[5].className : '' };
  });
  check('新增后 6 筐', afterAdd.count === 6 && afterAdd.cards === 6, JSON.stringify(afterAdd));
  check('新筐名称=甜品筐 别名空', afterAdd.last.name === '甜品筐' && afterAdd.last.aliases.length === 0, JSON.stringify(afterAdd.last));
  check('新筐徽章=自定义青 g-bx', afterAdd.badge5.indexOf('g-bx') >= 0, afterAdd.badge5);

  console.log('=== 5. 拖拽排序（名称/别名值不变） ===');
  await page.evaluate(() => reorderGoods(0, 2)); // 鲜食筐 移到 冷藏筐 后
  await page.waitForTimeout(300);
  const afterReorder = await page.evaluate(() => {
    const cfg = loadGoodsConfig();
    return { names: cfg.map(g => g.name).join('|'), aliases0: cfg[0].aliases.join(','), cards: document.querySelectorAll('.goods-card').length };
  });
  check('顺序变化(鲜食筐移后)', afterReorder.names.indexOf('面包筐') === 0, afterReorder.names);
  check('6 筐仍渲染', afterReorder.cards === 6, 'cards=' + afterReorder.cards);
  // 顺序变但名称/别名值都在
  check('所有筐名称值完整保留', afterReorder.names.split('|').sort().join(',') === ['鲜食筐','面包筐','冷藏筐','冷冻筐','常温筐','甜品筐'].sort().join(','), afterReorder.names);
  check('移动后首筐别名保留', afterReorder.aliases0.length > 0, afterReorder.aliases0);

  console.log('=== 6. JS 无报错 ===');
  check('无 pageerror', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
