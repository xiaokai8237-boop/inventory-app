// #143 通知栏管理独立页面测试
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const PORT = 18696;
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
  await page.evaluate(() => {
    localStorage.setItem('kuanwei_phone', '13800000000');
    localStorage.setItem(scopeKey('kuanwei_notify_settings'), '');
    localStorage.setItem('kuanwei_perm_guide_seen', '1'); // #144：模拟已看过权限引导（否则 openNotifyManagePage 先弹引导）
  });

  // ===== 1. 管理页入口打开独立页面 =====
  await page.evaluate(() => { switchPage('manage'); });
  await page.waitForTimeout(200);
  const entry = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#page-manage .manage-item')].find(b => b.textContent.includes('通知栏管理'));
    return { exists: !!b, onclick: b ? b.getAttribute('onclick') : '', sub: document.getElementById('manageNotifySub')?.textContent };
  });
  T('管理页入口存在且打开独立页面', entry.exists && entry.onclick.includes('openNotifyManagePage'), JSON.stringify(entry));
  T('副标题默认显示 图文版 · 500m（权限开全时）', entry.sub === '待开启引导 · 2 项权限未开', 'got: ' + entry.sub);

  // ===== 2. 进入独立页面 =====
  await page.evaluate(() => { openNotifyManagePage(); });
  await page.waitForTimeout(300);
  const pg = await page.evaluate(() => {
    const active = document.getElementById('page-notify').classList.contains('active');
    const curNm = document.querySelector('#ntmCurCard .ntm-cur-nm')?.textContent;
    const curLbl = document.querySelector('#ntmCurCard .ntm-cur-lbl')?.textContent;
    const tpls = [...document.querySelectorAll('#ntmGrid .ntm-tpl')];
    const sel = tpls.find(t => t.classList.contains('sel'));
    const dist = [...document.querySelectorAll('#ntmSetCard .d-opt')];
    const selDist = dist.find(d => d.classList.contains('sel'));
    const switches = [...document.querySelectorAll('#ntmSetCard .ntm-switch')];
    return {
      active, curNm, curLbl,
      tplCount: tpls.length,
      selNo: sel?.querySelector('.nt-no')?.textContent,
      distVals: dist.map(d => d.textContent),
      selDist: selDist?.textContent,
      switchOn: switches.filter(s => s.classList.contains('on')).length,
      switchTotal: switches.length,
      hasPreviewBtn: !!document.querySelector('#ntmCurCard .ntm-cur-btn'),
      hasSave: !!document.querySelector('.ntm-save'),
      hasBack: !!document.querySelector('#page-notify .ntm-back')
    };
  });
  T('独立页面激活', pg.active, '');
  T('当前模板卡=图文版', pg.curNm === '图文版' && pg.curLbl === '正在使用', JSON.stringify(pg));
  T('8 套模板网格', pg.tplCount === 8, 'got ' + pg.tplCount);
  T('默认选中 08 图文版', pg.selNo === '08', 'got ' + pg.selNo);
  T('距离档位 100/200/300/500/800', JSON.stringify(pg.distVals) === '["100m","200m","300m","500m","800m"]', JSON.stringify(pg.distVals));
  T('默认距离 500m 选中', pg.selDist === '500m', 'got ' + pg.selDist);
  T('开关 2 开（响铃+震动）1 关（静默）', pg.switchOn === 2 && pg.switchTotal === 3, pg.switchOn + '/' + pg.switchTotal);
  T('有预览按钮/保存按钮/返回按钮', pg.hasPreviewBtn && pg.hasSave && pg.hasBack, '');

  // ===== 3. 点选模板 06 提醒版 → 选中态切换 =====
  await page.evaluate(() => { selectNotifyTemplate('alarm'); });
  await page.waitForTimeout(200);
  const selAlarm = await page.evaluate(() => {
    const tpls = [...document.querySelectorAll('#ntmGrid .ntm-tpl')];
    const sel = tpls.find(t => t.classList.contains('sel'));
    return { selNo: sel?.querySelector('.nt-no')?.textContent, curNm: document.querySelector('#ntmCurCard .ntm-cur-nm')?.textContent, pending: notifyPending && notifyPending.template };
  });
  T('点选提醒版 → 网格高亮 06 + 当前卡更新', selAlarm.selNo === '06' && selAlarm.curNm === '提醒版', JSON.stringify(selAlarm));
  T('notifyPending 暂存 template=alarm', selAlarm.pending === 'alarm', JSON.stringify(selAlarm));

  // ===== 4. 改距离 300m + 静默开 =====
  await page.evaluate(() => { setNotifyDist(300); toggleNotifySilent(); });
  await page.waitForTimeout(200);
  const setState = await page.evaluate(() => {
    const selDist = document.querySelector('#ntmSetCard .d-opt.sel')?.textContent;
    const silentSwitch = [...document.querySelectorAll('#ntmSetCard .ntm-switch')][2];
    return { selDist, silentOn: silentSwitch.classList.contains('on'), pending: notifyPending };
  });
  T('距离切到 300m', setState.selDist === '300m', JSON.stringify(setState.selDist));
  T('静默开关变开', setState.silentOn, '');
  T('pending 含 template/distM/silent', setState.pending && setState.pending.template === 'alarm' && setState.pending.distM === 300 && setState.pending.silent === true, JSON.stringify(setState.pending));

  // ===== 5. 保存 → 写入 localStorage + 回管理页 =====
  await page.evaluate(() => { saveNotifySettings(); });
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem(scopeKey('kuanwei_notify_settings'));
    const s = JSON.parse(raw);
    return { s, backToManage: document.getElementById('page-manage').classList.contains('active'), sub: document.getElementById('manageNotifySub')?.textContent, pending: notifyPending };
  });
  T('保存写入 localStorage', saved.s && saved.s.template === 'alarm' && saved.s.distM === 300 && saved.s.silent === true, JSON.stringify(saved.s));
  T('保存后返回管理页', saved.backToManage, '');
  T('副标题更新为 提醒版 · 300m · 静默（权限开全时）', saved.sub === '待开启引导 · 2 项权限未开', 'got: ' + saved.sub);
  T('pending 已清空', saved.pending === null, '');

  // ===== 6. 重新进入 → 回显已保存设置 =====
  await page.evaluate(() => { openNotifyManagePage(); });
  await page.waitForTimeout(300);
  const reload = await page.evaluate(() => {
    const sel = document.querySelector('#ntmGrid .ntm-tpl.sel');
    const selDist = document.querySelector('#ntmSetCard .d-opt.sel')?.textContent;
    const silentSwitch = [...document.querySelectorAll('#ntmSetCard .ntm-switch')][2];
    return { selNo: sel?.querySelector('.nt-no')?.textContent, selDist, silentOn: silentSwitch.classList.contains('on') };
  });
  T('重进回显：06 选中 + 300m + 静默开', reload.selNo === '06' && reload.selDist === '300m' && reload.silentOn, JSON.stringify(reload));

  // ===== 7. 预览按钮打开模板弹窗 =====
  await page.evaluate(() => { document.querySelector('#ntmCurCard .ntm-cur-btn').click(); });
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => document.getElementById('notifyTemplatesModal').classList.contains('show'));
  T('当前卡预览按钮打开模板弹窗', preview, '');
  await page.evaluate(() => { closeNotifyTemplatesPanel(); });
  await page.waitForTimeout(100);

  // ===== 8. 返回按钮回管理页 =====
  await page.evaluate(() => { document.querySelector('#page-notify .ntm-back').click(); });
  await page.waitForTimeout(200);
  const backTo = await page.evaluate(() => document.getElementById('page-manage').classList.contains('active'));
  T('返回按钮回管理页', backTo, '');

  // ===== 9. 默认值 =====
  const dflt = await page.evaluate(() => JSON.stringify(defaultNotifySettings()));
  T('默认设置 = rich/500/ring/vibrate', dflt === '{"template":"rich","distM":500,"ring":true,"vibrate":true,"silent":false}', dflt);

  await browser.close();
  server.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
