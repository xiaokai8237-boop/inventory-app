// #222 术语统一测试：低温筐→冷藏筐（默认=冷藏，用户改过=以用户为准，别名保留识别）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18780;
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(f)); }
  catch(e) { res.writeHead(404); res.end(); }
});

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_perm_guide_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
  });
  await page.waitForTimeout(300);

  // ===== 1. 默认配置：name=冷藏筐 + 别名保留低温 =====
  console.log('=== 1. 默认配置 ===');
  const r1 = await page.evaluate(() => {
    const cfg = loadGoodsConfig();
    return {
      name: cfg[2].name,
      aliases: cfg[2].aliases
    };
  });
  T('默认筐名=冷藏筐', r1.name === '冷藏筐', r1.name);
  T('别名含「低温」', r1.aliases.includes('低温'), JSON.stringify(r1.aliases));
  T('别名含「低温筐」', r1.aliases.includes('低温筐'), JSON.stringify(r1.aliases));
  T('别名含「冷藏」', r1.aliases.includes('冷藏'), JSON.stringify(r1.aliases));

  // ===== 2. 显示名 =====
  console.log('=== 2. 显示名 ===');
  const r2 = await page.evaluate(() => loadGoodsNames()[2]);
  T('loadGoodsNames[2]=冷藏筐', r2 === '冷藏筐', r2);

  // ===== 3. 图标：冷藏筐命中冰蓝 =====
  console.log('=== 3. 图标映射 ===');
  const r3 = await page.evaluate(() => ({
    low: goodsIcon('冷藏筐'),
    lowAlias: goodsIcon('低温筐'),
    fresh: goodsIcon('鲜食筐'),
    lowIsLow: goodsIcon('冷藏筐') === GOODS_SVG.low,
    freshIsFresh: goodsIcon('鲜食筐') === GOODS_SVG.fresh,
    lowSvg: GOODS_SVG.low
  }));
  T('goodsIcon(冷藏筐)=冰蓝', r3.lowIsLow, '');
  T('goodsIcon(低温筐)兼容=冰蓝', r3.lowAlias === r3.lowSvg, '');
  T('goodsIcon(鲜食筐)=青绿', r3.freshIsFresh, '');

  // ===== 4. 文本匹配：低温/冷藏 都命中 idx2 =====
  console.log('=== 4. 识别匹配 ===');
  const r4 = await page.evaluate(() => ({
    low: matchGoodsFromText('低温 8'),
    lowKuang: matchGoodsFromText('低温筐 8'),
    cold: matchGoodsFromText('冷藏 8'),
    coldKuang: matchGoodsFromText('冷藏筐 8')
  }));
  T('「低温 8」→ idx2', r4.low[2] === 8, JSON.stringify(r4.low));
  T('「低温筐 8」→ idx2', r4.lowKuang[2] === 8, JSON.stringify(r4.lowKuang));
  T('「冷藏 8」→ idx2', r4.cold[2] === 8, JSON.stringify(r4.cold));
  T('「冷藏筐 8」→ idx2', r4.coldKuang[2] === 8, JSON.stringify(r4.coldKuang));

  // ===== 5. 页面级：录入页显示冷藏筐、无低温筐 =====
  console.log('=== 5. 页面显示 ===');
  await page.evaluate(() => switchPage('record'));
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => {
    const bodyText = document.querySelector('#page-record').textContent;
    return {
      hasCold: bodyText.includes('冷藏筐'),
      noLow: !bodyText.includes('低温筐'),
      giRows: [...document.querySelectorAll('#goodsInputList .gi-name')].map(n => n.textContent.trim())
    };
  });
  T('录入页显示「冷藏筐」', r5.hasCold, '');
  T('录入页无「低温筐」残留', r5.noLow, '');
  T('筐名行包含冷藏筐', r5.giRows.includes('冷藏筐'), JSON.stringify(r5.giRows));

  // ===== 6. 用户自定义：以用户为准 =====
  console.log('=== 6. 用户自定义优先 ===');
  const r6 = await page.evaluate(() => {
    const cfg = loadGoodsConfig();
    cfg[2].name = '低温';
    saveGoodsConfig(cfg);
    const names = loadGoodsNames();
    const back = names[2];
    // 还原默认
    localStorage.removeItem(scopeKey(GOODS_KEY));
    return back;
  });
  T('用户自定义「低温」→ 显示用户的值', r6 === '低温', r6);

  T('全程 JS 零错误', errs.length === 0, errs.join(';'));
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})();
