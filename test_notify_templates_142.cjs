// #142 通知栏 8 套样式模板测试
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18690;
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

  // ===== 1. 8 套模板定义完整 =====
  const tpls = await page.evaluate(() => {
    return NOTIFY_TEMPLATES.map(t => ({ id: t.id, name: t.name, isDefault: !!t.isDefault, desc: !!t.desc, tag: !!t.tag }));
  });
  T('共 8 套模板', tpls.length === 8, 'got ' + tpls.length);
  T('模板 ID 唯一', new Set(tpls.map(t => t.id)).size === 8, '');
  T('模板 8 = 图文版默认', tpls[7].id === 'rich' && tpls[7].name === '图文版' && tpls[7].isDefault, JSON.stringify(tpls[7]));
  T('默认模板 = rich', await page.evaluate(() => NOTIFY_TPL_DEFAULT === 'rich' && getNotifyTemplate(null).id === 'rich'), '');
  T('getNotifyTemplate 兜底', await page.evaluate(() => getNotifyTemplate('nope').id === 'rich'), '');

  // ===== 2. buildNotifyContent 内容构建 =====
  const bc = await page.evaluate(() => {
    const data = {
      storeName: '35-01 温州永嘉上塘下堡店', distM: 500,
      goods: [
        { name: '鲜食筐', qty: 8 },
        { name: '常温筐', qty: 12, whole: 3 }
      ]
    };
    return {
      rich: buildNotifyContent('rich', data),
      alarm: buildNotifyContent('alarm', data),
      silent: buildNotifyContent('silent', data)
    };
  });
  T('标题含店名', bc.rich.title.includes('35-01'), bc.rich.title);
  T('正文含距离', bc.rich.body.includes('500'), bc.rich.body);
  T('正文含整箱', bc.rich.body.includes('3 整箱'), bc.rich.body);
  T('正文含物流箱', bc.rich.body.includes('12 物流箱'), bc.rich.body);
  T('按钮两个', bc.rich.buttons.length === 2 && bc.rich.buttons[0].label === '记录回筐' && bc.rich.buttons[1].label === '导航去下一家', JSON.stringify(bc.rich.buttons));
  T('提醒版 alarm=true', bc.alarm.alarm === true, '');
  T('静默版 silent=true', bc.silent.silent === true, '');
  T('图文版不响铃', bc.rich.alarm === false && bc.rich.silent === false, '');

  // ===== 3. renderNotifyPreview 8 套渲染 =====
  const previews = await page.evaluate(() => {
    const data = {
      storeName: '35-01 温州永嘉上塘下堡店', distM: 500, curIdx: 0, totalStores: 6,
      goods: [
        { name: '鲜食筐', qty: 8 }, { name: '面包筐', qty: 8 }, { name: '低温筐', qty: 5 },
        { name: '冷冻筐', qty: 10 }, { name: '常温筐', qty: 12, whole: 3 }
      ],
      route: [
        { name: '35-01 温州永嘉上塘下堡店', dist: '500m', qty: 12, whole: 3 },
        { name: '35-02 温州永嘉瓯北店', dist: '1.2km', qty: 8, whole: 2 },
        { name: '35-03 温州永嘉桥下店', dist: '2.8km', qty: 15, whole: 5 }
      ]
    };
    return NOTIFY_TEMPLATES.map(t => {
      const html = renderNotifyPreview(t.id, data);
      const div = document.createElement('div');
      div.innerHTML = html;
      const text = div.textContent.replace(/\s+/g, ' ');
      return { id: t.id, html, text };
    });
  });
  T('8 套都能渲染', previews.length === 8 && previews.every(p => p.html.startsWith('<div class="ntpv')), '');
  T('每套含店名', previews.every(p => p.text.includes('35-01')), '');
  T('每套含距离', previews.every(p => p.text.includes('500') || p.text.includes('1.2km') || p.text.includes('2.8km')), '');
  T('每套含筐数（清单版route格式、其他含鲜食常温）', previews.every(p => p.id === 'list' ? p.text.includes('物流') && p.text.includes('整箱') : (p.text.includes('鲜食') && p.text.includes('常温'))), '');
  T('每套含整箱（详细版物流/整、其余整箱字样）', previews.every(p => p.id === 'detail' ? p.text.includes('物流/整') : p.text.includes('整箱')), '');
  T('每套含打卡', previews.every(p => p.text.includes('打卡')), '');
  T('每套含双按钮', previews.every(p => p.text.includes('记录回筐') && p.text.includes('导航去下一家')), '');
  T('每套含 SVG 图标(无emoji)', previews.every(p => p.html.includes('<svg')), '');
  T('样式类正确', previews.every((p, i) => p.html.includes('t-' + ['minimal','classic','dist','detail','list','alarm','silent','rich'][i])), '');

  // ===== 4. 模板面板打开 + 渲染 8 卡 =====
  await page.evaluate(() => { openNotifyTemplatesPanel(); });
  await page.waitForTimeout(200);
  const panel = await page.evaluate(() => {
    const m = document.getElementById('notifyTemplatesModal');
    const cards = document.querySelectorAll('#notifyTplGrid .ntp-card');
    return {
      shown: m.classList.contains('show'),
      cardCount: cards.length,
      hasDefault: [...document.querySelectorAll('#notifyTplGrid .ntp-badge')].length === 1,
      cardsHavePreview: [...cards].every(c => c.querySelector('.ntpv'))
    };
  });
  T('弹窗打开', panel.shown, '');
  T('8 张模板卡', panel.cardCount === 8, 'got ' + panel.cardCount);
  T('1 个默认徽标', panel.hasDefault, '');
  T('每卡含预览', panel.cardsHavePreview, '');
  await page.evaluate(() => { closeNotifyTemplatesPanel(); });
  await page.waitForTimeout(100);
  T('弹窗关闭', await page.evaluate(() => !document.getElementById('notifyTemplatesModal').classList.contains('show')), '');

  // ===== 5. 管理页入口 =====
  await page.evaluate(() => { switchPage('manage'); });
  await page.waitForTimeout(200);
  const entry = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#page-manage .manage-item')];
    return btns.some(b => (b.getAttribute('onclick') || '').includes('openNotifyManagePage'));
  });
  T('管理页入口改为打开通知栏管理独立页面', entry, '');

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
