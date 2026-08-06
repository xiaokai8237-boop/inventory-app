// #54 deleteAccountModal 专项测试 — 深空蓝晶壳替换后验证
// 关键路径：设置隐私同意 → 清理残留 .show → JS 调用 openDeleteAccountModal() → 四步容器切换验证
const { chromium } = require('playwright');
const path = 'file:///C:/Users/82375/Documents/框/inventory-app/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(path, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('PASS: ' + name); } else { fail++; console.log('FAIL: ' + name); } };

  // 1. 设置隐私同意（否则 showModal 排队）
  await page.evaluate(() => { localStorage.setItem('kuanwei_privacy_consent', '1'); });
  // 2. 清理所有残留 .show（welcomeModal 等会顶掉目标弹窗）
  await page.evaluate(() => { document.querySelectorAll('.show').forEach(el => el.classList.remove('show')); });
  // 3. 打开注销弹窗
  await page.evaluate(() => { openDeleteAccountModal(); });
  await page.waitForTimeout(400);

  // 4. 弹窗显示 + 深空蓝晶壳
  ok('弹窗显示', await page.evaluate(() => document.getElementById('deleteAccountModal').classList.contains('show')));
  ok('dd-content 壳存在', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-content')));
  const shell = await page.evaluate(() => {
    const c = document.querySelector('#deleteAccountModal .dd-content');
    const cs = getComputedStyle(c);
    return { bg: cs.backgroundColor, border: cs.borderColor, radius: cs.borderRadius };
  });
  console.log('  壳样式:', JSON.stringify(shell));
  ok('背景 #0E3340', shell.bg === 'rgb(14, 51, 64)');
  ok('金色描边 rgba(245,220,146,.55)', shell.border.indexOf('rgba(245, 220, 146') !== -1 || shell.border.indexOf('rgba(245,220,146') !== -1);
  ok('圆角 22px', shell.radius === '22px');

  // 5. 默认第一步显示，其余隐藏
  ok('第一步可见', await page.evaluate(() => document.getElementById('deleteStep1').style.display !== 'none'));
  ok('第二步隐藏', await page.evaluate(() => document.getElementById('deleteStep2').style.display === 'none'));
  ok('成功隐藏', await page.evaluate(() => document.getElementById('deleteSuccess').style.display === 'none'));
  ok('后悔药隐藏', await page.evaluate(() => document.getElementById('deleteRegret').style.display === 'none'));

  // 6. 第一步内容：标题 SVG + 无 emoji + 双按钮
  ok('标题为「账号注销」', await page.evaluate(() => document.querySelector('#deleteAccountModal .dd-title').textContent.trim().includes('账号注销')));
  ok('标题含 SVG 图标', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-title svg')));
  ok('警告框 dd-warn 存在', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-warn')));
  ok('警告框含 SVG', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-warn svg')));
  ok('「取消」按钮', await page.evaluate(() => [...document.querySelectorAll('#deleteAccountModal .dd-btns button')].some(b => b.textContent.trim() === '取消')));
  ok('「我已知晓，继续」按钮', await page.evaluate(() => [...document.querySelectorAll('#deleteAccountModal .dd-btns button')].some(b => b.textContent.trim().includes('我已知晓'))));
  // emoji 扫描（弹窗内）
  const emojiInModal = await page.evaluate(() => {
    const txt = document.getElementById('deleteAccountModal').innerText;
    return [...txt].filter(ch => {
      const cp = ch.codePointAt(0);
      return (cp >= 0x1F300 && cp <= 0x1F9FF) || (cp >= 0x2600 && cp <= 0x27BF);
    });
  });
  ok('弹窗内无 emoji', emojiInModal.length === 0);

  // 7. 第一步 → 第二步
  await page.evaluate(() => { goDeleteStep2(); });
  await page.waitForTimeout(200);
  ok('第一步隐藏', await page.evaluate(() => document.getElementById('deleteStep1').style.display === 'none'));
  ok('第二步可见', await page.evaluate(() => document.getElementById('deleteStep2').style.display !== 'none'));

  // 8. 第二步：delPhoneLabel + 密码输入 + SVG 眼睛 + 无后悔药（关键：按用户确认去掉）
  ok('delPhoneLabel 存在', await page.evaluate(() => !!document.getElementById('delPhoneLabel')));
  ok('delPwd 输入框存在', await page.evaluate(() => !!document.getElementById('delPwd')));
  ok('delPwd_eye 含 SVG', await page.evaluate(() => !!document.querySelector('#delPwd_eye svg')));
  const step2HasPill = await page.evaluate(() => {
    const el = document.getElementById('deleteStep2');
    return el.textContent.includes('后悔药');
  });
  ok('第二步无后悔药', !step2HasPill);
  ok('密码输入行 dd-input-row 存在', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-input-row')));
  ok('「确认注销」按钮', await page.evaluate(() => [...document.querySelectorAll('#deleteAccountModal .dd-btns button')].some(b => b.textContent.trim().includes('确认注销'))));

  // 9. 眼睛切换密码可见
  await page.evaluate(() => {
    const inp = document.getElementById('delPwd');
    inp.value = '12345678';
    togglePwd('delPwd');
  });
  ok('眼睛切换后 type=text', await page.evaluate(() => document.getElementById('delPwd').type === 'text'));

  // 10. 第二步 → 注销成功（模拟 doDeleteAccount 成功分支）
  await page.evaluate(() => {
    document.getElementById('deleteStep2').style.display = 'none';
    document.getElementById('deleteSuccess').style.display = '';
  });
  await page.waitForTimeout(200);
  ok('成功弹窗可见', await page.evaluate(() => document.getElementById('deleteSuccess').style.display !== 'none'));
  ok('成功标题「账号已注销」', await page.evaluate(() => document.querySelector('#deleteAccountModal .dd-success-title').textContent.trim() === '账号已注销'));
  ok('成功含 SVG 大图标', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-success-icon')));
  ok('「知道了」按钮', await page.evaluate(() => [...document.querySelectorAll('#deleteAccountModal .dd-success button')].some(b => b.textContent.trim() === '知道了')));
  // 后悔药仅在成功弹窗显示（dd-pill）
  const pillInSuccess = await page.evaluate(() => {
    const el = document.getElementById('deleteSuccess');
    return !!el.querySelector('.dd-pill') && el.querySelector('.dd-pill').textContent.includes('后悔药');
  });
  ok('成功弹窗含后悔药(dd-pill)', pillInSuccess);
  const pillHasSvg = await page.evaluate(() => !!document.querySelector('#deleteSuccess .dd-pill svg'));
  ok('后悔药含 SVG 图标', pillHasSvg);

  // 11. 后悔药 → 后悔药内容（deleteRegret）
  await page.evaluate(() => { showDeleteRegret(); });
  await page.waitForTimeout(200);
  ok('后悔药内容可见', await page.evaluate(() => document.getElementById('deleteRegret').style.display !== 'none'));
  ok('成功弹窗已隐藏', await page.evaluate(() => document.getElementById('deleteSuccess').style.display === 'none'));
  ok('后悔药绿色框 dd-regret', await page.evaluate(() => !!document.querySelector('#deleteAccountModal .dd-regret')));
  ok('「别担心，数据还在」', await page.evaluate(() => document.querySelector('#deleteAccountModal .dd-regret-title').textContent.includes('别担心')));
  ok('「知道了」关闭按钮', await page.evaluate(() => [...document.querySelectorAll('#deleteAccountModal .dd-regret + button, #deleteAccountModal .dd-btns button, #deleteAccountModal .dd-success button')].some(b => b.textContent.trim() === '知道了')));

  // 12. 关闭弹窗
  await page.evaluate(() => { closeDeleteAccountModal(); });
  await page.waitForTimeout(200);
  ok('关闭后 .show 移除', await page.evaluate(() => !document.getElementById('deleteAccountModal').classList.contains('show')));

  // 13. 无页面错误（过滤 file:// 协议环境噪音：fetch file URL / SW 无效）
  const realErrors = errors.filter(e =>
    !e.includes('Fetch API cannot load file://') &&
    !e.includes('Failed to get ServiceWorkerRegistration') &&
    !e.includes('InvalidStateError')
  );
  ok('无页面 JS 错误', realErrors.length === 0);
  if (realErrors.length) console.log('REAL ERRORS:', realErrors.slice(0, 5));

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
