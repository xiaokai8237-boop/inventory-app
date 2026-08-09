// 需求4 功能分档专项测试：非 VIP 拦截 / VIP 放行
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // ===== 非 VIP 拦截测试 =====
  const nonVip = await page.evaluate(() => {
    const out = {};
    // 需求5：临时关闭测试期默认 VIP，模拟真实非 VIP 场景验证拦截仍有效
    VIP_TEST_MODE = false;
    localStorage.removeItem('kuanwei_vip_until');
    // 预置店面（避免 openPermPage 前置判断干扰；实际 requireVip 在最前）
    out.isVipDefault = isVip();
    // 1. 权限管理（到店通知）
    openPermPage();
    out.permLocked = document.getElementById('vipLockModal').classList.contains('show');
    out.permPageNotActive = !document.querySelector('#page-perm.active');
    closeVipLockModal();
    // 2. 极简模式
    setSimpleMode(true);
    out.simpleLocked = document.getElementById('vipLockModal').classList.contains('show');
    out.simpleNotSwitched = localStorage.getItem('kuanwei_simple_mode') !== '1';
    closeVipLockModal();
    // 3. 拍照
    emitTriggerPhoto();
    out.photoLocked = document.getElementById('vipLockModal').classList.contains('show');
    closeVipLockModal();
    // 4. 语音
    emitStartVoice();
    out.voiceLocked = document.getElementById('vipLockModal').classList.contains('show');
    closeVipLockModal();
    // 5. 汇总
    openSummaryPage();
    out.summaryLocked = document.getElementById('vipLockModal').classList.contains('show');
    out.summaryNotActive = !document.querySelector('#page-summary.active');
    closeVipLockModal();
    // 6. 对账
    openReconcilePage();
    out.reconcileLocked = document.getElementById('vipLockModal').classList.contains('show');
    closeVipLockModal();
    // 7. 到店监测
    startArrivalMonitor();
    out.monitorNotStarted = arrivalTimer === null;
    return out;
  });

  const nonVipPass = nonVip.isVipDefault === false &&
    nonVip.permLocked && nonVip.permPageNotActive &&
    nonVip.simpleLocked && nonVip.simpleNotSwitched &&
    nonVip.photoLocked && nonVip.voiceLocked &&
    nonVip.summaryLocked && nonVip.summaryNotActive &&
    nonVip.reconcileLocked && nonVip.monitorNotStarted;
  console.log('[非VIP拦截]', nonVipPass ? 'PASS' : 'FAIL');
  console.log(JSON.stringify(nonVip, null, 1));

  // ===== VIP 放行测试 =====
  const vip = await page.evaluate(() => {
    // 需求5：关闭测试模式，验证"到期时间放行"逻辑本身仍有效
    VIP_TEST_MODE = false;
    // 模拟开通 VIP（未来 30 天）
    localStorage.setItem('kuanwei_vip_until', new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString());
    const out = {};
    out.isVip = isVip();
    openPermPage();
    out.permOpened = !!document.querySelector('#page-perm.active');
    return out;
  });
  const vipPass = vip.isVip === true && vip.permOpened === true;
  console.log('[VIP放行]', vipPass ? 'PASS' : 'FAIL');
  console.log(JSON.stringify(vip, null, 1));

  // 忽略 file:// SW 环境错误
  const realErrors = errors.filter(e => !/ServiceWorkerRegistration|invalid state/i.test(e));
  console.log('非SW错误:', realErrors.length === 0 ? '无' : JSON.stringify(realErrors));
  await browser.close();
  process.exit(nonVipPass && vipPass && realErrors.length === 0 ? 0 : 1);
})();
