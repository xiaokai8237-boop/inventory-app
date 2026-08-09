// 专项测试：删除数据永不复活（需求10深度检查 #226c）
// 场景1: 本机保存过(last_save存在) + 删光 + 云端旧数据 → 启动恢复不复活
// 场景2: 本机从未保存(首次/换机) + 云端有数据 → 正常恢复
// 场景3: 本机保存过 + 本地有数据 + 云端旧 → 本地不被覆盖
const { chromium } = require('playwright');
const path = require('path');

async function runScenario(browser, name, setup, cloudData, expectRecordsAfter) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // 先加载页面 JS 到全局，再在页面上下文执行场景
  const result = await page.evaluate(async ({ setup, cloudData }) => {
    // stub fetch：拦截 /backup GET 返回模拟云端数据
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes('/backup') && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return Promise.resolve({
          json: () => Promise.resolve({ data: cloudData }),
          status: 200,
        });
      }
      return realFetch(url, opts);
    };
    // 执行场景 setup（操作本地数据）—— eval 后立即调用
    if (setup) (0, eval)(setup)();
    // 触发启动恢复
    await restoreFromCloud();
    await new Promise(r => setTimeout(r, 300));
    // 读取恢复后的本地数据
    const recs = loadData();
    const goods = loadGoodsConfig();
    const stores = loadStoreConfig();
    const lastSave = localStorage.getItem('kuanwei_last_save');
    return {
      recsLen: recs.length,
      recsSample: recs.slice(0, 2),
      goodsLen: goods.length,
      storesLen: stores.length,
      lastSave: !!lastSave,
    };
  }, { setup, cloudData });

  const pass = result.recsLen === expectRecordsAfter;
  // 忽略 file:// 环境性 SW 注册错误（非代码问题）；仅统计非 SW 错误
  const realErrors = errors.filter(e => !/ServiceWorkerRegistration|invalid state/i.test(e));
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`      恢复后 records=${result.recsLen} (期望 ${expectRecordsAfter}) | last_save=${result.lastSave} | JS错误=${errors.length}${realErrors.length ? ' | 非SW错误: ' + JSON.stringify(realErrors) : ''}`);
  if (result.recsLen !== expectRecordsAfter) console.log('      样本:', JSON.stringify(result.recsSample));
  await page.close();
  return pass;
}

(async () => {
  const browser = await chromium.launch();
  let allPass = true;
  const cloudOldData = { backupTime: new Date().toISOString(), records: [{ id: 'revive1', date: '2026-08-09', storeIdx: 0, goodsIdx: 0, qtyOut: 5 }], goodsConfig: [], storeConfig: [], simpleRecords: [] };

  // 场景1：本机保存过 + 删光 + 云端旧数据 → 不复活（核心修复）
  allPass &= await runScenario(browser, '场景1: 保存过+删光+云端旧 → 启动不复活', `() => {
    saveDataArr([{ id: 'a', date: '2026-08-08', storeIdx: 0, goodsIdx: 0, qtyOut: 1 }]); // 保存过 → last_save 存在
    saveDataArr([]); // 删光
    localStorage.setItem('kuanwei_last_delete', new Date().toISOString()); // 删除标记
  }`, cloudOldData, 0);

  // 场景2：本机从未保存(换机) + 云端有数据 → 正常恢复
  allPass &= await runScenario(browser, '场景2: 从未保存+云端有 → 恢复', `() => {
    localStorage.clear();
    localStorage.removeItem('kuanwei_last_save');
  }`, cloudOldData, 1);

  // 场景3：本机保存过 + 本地有数据 + 云端旧 → 本地不被覆盖
  allPass &= await runScenario(browser, '场景3: 本地有数据+云端旧 → 不覆盖', `() => {
    localStorage.clear();
    saveDataArr([{ id: 'keep', date: '2026-08-09', storeIdx: 1, goodsIdx: 1, qtyOut: 9 }]); // 本地新数据
  }`, cloudOldData, 1);

  await browser.close();
  console.log(allPass ? '\n=== 3/3 全过：删除数据永不复活 ===' : '\n=== 有 FAIL ===');
  process.exit(allPass ? 0 : 1);
})();
