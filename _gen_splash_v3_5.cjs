// 需求8 再生成 5 张启动图（同 _splash_new_v2 类型，不同色调 + 左上角软件二维码）
// 用法: node _gen_splash_v3_5.cjs
// 输出: _splash_v3_deepblue.png / _splash_v3_teal.png / _splash_v3_forest.png / _splash_v3_navy.png / _splash_v3_onyx.png
const { chromium } = require('playwright');
const fs = require('fs');

// 复用需求7 QR 生成器
const htmlSrc = fs.readFileSync('index.html', 'utf8');
const qrStart = htmlSrc.indexOf('var QR_GF_EXP');
const qrEnd = htmlSrc.indexOf('function drawCrown');
const qrCode = htmlSrc.slice(qrStart, qrEnd);
const QR_TEXT = 'https://inventory-app-9ql.pages.dev/';

// 5 个色调（深色冷调，避免 P0-2 紫粉渐变；金色 logo 统一）
const TONES = [
  { name: 'deepblue', label: '深蓝夜空', bg: ['#0E3340', '#082E38', '#061F28'] },
  { name: 'teal',     label: '青湖蓝',   bg: ['#0B3A4E', '#0E4A60', '#07222E'] },
  { name: 'forest',   label: '墨绿森林', bg: ['#0F3326', '#12452F', '#071E14'] },
  { name: 'navy',     label: '藏蓝夜幕', bg: ['#131F3E', '#182A54', '#0A1128'] },
  { name: 'onyx',     label: '曜石黑金', bg: ['#1A1F29', '#242B37', '#0D1117'] },
];

const STARS = [
  'left:18%;top:24%;width:6px;height:6px;background:rgba(255,255,255,.6)',
  'left:72%;top:16%;width:4px;height:4px;background:rgba(255,255,255,.4)',
  'left:86%;top:36%;width:3px;height:3px;background:rgba(255,255,255,.3)',
  'left:36%;top:66%;width:6px;height:6px;background:rgba(255,255,255,.5)',
  'left:54%;top:80%;width:4px;height:4px;background:rgba(255,255,255,.35)',
  'left:10%;top:50%;width:3px;height:3px;background:rgba(255,255,255,.3)',
  'left:91%;top:68%;width:4px;height:4px;background:rgba(255,255,255,.4)',
  'left:63%;top:8%;width:3px;height:3px;background:rgba(255,255,255,.3)',
  'left:78%;top:88%;width:5px;height:5px;background:rgba(255,255,255,.5)',
  'left:28%;top:10%;width:3px;height:3px;background:rgba(255,255,255,.3)'
];

function qrGridHtml(mat) {
  const n = mat.length;
  let cells = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    cells += mat[r][c]
      ? '<div style="width:10px;height:10px;background:#000;"></div>'
      : '<div style="width:10px;height:10px;background:#fff;"></div>';
  }
  return cells;
}

const qrCardHtml = (cells) => `
  <div style="position:absolute;left:35px;top:53px;background:#fff;border-radius:16px;padding:26px 26px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35);z-index:9;">
    <div style="display:flex;flex-wrap:wrap;width:290px;line-height:0;">${cells}</div>
    <div style="text-align:center;font-size:22px;font-weight:800;color:#1E3A5F;letter-spacing:2px;margin-top:12px;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;">扫码使用 物流筐</div>
  </div>`;

const htmlFor = (tone, qr) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; }
  html, body { width: 100%; height: 100%; }
  body {
    background: radial-gradient(120% 80% at 50% 0%, ${tone.bg[0]} 0%, ${tone.bg[1]} 55%, ${tone.bg[2]} 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    overflow: hidden; position: relative;
  }
  .stars { position: absolute; inset: 0; }
  .s { position: absolute; border-radius: 50%; }
  .logo {
    width: 170px; height: 170px; border-radius: 44px;
    background: linear-gradient(135deg, #F8E3A6, #E0A63E);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 18px 60px rgba(224,166,62,.45);
  }
  .brand { font-size: 66px; font-weight: 900; color: #fff; margin-top: 56px; letter-spacing: 6px; }
  .slogan { font-size: 46px; color: #F5DC92; margin-top: 26px; letter-spacing: 10px; }
  .points { margin-top: 80px; display: flex; flex-direction: column; gap: 30px; }
  .pt { display: flex; align-items: center; justify-content: center; gap: 22px; font-size: 40px; color: #CFECEF; }
  .dot { width: 22px; height: 22px; border-radius: 50%; background: #7CE8E0; }
  .foot { position: absolute; bottom: 110px; left: 0; right: 0; text-align: center; font-size: 32px; color: rgba(255,255,255,.45); letter-spacing: 6px; }
</style>
</head>
<body>
  <div class="stars">
    ${STARS.map(s => `<div class="s" style="${s};"></div>`).join('\n    ')}
  </div>
  <div class="logo">
    <svg viewBox="0 0 24 24" width="92" height="92" fill="none" stroke="#0B2E38" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>
  </div>
  <div class="brand">物流筐收发管理系统</div>
  <div class="slogan">让筐数清清楚楚</div>
  <div class="points">
    <div class="pt"><span class="dot"></span>手动 / 语音 / 拍照 都能记</div>
    <div class="pt"><span class="dot"></span>到店提醒 · 自动定位门店</div>
    <div class="pt"><span class="dot"></span>数据云备份 · 换机不丢</div>
    <div class="pt"><span class="dot"></span>简单好用 · 司机友好</div>
  </div>
  <div class="foot">物流筐 · 收发管理</div>
  ${qr}
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1882 } });
  await page.goto('about:blank');

  // 1. 生成二维码矩阵（字符串传递，避免函数序列化）
  const matStr = await page.evaluate(({ qrCode, QR_TEXT }) => {
    (0, eval)(qrCode);
    const m = qrBuildMatrix(QR_TEXT);
    if (!m || !m.length) return 'ERR:EMPTY';
    return m.map(r => r.map(c => (c ? '1' : '0')).join('')).join('|');
  }, { qrCode, QR_TEXT });
  if (matStr.startsWith('ERR')) { console.error('QR 生成失败:', matStr); process.exit(1); }
  const mat = matStr.split('|').map(r => r.split('').map(c => c === '1'));
  const cells = qrGridHtml(mat);
  console.log('QR 矩阵:', mat.length + 'x' + mat.length);

  // 2. 生成 5 张
  for (const tone of TONES) {
    const html = htmlFor(tone, qrCardHtml(cells));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const out = '_splash_v3_' + tone.name + '.png';
    await page.screenshot({ path: out });
    console.log(out + ' OK (' + tone.label + ')');
  }
  await browser.close();
  console.log('5 张完成');
})();
