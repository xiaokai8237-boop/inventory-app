// 需求8 启动图加二维码：两张启动图左下角合成软件二维码（复用需求7 QR 生成器）
// 用法: node _add_qr_to_splash.cjs
// 输出: splash_1080x1882_qr.png / _splash_new_v2_qr.png（不动原图）
const { chromium } = require('playwright');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
// 提取需求7 内嵌 QR 生成器代码（var QR_GF_EXP ... function drawCrown 前）
const qrStart = html.indexOf('var QR_GF_EXP');
const qrEnd = html.indexOf('function drawCrown');
if (qrStart < 0 || qrEnd < 0 || qrEnd <= qrStart) { console.error('QR 代码段定位失败'); process.exit(1); }
const qrCode = html.slice(qrStart, qrEnd);
console.log('QR 代码段:', (qrEnd - qrStart), '字符');

const QR_TEXT = 'https://inventory-app-9ql.pages.dev/'; // 软件主页（不带邀请码，通用图）
const targets = [
  { src: 'splash_1080x1882.png', out: 'splash_1080x1882_qr.png' },
  { src: '_splash_new_v2.png', out: '_splash_new_v2_qr.png' }
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1882 } });
  await page.goto('about:blank');

  for (const t of targets) {
    if (!fs.existsSync(t.src)) { console.log(t.src + ' 不存在，跳过'); continue; }
    const b64 = fs.readFileSync(t.src).toString('base64');
    const out = await page.evaluate(async ({ qrCode, b64, QR_TEXT }) => {
      // 1. 加载 QR 生成器
      try { (0, eval)(qrCode); } catch (e) { return { ok: false, err: 'QR eval: ' + e.message }; }
      const mat = qrBuildMatrix(QR_TEXT);
      if (!mat || !mat.length) return { ok: false, err: 'qrBuildMatrix 空' };
      const n = mat.length;

      // 2. 加载启动图
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load')); });
      const W = img.width, H = img.height;

      // 3. 画布
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // 4. 二维码几何：左上角，整数格（缩小一圈避开居中的 logo）
      const cell = Math.floor(W * 0.27 / n);          // 单格 px（~10，比之前 11 略小）
      const qrSize = cell * n;                        // 二维码实际 px
      const pad = Math.round(qrSize * 0.09);          // 卡片内边距
      const textH = Math.round(qrSize * 0.15);        // 卡片内文字行高
      const cardW = qrSize + pad * 2;
      const cardH = qrSize + pad * 2 + textH;
      const marginL = Math.round(W * 0.032);          // 左边距 ~35（靠角落）
      const marginT = Math.round(H * 0.028);          // 上边距 ~53
      const x = marginL, y = marginT;                  // 左上角

      // 5. 白色圆角卡片（含阴影）
      const roundRect = (c, x0, y0, w, h, r) => {
        c.beginPath();
        c.moveTo(x0 + r, y0);
        c.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
        c.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
        c.arcTo(x0, y0 + h, x0, y0, r);
        c.arcTo(x0, y0, x0 + w, y0, r);
        c.closePath();
      };
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.30)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, x, y, cardW, cardH, 16);
      ctx.fill();
      ctx.restore();

      // 6. 二维码（黑格）
      const qx = x + pad, qy = y + pad;
      ctx.fillStyle = '#000000';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (mat[r][c]) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);
        }
      }

      // 7. 卡片内底部提示文字（深灰，避免碰原图底部内容）
      ctx.fillStyle = '#1E3A5F';
      ctx.font = 'bold ' + Math.round(qrSize * 0.075) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('扫码使用 物流筐', x + cardW / 2, y + cardH - Math.round(textH * 0.38));

      // 8. 导出
      const data = cv.toDataURL('image/png');
      let dark = 0;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mat[r][c]) dark++;
      return { ok: true, W, H, n, cell, qrSize, cardW, cardH, x, y, darkRatio: (dark / (n * n) * 100).toFixed(1) + '%', data };
    }, { qrCode, b64, QR_TEXT });

    if (!out.ok) { console.log(t.src + ' 失败: ' + out.err); continue; }
    const base64Data = out.data.split(',')[1];
    fs.writeFileSync(t.out, Buffer.from(base64Data, 'base64'));
    console.log(t.out + ' OK ' + out.W + 'x' + out.H + ' | QR ' + out.n + 'x' + out.n + ' (' + out.darkRatio + ') | 卡片 ' + out.cardW + 'x' + out.cardH + ' @(' + out.x + ',' + out.y + ')');
  }
  await browser.close();
  console.log('完成');
})();
