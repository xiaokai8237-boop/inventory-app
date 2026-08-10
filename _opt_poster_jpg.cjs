// 需求8 优化：7 张海报 PNG → JPEG q0.85（体积缩 4-6 倍，加载快）
// 用法: node _opt_poster_jpg.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const SRCS = [
  '_splash_v3_deepblue.png', '_splash_v3_teal.png', '_splash_v3_forest.png',
  '_splash_v3_navy.png', '_splash_v3_onyx.png', 'splash_1080x1882_qr.png', '_splash_new_v2_qr.png'
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const src of SRCS) {
    const b64 = fs.readFileSync(src).toString('base64');
    const out = src.replace(/\.png$/, '.jpg');
    const dataUrl = await page.evaluate(async ({ b64, quality }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      // 深色图 JPEG 前垫深色底，避免透明变黑
      ctx.fillStyle = '#061F28';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      return cv.toDataURL('image/jpeg', quality);
    }, { b64, quality: 0.85 });
    const base64 = dataUrl.split(',')[1];
    fs.writeFileSync(out, Buffer.from(base64, 'base64'));
    const before = fs.statSync(src).size, after = fs.statSync(out).size;
    console.log(out + ' OK ' + src.replace(/\.png$/, '') + ' ' + Math.round(before / 1024) + 'KB -> ' + Math.round(after / 1024) + 'KB (' + Math.round(after / before * 100) + '%)');
  }
  await browser.close();
  console.log('转换完成');
})();
