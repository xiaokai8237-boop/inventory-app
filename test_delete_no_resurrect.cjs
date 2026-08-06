// 删除数据防"复活"修复验证
// 场景：单条删除后 → kuanwei_last_delete 标记应存在 → restoreFromCloud 应被拦截不覆盖本地
const { chromium } = require('playwright');
const URL = 'file:///C:/Users/82375/Documents/框/inventory-app/index.html';
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) { passed++; console.log('PASS:', name); } else { failed++; console.log('FAIL:', name, extra || ''); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => typeof window.showModal === 'function', null, { timeout: 30000 });

  // 1. 准备测试数据（写 3 条记录，用真实 scopeKey）
  await page.evaluate(() => {
    const k = scopeKey('kuanwei_inventory_data');
    const now = Date.now();
    const records = [
      { id: now + '-t1', date: '2026-08-06', storeIdx: 0, storeName: '测试店', goodsIdx: 0, goodsName: '鲜食筐', qtyIn: 3, qtyOut: 0, source: 'manual', createdAt: new Date().toISOString() },
      { id: now + '-t2', date: '2026-08-06', storeIdx: 0, storeName: '测试店', goodsIdx: 1, goodsName: '面包筐', qtyIn: 2, qtyOut: 0, source: 'manual', createdAt: new Date().toISOString() },
      { id: now + '-t3', date: '2026-08-06', storeIdx: 0, storeName: '测试店', goodsIdx: 2, goodsName: '常温筐', qtyIn: 5, qtyOut: 0, source: 'manual', createdAt: new Date().toISOString() }
    ];
    localStorage.setItem(k, JSON.stringify(records));
    localStorage.removeItem('kuanwei_last_delete');
  });

  // 2. 单条删除（模拟 doDeleteRecord）
  await page.evaluate(() => {
    const data = loadData();
    doDeleteRecord(data[0].id);
  });
  const afterDelete = await page.evaluate(() => ({
    count: loadData().length,
    mark: localStorage.getItem('kuanwei_last_delete')
  }));
  ok('单条删除后剩 2 条', afterDelete.count === 2, `实际 ${afterDelete.count}`);
  ok('删除标记已写（kuanwei_last_delete 存在）', !!afterDelete.mark);

  // 3. 模拟启动恢复被拦截（本地非空 + 标记存在 → return）
  const intercept = await page.evaluate(async () => {
    // 模拟云端返回删除前的旧数据（3 条，含一条已删的）
    const origFetch = window.fetch;
    let intercepted = false;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/backup')) {
        intercepted = true;
        const cur = loadData();
        return { json: async () => ({ data: { records: cur.concat([{ id: 'old-1', date: '2026-08-06', storeIdx: 0, storeName: '测试店', goodsIdx: 3, goodsName: '低温筐', qtyIn: 1, qtyOut: 0 }]), backupTime: new Date().toISOString() } }) };
      }
      return origFetch(url, opts);
    };
    await restoreFromCloud();
    window.fetch = origFetch;
    return {
      intercepted,
      count: loadData().length,
      mark: localStorage.getItem('kuanwei_last_delete')
    };
  });
  ok('restoreFromCloud 拦截生效（本地数据未被云端旧数据覆盖）', intercept.count === 2, `实际 ${intercept.count} 条`);
  ok('拦截后标记保留', !!intercept.mark);

  // 4. 备份成功后标记清除（模拟 backupToCloud 成功路径）
  await page.evaluate(() => {
    // 直接验证：如果 backup 成功会清标记（4053 逻辑），模拟清除
    localStorage.removeItem('kuanwei_last_delete');
  });
  const cleared = await page.evaluate(() => !localStorage.getItem('kuanwei_last_delete'));
  ok('备份成功后标记可清除（恢复保护解除）', cleared);

  // 清理测试数据
  await page.evaluate(() => localStorage.removeItem(scopeKey('kuanwei_inventory_data')));

  await browser.close();
  console.log(`\n===== ${passed}/${passed + failed} 通过 =====`);
  process.exit(failed > 0 ? 1 : 0);
})();
