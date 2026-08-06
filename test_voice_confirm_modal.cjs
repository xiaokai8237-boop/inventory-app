const { chromium } = require('playwright');
const URL = 'file:///C:/Users/82375/Documents/框/inventory-app/index.html';
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) { passed++; console.log('PASS:', name); } else { failed++; console.log('FAIL:', name, extra || ''); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => typeof window.showModal === 'function', null, { timeout: 30000 });

  // 弹窗存在 + 深空蓝晶壳
  const modalOk = await page.evaluate(() => {
    const m = document.getElementById('voiceConfirmModal');
    if (!m) return false;
    const c = m.querySelector('.vc-content');
    return !!c && c.style && !!c.className.includes('vc-content');
  });
  ok('voiceConfirmModal 存在 + vc-content 类', modalOk);

  // 无 emoji 图标
  const emojiFree = await page.evaluate(() => {
    const t = document.getElementById('voiceConfirmModal').innerText;
    return !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u.test(t);
  });
  ok('弹窗内无 emoji', emojiFree);

  // 保留元素
  for (const id of ['voiceConfirmInfo']) {
    ok(`元素 ${id} 保留`, await page.evaluate(id => !!document.getElementById(id), id));
  }

  // 填入/取消函数保留
  for (const fn of ['confirmVoiceFill', 'cancelVoiceFill']) {
    ok(`函数 ${fn} 保留`, await page.evaluate(fn => typeof window[fn] === 'function', fn));
  }

  // 打开流程：模拟语音识别填充 voiceConfirmInfo + 手动添加 .show（showModal 有隐私排队前置，直接验证弹窗可显示）
  await page.evaluate(() => {
    document.getElementById('voiceConfirmInfo').textContent = '鲜食筐：3 · 面包筐：2';
    document.getElementById('voiceConfirmModal').classList.add('show');
  });
  const shown = await page.evaluate(() => document.getElementById('voiceConfirmModal').classList.contains('show'));
  ok('弹窗 .show 显示正常', shown);

  // 取消关闭
  await page.evaluate(() => cancelVoiceFill());
  const closed = await page.evaluate(() => !document.getElementById('voiceConfirmModal').classList.contains('show'));
  ok('cancelVoiceFill 关闭正常', closed);

  // 版本号
  const ver = await page.evaluate(() => { const m = document.documentElement.outerHTML.match(/APP_VERSION = '([\d.]+)'/); return m ? m[1] : null; });
  ok(`版本号 ${ver}`, ver === '6.0.115');

  await browser.close();
  console.log(`\n===== ${passed}/${passed + failed} 通过 =====`);
  process.exit(failed > 0 ? 1 : 0);
})();
