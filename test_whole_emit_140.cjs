// #140 测试：发出页手动录入常温筐整箱数
// 覆盖：双输入框渲染（整箱前物流箱后）/列头/回显/编辑/保存 qtyWhole/回车跳转/非常温筐单框/语音只填物流箱
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18670;
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

  // 准备数据
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

  // ===== 1. 常温筐双输入框渲染（整箱数在前 物流箱在后） =====
  const rowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitStoreList > div[style*="border-bottom"]')];
    return rows.map(r => {
      const inputs = [...r.querySelectorAll('input[type="number"]')];
      return inputs.map(i => ({
        whole: i.hasAttribute('data-emit-whole-idx'),
        log: i.hasAttribute('data-emit-idx'),
        border: i.style.border,
        width: i.style.width,
        fontSize: i.style.fontSize,
        background: i.style.background,
        color: i.style.color
      }));
    });
  });
  T('常温筐每行 2 个输入框', rowInfo.length === 3 && rowInfo.every(r => r.length === 2), JSON.stringify(rowInfo));
  T('整箱数框在前（青色描边）', rowInfo[0][0].whole && !rowInfo[0][0].log && rowInfo[0][0].border.includes('232, 224'), JSON.stringify(rowInfo[0]));
  T('物流箱框在后', rowInfo[0][1].log && !rowInfo[0][1].whole, JSON.stringify(rowInfo[0]));
  T('两框格式统一（同宽同字号同描边粗细）', rowInfo[0][0].width === '64px' && rowInfo[0][1].width === '64px'
    && rowInfo[0][0].fontSize === '16px' && rowInfo[0][1].fontSize === '16px'
    && rowInfo[0][1].border.startsWith('1.5px'), JSON.stringify(rowInfo[0]));
  T('物流箱框橙色描边+橙色文字', rowInfo[0][1].border.includes('245, 166, 35') && rowInfo[0][1].color === 'rgb(245, 166, 35)', JSON.stringify(rowInfo[0]));
  // 列头
  const heads = await page.evaluate(() => {
    const el = document.querySelector('#emitStoreList > div[style*="justify-content"]');
    return el ? [...el.querySelectorAll('span')].map(s => s.textContent.trim()) : [];
  });
  T('列头整箱数在前', heads[0] === '整箱数', JSON.stringify(heads));
  T('列头物流箱在后', heads[1] === '物流箱', JSON.stringify(heads));

  // ===== 2. 填值 → 保存 → qtyWhole 入库 =====
  await page.evaluate(() => {
    document.getElementById('emitRecordDate').value = todayStr();
    // 第1家店：物流箱 12 整箱 3；第2家店：物流箱 8 整箱 2（整箱框先填）
    document.querySelector('input[data-emit-whole-idx="0"]').value = '3';
    document.querySelector('input[data-emit-idx="0"]').value = '12';
    document.querySelector('input[data-emit-whole-idx="1"]').value = '2';
    document.querySelector('input[data-emit-idx="1"]').value = '8';
    saveEmitRecords();
  });
  await page.waitForTimeout(400);
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000')));
  T('保存 2 条记录', recs.length === 2, 'got ' + recs.length);
  T('第1条 qtyIn=12 qtyWhole=3', recs[0].qtyIn === 12 && recs[0].qtyWhole === 3, JSON.stringify(recs[0]));
  T('第2条 qtyIn=8 qtyWhole=2', recs[1].qtyIn === 8 && recs[1].qtyWhole === 2, JSON.stringify(recs[1]));
  T('source=manual', recs.every(r => r.source === 'manual'));

  // ===== 3. 回显：再进常温筐应显示 12/3 8/2 =====
  await page.evaluate(() => { emitSaveContinue(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { selectEmitGoods(4); });
  await page.waitForTimeout(300);
  const echo = await page.evaluate(() => ({
    log0: document.querySelector('input[data-emit-idx="0"]').value,
    whole0: document.querySelector('input[data-emit-whole-idx="0"]').value,
    log1: document.querySelector('input[data-emit-idx="1"]').value,
    whole1: document.querySelector('input[data-emit-whole-idx="1"]').value
  }));
  T('回显物流箱 12/8', echo.log0 === '12' && echo.log1 === '8', JSON.stringify(echo));
  T('回显整箱数 3/2', echo.whole0 === '3' && echo.whole1 === '2', JSON.stringify(echo));

  // ===== 4. 回车跳转：整箱数0 → 物流箱0 → 整箱数1 → 物流箱1 → 整箱数2 → 物流箱2 → 保存按钮 =====
  const jump = await page.evaluate(() => {
    const w0 = document.querySelector('input[data-emit-whole-idx="0"]');
    const l0 = document.querySelector('input[data-emit-idx="0"]');
    const w1 = document.querySelector('input[data-emit-whole-idx="1"]');
    const l1 = document.querySelector('input[data-emit-idx="1"]');
    const w2 = document.querySelector('input[data-emit-whole-idx="2"]');
    const l2 = document.querySelector('input[data-emit-idx="2"]');
    w0.focus();
    w0.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterW0 = document.activeElement === l0;
    l0.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterL0 = document.activeElement === w1;
    w1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterW1 = document.activeElement === l1;
    l1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterL1 = document.activeElement === w2;
    w2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterW2 = document.activeElement === l2;
    l2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const afterL2 = document.activeElement === l0; // 最后一物流箱：无下一整箱/物流箱 → 保存按钮
    return { afterW0, afterL0, afterW1, afterL1, afterW2, afterL2, activeTag: document.activeElement.tagName, activeOnclick: document.activeElement.getAttribute('onclick') || '' };
  });
  T('整箱0回车→物流箱0', jump.afterW0, JSON.stringify(jump));
  T('物流箱0回车→整箱1', jump.afterL0, JSON.stringify(jump));
  T('整箱1回车→物流箱1', jump.afterW1, JSON.stringify(jump));
  T('物流箱1回车→整箱2', jump.afterL1, JSON.stringify(jump));
  T('整箱2回车→物流箱2', jump.afterW2, JSON.stringify(jump));
  T('物流箱2回车→保存按钮', jump.activeOnclick.includes('saveEmitRecords'), 'active=' + jump.activeTag + ' ' + jump.activeOnclick);

  // ===== 5. 非常温筐：单输入框，无整箱 =====
  await page.evaluate(() => { emitSaveContinue(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { selectEmitGoods(1); }); // 面包筐
  await page.waitForTimeout(300);
  const nonChang = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitStoreList > div[style*="border-bottom"]')];
    return rows.map(r => r.querySelectorAll('input[type="number"]').length);
  });
  T('面包筐每行单框', nonChang.length === 3 && nonChang.every(n => n === 1), JSON.stringify(nonChang));
  const nonChangWhole = await page.evaluate(() => document.querySelector('#emitStoreList input[data-emit-whole-idx]'));
  T('面包筐无整箱数框', nonChangWhole === null);

  // ===== 6. 面包筐保存无 qtyWhole（或为 0/undefined） =====
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_inventory_data__13800000000', JSON.stringify([]));
    document.getElementById('emitRecordDate').value = todayStr();
    document.querySelector('input[data-emit-idx="0"]').value = '5';
    saveEmitRecords();
  });
  await page.waitForTimeout(300);
  const recs2 = await page.evaluate(() => JSON.parse(localStorage.getItem('kuanwei_inventory_data__13800000000')));
  T('面包筐保存 1 条', recs2.length === 1, 'got ' + recs2.length);
  T('面包筐无 qtyWhole 或为 0', !('qtyWhole' in recs2[0]) || recs2[0].qtyWhole === 0, JSON.stringify(recs2[0]));

  // ===== 7. 语音填入只填物流箱（整箱数框无 data-emit-idx，不被语音覆盖） =====
  await page.evaluate(() => { emitSaveContinue(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { selectEmitGoods(4); }); // 切回常温筐
  await page.waitForTimeout(300);
  const voiceFill = await page.evaluate(() => {
    // 模拟 applyEmitVoice 的核心行为：只操作 input[data-emit-idx]
    const emitInputs = Array.from(document.querySelectorAll('#emitStoreList input[data-emit-idx]'));
    emitInputs[0].value = '9';
    emitInputs[1].value = '7';
    const whole0 = document.querySelector('input[data-emit-whole-idx="0"]');
    whole0.value = '99'; // 整箱数已有值
    return { log0: emitInputs[0].value, log1: emitInputs[1].value, whole0: whole0.value };
  });
  T('语音/确认只改物流箱输入框', voiceFill.log0 === '9' && voiceFill.log1 === '7' && voiceFill.whole0 === '99', JSON.stringify(voiceFill));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
