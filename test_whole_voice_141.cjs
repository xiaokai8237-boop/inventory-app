// #141 语音录入整箱数测试：确认弹窗双列 + 语音关键词规则 + 保存 qtyWhole
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18680;
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
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  // 准备数据：3 家店
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    switchPage('record');
    selectEmitGoods(4); // 常温筐
  });
  await page.waitForTimeout(400);

  // ===== 1. 拍照识别常温筐 → 弹窗双列渲染（整箱前物流箱后）=====
  await page.evaluate(() => {
    fillEmitConfirm([
      { code: '35-01', name: '温州永嘉上塘下堡店', whole: 3, cols: { '物流箱': 12, '整箱数量': 3 } },
      { code: '35-02', name: '温州永嘉瓯北店', whole: 2, cols: { '物流箱': 8, '整箱数量': 2 } },
      { code: '35-03', name: '温州永嘉桥下店', whole: 5, cols: { '物流箱': 15, '整箱数量': 5 } }
    ]);
  });
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    const first = rows[0];
    const inputs = [...first.querySelectorAll('input')].map(i => ({
      whole: i.hasAttribute('data-emit-confirm-whole-idx'),
      log: i.hasAttribute('data-emit-confirm-idx'),
      v: i.value,
      border: i.style.border,
      color: i.style.color
    }));
    return {
      rowCount: rows.length,
      inputs,
      totalLog: document.getElementById('emitConfirmTotal')?.textContent,
      totalWhole: document.getElementById('emitConfirmTotalWhole')?.textContent,
      totalWholeShown: document.getElementById('emitConfirmTotalWhole')?.style.display !== 'none',
      voiceBtn: !!document.getElementById('emitVoiceBtnInModal'),
      wholeInFront: inputs[0] && inputs[0].whole && !inputs[0].log,
      logBehind: inputs[1] && inputs[1].log && !inputs[1].whole
    };
  });
  T('常温筐每行 2 输入框', r1.rowCount === 3 && r1.inputs.length === 2, JSON.stringify(r1.inputs));
  T('整箱在前（青色）物流箱在后（橙色）', r1.wholeInFront && r1.logBehind && r1.inputs[0].color.includes('124, 232, 224') && r1.inputs[1].color.includes('245, 166, 35'), JSON.stringify(r1.inputs));
  T('整箱值回显 3 / 物流箱 12', r1.inputs[0].v === '3' && r1.inputs[1].v === '12', JSON.stringify(r1.inputs));
  T('双合计显示（3+2+5=10 / 12+8+15=35）', r1.totalWhole === '10' && r1.totalLog === '35' && r1.totalWholeShown, JSON.stringify({ tw: r1.totalWhole, tl: r1.totalLog }));
  T('弹窗有语音录入按钮', r1.voiceBtn, '');

  // ===== 2. 语音「整箱 3 2 5」→ 填整箱列 =====
  await page.evaluate(() => { emitParseVoiceNums('整箱 3 2 5'); });
  await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => {
      const ws = [...r.querySelectorAll('input[data-emit-confirm-whole-idx]')].map(i => i.value);
      const ls = [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value);
      return { w: ws[0] || '', l: ls[0] || '' };
    });
  });
  T('说整箱→整箱列 3,2,5', JSON.stringify(r2.map(x => x.w)) === '["3","2","5"]', JSON.stringify(r2));
  T('物流箱列保留原值 12,8,15', JSON.stringify(r2.map(x => x.l)) === '["12","8","15"]', JSON.stringify(r2));

  // ===== 3. 语音「物流箱 12 8 15」→ 填物流箱列（整箱列保留）=====
  await page.evaluate(() => { emitParseVoiceNums('物流箱 12 8 15'); });
  await page.waitForTimeout(200);
  const r3 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => {
      const ws = [...r.querySelectorAll('input[data-emit-confirm-whole-idx]')].map(i => i.value);
      const ls = [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value);
      return { w: ws[0] || '', l: ls[0] || '' };
    });
  });
  T('说物流箱→物流箱列 12,8,15', JSON.stringify(r3.map(x => x.l)) === '["12","8","15"]', JSON.stringify(r3));
  T('整箱列保留 3,2,5（二次语音不丢）', JSON.stringify(r3.map(x => x.w)) === '["3","2","5"]', JSON.stringify(r3));

  // ===== 4. 一句话「整箱 3 2 5 物流箱 12 8 15」→ 两列都填 =====
  await page.evaluate(() => { emitParseVoiceNums('整箱 3 2 5 物流箱 12 8 15'); });
  await page.waitForTimeout(200);
  const r4 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => {
      const ws = [...r.querySelectorAll('input[data-emit-confirm-whole-idx]')].map(i => i.value);
      const ls = [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value);
      return { w: ws[0] || '', l: ls[0] || '' };
    });
  });
  T('一句话分两段→两列都填', JSON.stringify(r4.map(x => x.w)) === '["3","2","5"]' && JSON.stringify(r4.map(x => x.l)) === '["12","8","15"]', JSON.stringify(r4));

  // ===== 5. 反序「物流箱 12 8 15 整箱 3 2 5」→ 两列都填 =====
  await page.evaluate(() => { emitParseVoiceNums('物流箱 12 8 15 整箱 3 2 5'); });
  await page.waitForTimeout(200);
  const r5 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => {
      const ws = [...r.querySelectorAll('input[data-emit-confirm-whole-idx]')].map(i => i.value);
      const ls = [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value);
      return { w: ws[0] || '', l: ls[0] || '' };
    });
  });
  T('反序也能分两段', JSON.stringify(r5.map(x => x.w)) === '["3","2","5"]' && JSON.stringify(r5.map(x => x.l)) === '["12","8","15"]', JSON.stringify(r5));

  // ===== 6. 无关键词「12 8 15」→ 默认物流箱列 =====
  await page.evaluate(() => { emitParseVoiceNums('12 8 15'); });
  await page.waitForTimeout(200);
  const r6 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => {
      const ws = [...r.querySelectorAll('input[data-emit-confirm-whole-idx]')].map(i => i.value);
      const ls = [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value);
      return { w: ws[0] || '', l: ls[0] || '' };
    });
  });
  T('无关键词→默认物流箱列', JSON.stringify(r6.map(x => x.l)) === '["12","8","15"]', JSON.stringify(r6));
  T('整箱列保留 3,2,5', JSON.stringify(r6.map(x => x.w)) === '["3","2","5"]', JSON.stringify(r6));

  // ===== 7. 常温关键词「常温箱 12 8 15」→ 物流箱列 =====
  await page.evaluate(() => { emitParseVoiceNums('常温箱 12 8 15'); });
  await page.waitForTimeout(200);
  const r7 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value)[0] || '');
  });
  T('常温箱→物流箱列 12,8,15', JSON.stringify(r7) === '["12","8","15"]', JSON.stringify(r7));

  // ===== 8. applyEmitVoice 双列写入 emitStoreList + 保存 qtyWhole =====
  await page.evaluate(() => {
    document.getElementById('emitConfirmDate').value = todayStr();
    applyEmitVoice();
  });
  await page.waitForTimeout(500);
  const r8 = await page.evaluate(() => {
    const wholeInputs = [...document.querySelectorAll('input[data-emit-whole-idx]')].map(i => i.value);
    const logInputs = [...document.querySelectorAll('input[data-emit-idx]')].map(i => i.value);
    const recs = JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000'));
    return { wholeInputs, logInputs, recs: (recs || []).map(r => ({ qtyIn: r.qtyIn, qtyWhole: r.qtyWhole, storeIdx: r.storeIdx })) };
  });
  T('整箱框写入 3,2,5', JSON.stringify(r8.wholeInputs) === '["3","2","5"]', JSON.stringify(r8.wholeInputs));
  T('物流箱框写入 12,8,15', JSON.stringify(r8.logInputs) === '["12","8","15"]', JSON.stringify(r8.logInputs));
  T('保存 3 条记录', r8.recs.length === 3, 'got ' + r8.recs.length);
  T('记录 qtyIn + qtyWhole 双字段', r8.recs.every(r => r.qtyIn > 0 && r.qtyWhole > 0) && r8.recs[0].qtyIn === 12 && r8.recs[0].qtyWhole === 3, JSON.stringify(r8.recs));

  // ===== 9. 其他筐（面包）单列 + 语音按钮存在 =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    selectEmitGoods(1); // 面包筐
    fillEmitConfirm([
      { code: '35-01', name: '温州永嘉上塘下堡店', cols: { '面包筐': 5 } },
      { code: '35-02', name: '温州永嘉瓯北店', cols: { '面包筐': 7 } }
    ]);
  });
  await page.waitForTimeout(300);
  const r9 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    const firstInputs = [...rows[0].querySelectorAll('input')];
    return {
      rowCount: rows.length,
      inputCount: firstInputs.length,
      single: firstInputs.length === 1 && firstInputs[0].hasAttribute('data-emit-confirm-idx'),
      voiceBtn: !!document.getElementById('emitVoiceBtnInModal'),
      totalWholeHidden: document.getElementById('emitConfirmTotalWhole')?.style.display === 'none',
      hasWholeCol: !!document.querySelector('#emitVoiceConfirmList input[data-emit-confirm-whole-idx]')
    };
  });
  T('面包筐单列（无整箱列）', r9.inputCount === 1 && r9.single && !r9.hasWholeCol, JSON.stringify(r9));
  T('整箱合计隐藏', r9.totalWholeHidden, '');
  T('面包筐也有语音录入按钮', r9.voiceBtn, '');
  // 面包筐无关键词语音 → 填物流箱列（data-emit-confirm-idx）
  await page.evaluate(() => { emitParseVoiceNums('5 7'); });
  await page.waitForTimeout(200);
  const r9b = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList div[data-emit-row]')];
    return rows.map(r => [...r.querySelectorAll('input[data-emit-confirm-idx]')].map(i => i.value)[0] || '');
  });
  T('面包筐语音直接填', JSON.stringify(r9b) === '["5","7",""]', JSON.stringify(r9b));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
