// 需求9：生成 4 张竖屏模板 (s2/s3/s4/s5)，通过替换模板占位符实现
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/_template_req9_portrait.html';
  const f = path.join(process.cwd(), p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

const specs = [
  // 竖②录入三方法
  {
    idx: 2,
    title: '三种录入 说拍填都行',
    slogan: '语音一句、拍照一张、手动输一行',
    img: '_shot_req9_s2_emit.png',
    out: '_show_req9_s2_v1.png',
    feats: [
      { t: '拍照识别', d: 'AI 自动<br>判断筐类型', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' },
      { t: '语音录入', d: '对手机说<br>数字自动填', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>' },
      { t: '手动录入', d: '5筐按钮<br>填数最稳', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' },
    ]
  },
  // 竖③记录+汇总
  {
    idx: 3,
    title: '记录筛选 一目了然',
    slogan: '按日按店按筐，随查随看',
    img: '_shot_req9_s7_summary.png',
    out: '_show_req9_s3_v1.png',
    feats: [
      { t: '筛选查找', d: '日期/店面<br>/筐 多条件', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>' },
      { t: '汇总日报', d: '近3天/30天<br>导出 Excel', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
      { t: '编辑删除', d: '记错了<br>一键改回来', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' },
    ]
  },
  // 竖④会员+邀请拉新
  {
    idx: 4,
    title: 'VIP 邀请拉新',
    slogan: '注册送 1 月 · 邀请各 +15 天',
    img: '_shot_req9_s5_invite.png',
    out: '_show_req9_s4_v1.png',
    feats: [
      { t: '注册即享', d: '新用户<br>30 天 VIP', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20l1.1-6.5L2.6 8.8l6.5-.9L12 2z"/></svg>' },
      { t: '双方各 +15', d: '邀请人与被邀请人<br>都拿 15 天', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98"/><path d="M15.41 6.51l-6.82 3.98"/></svg>' },
      { t: '每月 20 人', d: '防作弊上限<br>扫码带码', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="21"/><line x1="14" y1="21" x2="20" y2="21"/></svg>' },
    ]
  },
  // 竖⑤极简模式
  {
    idx: 5,
    title: '极简模式 一目了然',
    slogan: '只记 5 筐总数，适合老司机',
    img: '_shot_req9_s6_simple.png',
    out: '_show_req9_s5_v1.png',
    feats: [
      { t: '5 筐总数', d: '鲜食面包冷藏<br>冷冻常温', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>' },
      { t: '范围记录', d: '支持区间<br>批量录入', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>' },
      { t: '大字大按钮', d: '适合车上<br>单手操作', i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h10M7 12h10M7 16h6"/></svg>' },
    ]
  },
];

(async () => {
  await new Promise(r => server.listen(8978, r));
  console.log('READY 8978');
  let tpl = fs.readFileSync('_template_req9_portrait.html', 'utf8');

  const browser = await chromium.launch();
  for (const s of specs) {
    let html = tpl
      .replace(/\{\{TITLE\}\}/g, s.title)
      .replace(/\{\{SLOGAN\}\}/g, s.slogan)
      .replace(/\{\{IMG\}\}/g, s.img)
      .replace(/\{\{IDX\}\}/g, String(s.idx));
    // 替换 3 个 feat
    html = html.replace(/\{\{F1_ICON\}\}/g, s.feats[0].i);
    html = html.replace(/\{\{F1_T\}\}/g, s.feats[0].t);
    html = html.replace(/\{\{F1_D\}\}/g, s.feats[0].d);
    html = html.replace(/\{\{F2_ICON\}\}/g, s.feats[1].i);
    html = html.replace(/\{\{F2_T\}\}/g, s.feats[1].t);
    html = html.replace(/\{\{F2_D\}\}/g, s.feats[1].d);
    html = html.replace(/\{\{F3_ICON\}\}/g, s.feats[2].i);
    html = html.replace(/\{\{F3_T\}\}/g, s.feats[2].t);
    html = html.replace(/\{\{F3_D\}\}/g, s.feats[2].d);

    const tmpFile = '_tmp_portrait_' + s.idx + '.html';
    fs.writeFileSync(tmpFile, html);

    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto('http://127.0.0.1:8978/' + tmpFile, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: s.out, fullPage: false });
    await page.close();

    fs.unlinkSync(tmpFile);
    console.log('OK: ' + s.out);
  }
  await browser.close();
  server.close();
})();