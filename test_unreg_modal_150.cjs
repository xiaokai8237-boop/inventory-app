// #150 unregStoreModal 深空蓝晶改造测试
// 验证：① 弹窗深空蓝晶壳 + SVG 图标 + 红字警示条 + 零 emoji
//       ② 识别结果里未录门店行标黄 + 「未录入」小标
//       ③ 保存 toast 文案「已录 N 家店入账 · M 家未录入未保存」
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18740;
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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try { closeWelcome(false); } catch(e) {}
    localStorage.setItem('kuanwei_welcome_seen', '1');
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem('kuanwei_logged_in', '1');
    const stores = [
      { name: '35-01 温州永嘉上塘下堡店', aliases: ['35-01'], lat: 28.1530, lng: 120.6500, sort: 0 },
      { name: '35-02 温州永嘉瓯北店', aliases: ['35-02'], lat: 28.1700, lng: 120.6600, sort: 1 },
      { name: '35-03 温州永嘉桥下店', aliases: ['35-03'], lat: 28.1900, lng: 120.6800, sort: 2 }
    ];
    localStorage.setItem('kuanwei_stores__13800000000', JSON.stringify(stores));
    localStorage.setItem('kuanwei_goods_names__13800000000', JSON.stringify(['鲜食筐','面包筐','低温筐','冷冻筐','常温筐']));
    window.Notification = { permission: 'granted' };
  });
  await page.waitForTimeout(300);

  // ===== 1. 弹窗结构：深空蓝晶壳 + SVG + 红字警示 + 零 emoji =====
  const r1 = await page.evaluate(() => {
    const modal = document.getElementById('unregStoreModal');
    const content = modal.querySelector('.store-ocr-content');
    const cs = content ? getComputedStyle(content) : null;
    const hasSvg = !!content.querySelector('svg');
    const warn = [...content.querySelectorAll('div')].find(d => d.textContent.includes('忽略后'));
    return {
      bg: cs ? cs.backgroundColor : '',
      border: cs ? cs.borderColor : '',
      hasSvg,
      warnText: warn ? warn.textContent.replace(/\s+/g, ' ').trim() : '',
      warnColor: warn ? getComputedStyle(warn).color : '',
      btnTexts: [...content.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
      btnSvg: content.querySelector('button:nth-of-type(2) svg') ? true : false,
      emojiInModal: (modal.textContent || '').match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/u) ? true : false
    };
  });
  T('弹窗深空蓝晶底 #0E3340', r1.bg === 'rgb(14, 51, 64)', r1.bg);
  T('弹窗金边', r1.border !== 'rgba(0, 0, 0, 0)' && r1.border !== '', r1.border);
  T('图标为 SVG（非 emoji）', r1.hasSvg, '');
  T('红字警示条存在', (r1.warnText || '').includes('忽略后') && (r1.warnText || '').includes('不会入账'), r1.warnText);
  T('警示条红色 #FF6B6B', r1.warnColor === 'rgb(255, 107, 107)', r1.warnColor);
  T('按钮为 忽略继续 / 去录入', JSON.stringify(r1.btnTexts) === JSON.stringify(['忽略继续','去录入']), JSON.stringify(r1.btnTexts));
  T('去录入按钮带 SVG 铅笔', r1.btnSvg, '');
  T('弹窗区域零 emoji', !r1.emojiInModal, '');

  // ===== 2. 触发弹窗：showUnregisteredStoresConfirm =====
  await page.evaluate(() => { showUnregisteredStoresConfirm(['35-99 温州永嘉新店']); });
  await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => ({
    shown: document.getElementById('unregStoreModal').classList.contains('show'),
    desc: document.getElementById('unregStoreDesc').textContent.replace(/\s+/g, ' ').trim()
  }));
  T('弹窗可正常打开', r2.shown, '');
  T('描述含未录门店名', (r2.desc || '').includes('35-99 温州永嘉新店'), r2.desc);

  // ===== 3. 识别结果：未录门店行标黄 + 未录入小标 =====
  await page.evaluate(() => {
    currentActionType = 'in';
    selectEmitGoods(4);
    fillEmitConfirm([
      { code: '35-01', name: '35-01 温州永嘉上塘下堡店', cols: { '物流箱': 12, '整箱数量': 83 }, whole: 83, nums: [12] },
      { code: '35-99', name: '35-99 温州永嘉新店', cols: { '物流箱': 3, '整箱数量': 10 }, whole: 10, nums: [3] }
    ]);
  });
  await page.waitForTimeout(200);
  // 弹窗出现（含未录店）→ 忽略继续
  await page.evaluate(() => { unregStoreIgnore(); });
  await page.waitForTimeout(200);
  const r3 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#emitVoiceConfirmList [data-emit-row]')];
    return rows.map(row => ({
      bg: row.style.background,
      border: row.style.border,
      text: row.textContent.replace(/\s+/g, ' ').trim()
    }));
  });
  T('渲染 2 行（1 已录 + 1 未录）', r3.length === 2, 'got ' + r3.length);
  T('未录店行标黄背景', (r3[1]?.bg || '').includes('rgba(245, 166, 35, 0.1)'), r3[1]?.bg);
  T('未录店行金色边框', (r3[1]?.border || '').includes('rgba(245, 166, 35, 0.45)'), r3[1]?.border);
  T('未录店行含「未录入」小标', (r3[1]?.text || '').includes('未录入'), r3[1]?.text);
  T('已录店行未标黄', !(r3[0]?.bg || '').includes('245, 166, 35'), r3[0]?.bg);

  // ===== 4. 保存：toast 文案「已录 N 家店入账 · M 家未录入未保存」=====
  await page.evaluate(() => {
    document.getElementById('emitConfirmDate').value = '2026-08-09';
    // 捕获 toast 文案
    window.__lastToast = '';
    const orig = window.showToast;
    window.showToast = function(msg) { window.__lastToast = msg; };
    applyEmitVoice();
    window.showToast = orig;
  });
  await page.waitForTimeout(300);
  const r4 = await page.evaluate(() => ({
    toast: window.__lastToast,
    saved: loadData().filter(r => r.date === '2026-08-09' && r.goodsIdx === 4).length
  }));
  T('保存 1 条（未录 35-99 跳过）', r4.saved === 1, 'got ' + r4.saved);
  T('toast 文案「1 家店入账 · 1 家未录入未保存」', (r4.toast || '').includes('已录入 1 家店入账') && (r4.toast || '').includes('1 家未录入未保存'), r4.toast);

  // ===== 5. 源码级断言 =====
  const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
  T('源码无 ⚠️/📝 emoji 图标（弹窗区域）', !src.slice(src.indexOf('unregStoreModal'), src.indexOf('typeMismatchModal')).match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/u), '');
  T('首页 OCR 表格有未录标黄逻辑', src.includes('isUnreg = matchStoreIdxByNameOrAlias'), '');
  T('confirmOcrResult toast 文案更新', src.includes('家未录入未保存'), '');

  T('全程无 JS 错误', errs.length === 0, errs.join(';'));

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
