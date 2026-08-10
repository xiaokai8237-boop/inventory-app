// 需求9 功能展示图：演示数据注入 + 6 个功能页面截图
// 页面: 首页/发出面板/记录页/会员中心/邀请好友/极简首页
const { chromium } = require('playwright');

const TODAY = '2026-08-11';
const STORES = [
  { name: '张记便利店', aliases: ['张记'] },
  { name: '华联超市', aliases: ['华联'] },
  { name: '老王烟酒', aliases: ['老王'] },
  { name: '钱塘副食', aliases: ['钱塘'] },
  { name: '好运来', aliases: ['好运来'] },
  { name: '美宜佳', aliases: ['美宜佳'] },
];
const GOODS = [
  { name: '鲜食筐', aliases: ['鲜食', '鲜'] },
  { name: '面包筐', aliases: ['面包', '面'] },
  { name: '冷藏筐', aliases: ['低温', '冷藏'] },
  { name: '冷冻筐', aliases: ['冷冻'] },
  { name: '常温筐', aliases: ['常温', '常'] },
];

// 当日记录：每店每筐 qtyIn（发出数）
const INVENTORY = [];
let id = 1000;
const qtyTable = [
  [12, 8, 6, 4, 15], // 张记
  [20, 15, 10, 8, 22], // 华联
  [8, 5, 4, 3, 10], // 老王
  [15, 10, 7, 5, 18], // 钱塘
  [10, 7, 5, 4, 12], // 好运来
  [18, 12, 9, 6, 20], // 美宜佳
];
STORES.forEach((s, si) => {
  GOODS.forEach((g, gi) => {
    const q = qtyTable[si][gi];
    INVENTORY.push({
      id: 'demo-' + (id++),
      date: TODAY,
      storeIdx: si,
      storeName: s.name,
      goodsIdx: gi,
      goodsName: g.name,
      qtyIn: q,
      qtyOut: 0,
      qtyWhole: gi === 4 ? Math.floor(q / 3) : 0,
      qtyHalf: 0,
      source: 'manual'
    });
  });
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 注入演示数据（账号作用域 key：__13800138000）
  await page.evaluate(({ STORES, GOODS, INVENTORY, TODAY }) => {
    const sc = '__13800138000';
    localStorage.setItem('kuanwei_phone', '13800138000');
    localStorage.setItem('kuanwei_logged_in', '1');
    localStorage.setItem('kuanwei_vip_until', '2027-03-01T00:00:00.000Z');
    localStorage.setItem('kuanwei_stores' + sc, JSON.stringify(STORES));
    localStorage.setItem('kuanwei_goods_names' + sc, JSON.stringify(GOODS));
    localStorage.setItem('kuanwei_inventory_data' + sc, JSON.stringify(INVENTORY));
    localStorage.setItem('kuanwei_welcome_seen', '1');
  }, { STORES, GOODS, INVENTORY, TODAY });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  // 关闭欢迎弹窗 + 权限引导弹窗（如果有）
  await page.evaluate(() => {
    document.querySelectorAll('.show').forEach(m => m.classList.remove('show'));
    try { localStorage.setItem('kuanwei_welcome_seen', '1'); } catch(e) {}
    try { localStorage.setItem('kuanwei_perm_guide_seen', '1'); } catch(e) {}
    try { localStorage.setItem('kuanwei_seen_perm_help', '1'); } catch(e) {}
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));

  // 1. 首页
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s1_home.png' });

  // 2. 发出面板
  await page.evaluate(() => { try { openEmitFlow(); } catch (e) {} });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s2_emit.png' });
  await page.evaluate(() => { try { closeEmitPanel(); } catch (e) {} });
  await page.waitForTimeout(300);

  // 3. 记录页
  await page.evaluate(() => switchPage('history'));
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s3_history.png' });

  // 4. 会员中心
  await page.evaluate(() => switchPage('manage'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => { try { openVipCenter(); } catch (e) {} });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s4_vip.png' });
  // 关闭 vip 弹窗（如果是模态）
  await page.evaluate(() => { try { switchPage('manage'); } catch (e) {} });
  await page.waitForTimeout(300);

  // 5. 邀请好友 — 从管理页进入
  await page.evaluate(() => { try { openInvitePage(); } catch (e) {} });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s5_invite.png' });

  // 6. 极简首页
  await page.evaluate(() => { localStorage.setItem('kuanwei_simple_mode', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3200); // 等 initSimpleMode
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s6_simple.png' });

  // 7. 汇总页（关掉极简，回到标准）
  await page.evaluate(() => { localStorage.removeItem('kuanwei_simple_mode'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.evaluate(() => { try { switchPage('summary'); } catch (e) {} });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s7_summary.png' });

  // 8. 对账页
  await page.evaluate(() => { try { switchPage('reconcile'); } catch (e) {} });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.show').forEach(m => m.classList.remove('show')));
  await page.screenshot({ path: '_shot_req9_s8_reconcile.png' });

  await browser.close();
  console.log('6 张页面截图完成');
})();
