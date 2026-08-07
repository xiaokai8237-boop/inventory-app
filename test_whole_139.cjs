// #139 拍照识别提取整箱数 Playwright 测试
// 覆盖：常温筐双列识别（物流箱+整箱数）/整箱列编辑/双合计/保存 qtyWhole/非常温筐无整箱列/AI 通道整箱数
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18649;
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/css' }); res.end(fs.readFileSync(f)); }
  catch(e) { res.writeHead(404); res.end(); }
});

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

// 常温筐 OCR 数据（表头含「物流箱 整箱数量」双列）
function changWenOcrData() {
  return {
    _highConf: true,
    words_result: [
      { words: '常温配送单' },
      { words: '路线编号 门店名称 物流箱 整箱数量' },
      { words: '35-01 温州永嘉上塘下堡店 12 3' },
      { words: '35-02 温州永嘉瓯北店 8 2' },
      { words: '35-03 温州永嘉桥下店 15 5' },
      { words: '合计 35 10' }
    ]
  };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  page.setDefaultTimeout(15000);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 准备测试数据
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    const goods = [
      { name: '鲜食筐', aliases: ['鲜食'], sort: 0 },
      { name: '面包筐', aliases: ['面包'], sort: 1 },
      { name: '低温筐', aliases: ['冷藏'], sort: 2 },
      { name: '冷冻筐', aliases: ['冷冻'], sort: 3 },
      { name: '常温筐', aliases: ['常温'], sort: 4 }
    ];
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(goods));
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
  });

  // ===== 1. 常温筐：双列识别 =====
  await page.evaluate((d) => {
    currentActionType = 'in';
    parseOcrResult(d);
  }, changWenOcrData());
  await page.waitForTimeout(300);

  const res1 = await page.evaluate(() => {
    const r = ocrCurrentResult;
    return {
      isChangWen: r.isChangWen,
      goodsIdx: r.goodsIdx,
      wholeColIdx: r.wholeColIdx,
      rows: r.rows.map(x => ({ code: x.code, name: x.name, nums: x.nums, whole: x.whole }))
    };
  });
  T('常温筐识别 goodsIdx=4', res1.goodsIdx === 4, JSON.stringify(res1.goodsIdx));
  T('isChangWen=true', res1.isChangWen === true, '');
  T('整箱列索引=1（物流箱0/整箱数1）', res1.wholeColIdx === 1, 'got ' + res1.wholeColIdx);
  T('行1整箱数=3', res1.rows[0].whole === 3, JSON.stringify(res1.rows[0]));
  T('行2整箱数=2', res1.rows[1].whole === 2, '');
  T('行3整箱数=5', res1.rows[2].whole === 5, '');
  T('行1物流箱=12', res1.rows[0].nums[0] === 12, '');

  // ===== 2. 表格渲染：整箱数列 + 双合计 =====
  await page.evaluate(() => { refreshOcrQtyCol(); });
  await page.waitForTimeout(200);
  const tableInfo = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#ocrEditFields thead th')].map(t => t.textContent.trim());
    const wholeInps = [...document.querySelectorAll('#ocrEditFields input[id^="ocrWhole_"]')].map(i => i.value);
    const total0 = document.getElementById('ocrTotalCell_0')?.textContent;
    const total1 = document.getElementById('ocrTotalCell_1')?.textContent;
    return { heads, wholeInps, total0, total1 };
  });
  T('表头含整箱数列', tableInfo.heads.includes('整箱数'), JSON.stringify(tableInfo.heads));
  T('表头含物流箱列', tableInfo.heads.includes('物流箱'), '');
  T('整箱数输入框值 3/2/5', JSON.stringify(tableInfo.wholeInps) === JSON.stringify(['3','2','5']), JSON.stringify(tableInfo.wholeInps));
  T('物流箱合计=35', tableInfo.total0 === '35', 'got ' + tableInfo.total0);
  T('整箱数合计=10', tableInfo.total1 === '10', 'got ' + tableInfo.total1);

  // ===== 3. 整箱数编辑 → 合计联动 =====
  await page.evaluate(() => {
    const inp = document.getElementById('ocrWhole_0');
    inp.value = '7';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const total1b = await page.evaluate(() => document.getElementById('ocrTotalCell_1').textContent);
  T('编辑整箱数后合计更新', total1b === '14', 'got ' + total1b);

  // ===== 4. 保存：写入记录 qtyWhole =====
  await page.evaluate(() => {
    // 恢复 3（还原，避免测试间污染）
    const inp = document.getElementById('ocrWhole_0');
    inp.value = '3';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('recordDate').value = todayStr();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { confirmOcrResult(); });
  await page.waitForTimeout(300);
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000')));
  T('保存了 3 条记录', recs.length === 3, 'got ' + recs.length);
  T('第1条 qtyWhole=3', recs[0].qtyWhole === 3, JSON.stringify(recs[0]));
  T('第1条 qtyIn=12', recs[0].qtyIn === 12, '');
  T('第2条 qtyWhole=2', recs[1].qtyWhole === 2, '');
  T('第3条 qtyWhole=5', recs[2].qtyWhole === 5, '');
  T('第1条 qtyWhole=3', recs[0].qtyWhole === 3, JSON.stringify(recs[0]));
  T('第1条 qtyIn=12', recs[0].qtyIn === 12, '');
  T('第2条 qtyWhole=2', recs[1].qtyWhole === 2, '');
  T('第3条 qtyWhole=5', recs[2].qtyWhole === 5, '');

  // ===== 5. 非常温筐：无整箱列 =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    const frozenOcr = {
      _highConf: true,
      words_result: [
        { words: '冷冻配送单' },
        { words: '路线编号 门店名称 物流箱' },
        { words: '35-01 温州永嘉上塘下堡店 12' },
        { words: '35-02 温州永嘉瓯北店 8' },
        { words: '合计 20' }
      ]
    };
    parseOcrResult(frozenOcr);
  });
  await page.waitForTimeout(300);
  const res2 = await page.evaluate(() => ({
    isChangWen: ocrCurrentResult.isChangWen,
    goodsIdx: ocrCurrentResult.goodsIdx,
    rows: ocrCurrentResult.rows.map(x => ({ whole: x.whole }))
  }));
  T('冷冻筐 isChangWen=false', res2.isChangWen === false, '');
  T('冷冻筐 goodsIdx=3', res2.goodsIdx === 3, 'got ' + res2.goodsIdx);
  T('冷冻筐行无整箱数', res2.rows.every(r => r.whole === undefined || r.whole === 0), JSON.stringify(res2.rows));

  await page.evaluate(() => { refreshOcrQtyCol(); });
  await page.waitForTimeout(200);
  const frozenHeads = await page.evaluate(() => [...document.querySelectorAll('#ocrEditFields thead th')].map(t => t.textContent.trim()));
  T('冷冻筐表头无整箱数列', !frozenHeads.includes('整箱数'), JSON.stringify(frozenHeads));
  const frozenWholeInp = await page.evaluate(() => document.getElementById('ocrWhole_0'));
  T('冷冻筐无整箱输入框', !frozenWholeInp, '');

  // ===== 6. 冷冻筐保存无 qtyWhole =====
  await page.evaluate(() => {
    document.getElementById('recordDate').value = todayStr();
    confirmOcrResult();
  });
  await page.waitForTimeout(300);
  const frozenRecs = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000')));
  T('冷冻筐保存 2 条', frozenRecs.length === 2, 'got ' + frozenRecs.length);
  T('冷冻筐记录无 qtyWhole', frozenRecs.every(r => r.qtyWhole === undefined), JSON.stringify(frozenRecs));

  // ===== 7. addOcrRow 补 whole=0 =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    parseOcrResult({
      _highConf: true,
      words_result: [
        { words: '常温配送单' },
        { words: '路线编号 门店名称 物流箱 整箱数量' },
        { words: '35-01 温州永嘉上塘下堡店 12 3' },
        { words: '35-02 温州永嘉瓯北店 8 2' },
        { words: '35-03 温州永嘉桥下店 15 5' },
        { words: '合计 35 10' }
      ]
    });
    addOcrRow();
  });
  await page.waitForTimeout(200);
  const addedRow = await page.evaluate(() => ocrCurrentResult.rows[ocrCurrentResult.rows.length - 1]);
  T('新增行 whole=0', addedRow.whole === 0, JSON.stringify(addedRow));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
