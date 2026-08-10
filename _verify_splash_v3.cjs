// 验证 5 张 v3 启动图：QR 黑密度 + 背景色调区分 + 卡片外无污染
const { chromium } = require('playwright');
const fs = require('fs');

const FILES = [
  '_splash_v3_deepblue.png', '_splash_v3_teal.png', '_splash_v3_forest.png',
  '_splash_v3_navy.png', '_splash_v3_onyx.png'
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const f of FILES) {
    const r = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // QR 区: (61,79) 290x290 (cell=10, n=29, pad=26)
      const x0 = 61, y0 = 79, qs = 290;
      let dark = 0, total = 0;
      for (let r = 0; r < qs; r += 2) for (let c = 0; c < qs; c += 2) {
        const d = ctx.getImageData(x0 + c, y0 + r, 1, 1).data;
        if (d[0] < 128) dark++;
        total++;
      }
      // 背景采样（右上角远离卡片区）: (900, 1400)
      const bg = ctx.getImageData(900, 1400, 1, 1).data;
      // 卡片外左下角（原背景）: (500, 1780)
      const bg2 = ctx.getImageData(500, 1780, 1, 1).data;
      return {
        qr: (dark / total * 100).toFixed(1) + '%',
        bgTop: bg.slice(0, 3).join(','),
        bgBottom: bg2.slice(0, 3).join(',')
      };
    }, fs.readFileSync(f).toString('base64'));
    console.log(f.padEnd(26) + ' QR黑密度=' + r.qr + ' 顶部背景RGB(' + r.bgTop + ') 底部背景RGB(' + r.bgBottom + ')');
  }
  await browser.close();
})();
