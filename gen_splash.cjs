// 生成原生启动图 splash.png（v2：px 基准，按 1080x1882 设计）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Noto Sans SC', sans-serif; }
  html, body { width: 100%; height: 100%; }
  body {
    background: radial-gradient(120% 80% at 50% 0%, #0E3340 0%, #082E38 55%, #061F28 100%);
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
    <div class="s" style="left:18%;top:24%;width:6px;height:6px;background:rgba(255,255,255,.6);"></div>
    <div class="s" style="left:72%;top:16%;width:4px;height:4px;background:rgba(255,255,255,.4);"></div>
    <div class="s" style="left:86%;top:36%;width:3px;height:3px;background:rgba(255,255,255,.3);"></div>
    <div class="s" style="left:36%;top:66%;width:6px;height:6px;background:rgba(255,255,255,.5);"></div>
    <div class="s" style="left:54%;top:80%;width:4px;height:4px;background:rgba(255,255,255,.35);"></div>
    <div class="s" style="left:10%;top:50%;width:3px;height:3px;background:rgba(255,255,255,.3);"></div>
    <div class="s" style="left:91%;top:68%;width:4px;height:4px;background:rgba(255,255,255,.4);"></div>
    <div class="s" style="left:63%;top:8%;width:3px;height:3px;background:rgba(255,255,255,.3);"></div>
    <div class="s" style="left:78%;top:88%;width:5px;height:5px;background:rgba(255,255,255,.5);"></div>
    <div class="s" style="left:28%;top:10%;width:3px;height:3px;background:rgba(255,255,255,.3);"></div>
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
</body>
</html>`;

const SIZES = [
  { dir: 'drawable-port-mdpi', w: 480, h: 762 },
  { dir: 'drawable-land-mdpi', w: 762, h: 480 },
  { dir: 'drawable-port-hdpi', w: 720, h: 1242 },
  { dir: 'drawable-land-hdpi', w: 1242, h: 720 },
  { dir: 'drawable-port-xhdpi', w: 1080, h: 1882 },
  { dir: 'drawable-land-xhdpi', w: 1882, h: 1080 },
  { dir: 'drawable-port-xxhdpi', w: 1080, h: 1882 },
  { dir: 'drawable-land-xxhdpi', w: 1882, h: 1080 },
  { dir: 'drawable-port-xxxhdpi', w: 1080, h: 1882 },
  { dir: 'drawable-land-xxxhdpi', w: 1882, h: 1080 },
  { dir: 'drawable', w: 1080, h: 1882 },
];

(async () => {
  const browser = await chromium.launch();
  const root = path.resolve(__dirname, 'android/app/src/main/res');
  const seen = new Map();
  for (const s of SIZES) {
    const key = s.w + 'x' + s.h;
    const target = path.join(root, s.dir, 'splash.png');
    if (seen.has(key)) {
      fs.copyFileSync(seen.get(key), target);
      console.log(s.dir + ': copied from ' + key);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
    await page.setContent(HTML, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.screenshot({ path: target });
    seen.set(key, target);
    console.log(s.dir + ': rendered ' + s.w + 'x' + s.h);
    await page.close();
  }
  await browser.close();
  console.log('ALL SPLASH PNG DONE');
  process.exit(0);
})();