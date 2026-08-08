// #73 旧语音浮层删除后验证：发出页录音浮层 + 语音确认链仍正常
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on('pageerror', e => { if (!e.message.includes('ServiceWorkerRegistration')) errors.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('file://') && !m.text().includes('ServiceWorkerRegistration') && !m.text().includes('404') && !m.text().includes('401')) errors.push(m.text()); });

  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

  await page.goto('file:///C:/Users/82375/Documents/框/inventory-app/index.html');
  await page.waitForFunction(() => typeof window.showEmitVoiceOverlay === 'function', null, { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.store-ocr-modal').forEach(m => m.classList.remove('show')));

  // 1. 旧浮层已删除
  const oldGone = await page.evaluate(() => !document.getElementById('voiceOverlay'));
  ok('旧 voiceOverlay 已删除', oldGone);

  // 2. 旧函数已删除
  const oldFnGone = await page.evaluate(() => typeof window.startVoice === 'undefined' && typeof window.stopVoice === 'undefined');
  ok('startVoice/stopVoice 已删除', oldFnGone);

  // 3. 发出页录音浮层仍在（在用）
  const emitExists = await page.evaluate(() => !!document.getElementById('emitVoiceOverlay'));
  ok('emitVoiceOverlay 存在', emitExists);

  // 4. 录音中模式显示（金色麦克风 + 波形 + 结束按钮）
  await page.evaluate(() => window.showEmitVoiceOverlay('record'));
  await page.waitForTimeout(300);
  const recShow = await page.evaluate(() => {
    const ov = document.getElementById('emitVoiceOverlay');
    return ov.style.display !== 'none' && !!document.getElementById('evMicWrap') && !!document.getElementById('emitVoiceBars') && !!document.getElementById('evStopBtn');
  });
  ok('录音中模式正常显示', recShow);
  await page.evaluate(() => window.hideEmitVoiceOverlay());

  // 5. 识别中模式（转圈）
  await page.evaluate(() => window.showEmitVoiceOverlay('recognizing'));
  await page.waitForTimeout(300);
  const recogShow = await page.evaluate(() => {
    const ov = document.getElementById('emitVoiceOverlay');
    return ov.style.display !== 'none' && document.getElementById('evSpinnerWrap').style.display !== 'none';
  });
  ok('识别中模式正常显示', recogShow);
  await page.evaluate(() => window.hideEmitVoiceOverlay());

  // 6. 语音确认链（解析函数保留）
  const chainOk = await page.evaluate(() => {
    return typeof window.parseVoiceWithAI === 'function' && typeof window.confirmVoiceFill === 'function' && typeof window.cancelVoiceFill === 'function' && !!document.getElementById('voiceConfirmModal') && !!document.getElementById('voiceConfirmInfo');
  });
  ok('语音确认链完整', chainOk);

  // 7. 原生录音函数保留（APK 录音用）
  const nativeOk = await page.evaluate(() => typeof window.canNativeRecord === 'function' && typeof window.nativeRecStart === 'function' && typeof window.nativeRecStop === 'function');
  ok('原生录音函数保留', nativeOk);

  // 8. 无 JS 报错
  ok('页面无 JS 报错', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));

  console.log(`\n结果: ${pass}/${pass+fail} 通过`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
