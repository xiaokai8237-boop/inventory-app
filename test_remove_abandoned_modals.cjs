// #61 废弃弹窗删除验证测试
// 验证 voiceInputModal / emitStoreOrderModal / photoInputModal 已删除
// 且删除后页面无 JS 报错、真实功能（语音/拍照/回收店序）仍正常
const { chromium } = require('playwright');

const URL = 'file:///C:/Users/82375/Documents/框/inventory-app/index.html';
let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS:', name); }
  else { failed++; console.log('FAIL:', name, extra || ''); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  // 等待脚本完全执行（大文件；function 声明会挂 window，作为执行完成信号）
  await page.waitForFunction(() => typeof window.showModal === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(500);

  // 1. 三个废弃弹窗容器已不存在
  for (const pid of ['voiceInputModal', 'emitStoreOrderModal', 'photoInputModal']) {
    const exists = await page.evaluate(id => !!document.getElementById(id), pid);
    ok(`弹窗 ${pid} 已删除`, !exists);
  }

  // 2. 关键函数保留（真实功能）
  for (const fn of ['getEmitOrder', 'saveEmitOrder', 'renderEmitStoreList', 'handlePhoto', 'triggerPhoto', 'emitTriggerPhoto', 'startVoice', 'stopVoice', 'showModal']) {
    const defined = await page.evaluate(name => typeof window[name] === 'function', fn);
    ok(`函数 ${fn} 保留`, defined);
  }

  // 3. 已删函数确实不存在（避免幽灵引用）
  for (const fn of ['openVoiceInputModal', 'closeVoiceInputModal', 'openEmitStoreOrderModal', 'closeEmitStoreOrderModal', 'renderEmitStoreOrder', 'saveEmitStoreOrder', 'openPhotoInputModal']) {
    const defined = await page.evaluate(name => typeof window[name] === 'function', fn);
    ok(`废弃函数 ${fn} 已删除`, !defined);
  }

  // 4. closePhotoInputModal 保留为空函数（3 处历史调用兼容）
  const closePhotoOk = await page.evaluate(() => {
    const f = window.closePhotoInputModal;
    return typeof f === 'function' && f.length === 0;
  });
  ok('closePhotoInputModal 保留为兼容空函数', closePhotoOk);

  // 5. 调用 closePhotoInputModal 不报错（模拟 handlePhoto 流程）
  const callOk = await page.evaluate(() => {
    try { closePhotoInputModal(); return true; } catch (e) { return false; }
  });
  ok('closePhotoInputModal 调用无异常', callOk);

  // 6. 录音流程仍可启动（startVoice 定义存在且调用不抛引用错误）
  // 注意：真实录音需要麦克风权限，只验证函数入口存在且 voiceOverlay 可打开
  const voiceOverlayExists = await page.evaluate(() => !!document.getElementById('voiceOverlay'));
  ok('voiceOverlay 录音浮层保留', voiceOverlayExists);

  // 7. 回收店序功能保留（recoverStoreOrderModal 真实入口）
  const recoverBtn = await page.evaluate(() => {
    const el = document.getElementById('recoverOrderBtn');
    return !!el && el.getAttribute('onclick') === 'openRecoverStoreOrderModal()';
  });
  ok('回收店序按钮保留', recoverBtn);
  const recoverFn = await page.evaluate(() => typeof window.openRecoverStoreOrderModal === 'function');
  ok('openRecoverStoreOrderModal 保留', recoverFn);

  // 8. 语音录制状态操作不再引用已删元素（模拟 startVoice 的早期分支不抛错）
  // 直接验证页面无 voiceInBtn/voiceOutBtn 引用残留
  const noVoiceBtnRef = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return !html.includes('voiceInBtn') && !html.includes('voiceOutBtn');
  });
  ok('无 voiceInBtn/voiceOutBtn 引用残留', noVoiceBtnRef);

  // 9. 无 JS 错误（过滤 file:// 环境噪音）
  const realErrors = errors.filter(e =>
    !e.includes('Failed to load resource') &&
    !e.includes('fetch') &&
    !e.includes('net::') &&
    !e.includes('service worker') &&
    !e.includes('SW') &&
    !e.includes('SecurityError') &&
    !e.includes('NotAllowedError') &&
    !e.includes('Access to fetch') &&
    !e.includes('ERR_') &&
    !e.includes('favicon') &&
    !e.includes('file:///C:') &&
    !e.includes('Fetch API cannot load file') &&
    !e.includes('InvalidStateError') &&
    !e.includes('ServiceWorkerRegistration')
  );
  ok('无页面 JS 错误', realErrors.length === 0);
  if (realErrors.length) console.log('ERRORS:', realErrors.slice(0, 5));

  // 10. 版本号确认（const 不挂 window，从源码文本提取）
  const ver = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const m = html.match(/APP_VERSION = '([\d.]+)'/);
    return m ? m[1] : null;
  });
  ok(`版本号 ${ver}`, ver === '6.0.114');

  await browser.close();
  console.log(`\n===== ${passed}/${passed + failed} 通过 =====`);
  process.exit(failed > 0 ? 1 : 0);
})();
