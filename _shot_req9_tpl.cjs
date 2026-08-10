// 需求9 模板渲染脚本：HTTP server 加载模板 + 截图到指定尺寸
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/_template_req9_s1.html';
  const f = path.join(process.cwd(), p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

const targets = [
  { tpl: '_template_req9_s1.html', out: '_show_req9_s1_v1.png', w: 1080, h: 1920 },
  { tpl: '_template_req9_landscape.html', out: '_show_req9_landscape_v1.png', w: 1920, h: 1080 },
];

(async () => {
  await new Promise(r => server.listen(8977, r));
  console.log('READY 8977');

  const browser = await chromium.launch();
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.w, height: t.h } });
    await page.goto('http://127.0.0.1:8977/' + t.tpl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      // 强制字体加载完成
      return document.fonts ? document.fonts.ready : Promise.resolve();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: t.out, fullPage: false });
    await page.close();
    console.log('OK: ' + t.out);
  }
  await browser.close();
  server.close();
})();