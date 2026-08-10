// 需求8 批量清理 emoji：HTML 区 → SVG 图标；JS 区 → 文字（防破坏字符串）
const fs = require('fs');
const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');
const backup = html;

// ===== SVG 映射（HTML 区，功能图标；双引号属性） =====
const S = (d, extra) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:3px;">${d}</svg>`;
const SVG_MAP = {
  '🏪': S('<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v11h18V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>'),
  '📦': S('<path d="M21 8v8l-9 5-9-5V8l9-5 9 5z"/><line x1="3" y1="8" x2="12" y2="13"/><line x1="12" y1="13" x2="21" y2="8"/><line x1="12" y1="13" x2="12" y2="21"/>'),
  '💾': S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  '📈': S('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>'),
  '📊': S('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>'),
  '🔄': S('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  '🔁': S('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  '💡': S('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'),
  '❓': S('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  '📱': S('<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'),
  '📲': S('<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/><path d="M12 8v6"/><path d="M9 11l3 3 3-3"/>'),
  '🔑': S('<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  '👤': S('<circle cx="12" cy="7" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>'),
  '🔒': S('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  '📡': S('<path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'),
  '📤': S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5-5 5 5"/><path d="M12 15V3"/>'),
  '📥': S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 14l5 5 5-5"/><path d="M12 4v15"/>'),
  '📷': S('<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="8" y1="6" x2="10" y2="3"/><line x1="16" y1="6" x2="14" y2="3"/>'),
  '📸': S('<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="8" y1="6" x2="10" y2="3"/><line x1="16" y1="6" x2="14" y2="3"/>'),
  '🖼': S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  '🎤': S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/>'),
  '✍': S('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
  '✏': S('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
  '🗑': S('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
  '🔍': S('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  '➕': S('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  '📋': S('<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>'),
  '📅': S('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  '🎁': S('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
  '👑': S('<path d="M2 18h20"/><path d="M4 18l-2-9 6 4 4-7 4 7 6-4-2 9"/>'),
  '🚪': S('<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h20"/><path d="M13 20V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v16"/><line x1="13" y1="11" x2="13.01" y2="11"/>'),
  '☰': S('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'),
  '☁': S('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  '📨': S('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>'),
  '🚀': S('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  '📌': S('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  '📖': S('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  '🕐': S('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  '🔔': S('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  '⭐': S('<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'),
  '🔥': S('<path d="M12 22c4.42 0 8-3.58 8-8 0-4-2.5-6.5-5-9-1 3-2 4-4 5-2 1-4 2.5-4 6 0 4.42 3.58 6 5 6z"/>'),
  '🏆': S('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 2 4h1"/><path d="M17 6h3a2 2 0 0 1-2 4h-1"/>'),
  '📝': S('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/>'),
  '⚙': S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  '⏳': S('<path d="M6 2h12v6l-4 4 4 4v6H6v-6l4-4-4-4V2z"/><line x1="6" y1="2" x2="18" y2="2"/>'),
  '🍎': S('<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'),
};

// ===== 文字映射（JS 区，防破坏字符串；及内容性 emoji） =====
const TXT_MAP = {
  '✅': '√', '⚠': '!', '✕': '×', '❓': '?', '🤖': 'AI', '🔸': '·',
  '🎉': '', '👋': '', '🙈': '', '📌': '', '🚀': '', '⭐': '', '🏆': '',
  '🔔': '', '🔥': '', '⏳': '', '⚙': '', '🔁': '', '📝': '', '🕐': '',
};

// 剥离变体选择符（FE0F）后匹配
const strip = (s) => s.replace(/\uFE0F/g, '');

// emoji 正则（匹配任意 emoji 序列，含变体符）
const EMO_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

// 替换函数：HTML 区用 SVG，JS 区用文字
function replaceZone(zone, mode) {
  const map = mode === 'html' ? SVG_MAP : TXT_MAP;
  return zone.replace(EMO_RE, (m) => {
    const base = strip(m);
    // 先查完整映射（含变体）
    if (map[base] !== undefined) return map[base];
    // SVG 区再查文字映射（内容性 emoji）
    if (mode === 'html' && TXT_MAP[base] !== undefined) return TXT_MAP[base];
    // 未映射的：HTML 区转空（图标类都该映射了），JS 区转空
    return '';
  });
}

// 切分 HTML/JS 区
const parts = [];
let idx = 0;
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  parts.push({ type: 'html', content: html.slice(idx, m.index) });
  parts.push({ type: 'js', content: m[0] }); // 整个 script 块（含标签）
  idx = m.index + m[0].length;
}
parts.push({ type: 'html', content: html.slice(idx) });

// 处理：script 块整体替换 JS 内容（标签外不动）；html 块替换 SVG
let out = '';
parts.forEach(p => {
  if (p.type === 'html') {
    out += replaceZone(p.content, 'html');
  } else {
    // script 块：标签保留，内容按 JS 处理
    const tagEnd = p.content.indexOf('>') + 1;
    const tag = p.content.slice(0, tagEnd);
    const body = p.content.slice(tagEnd, p.content.length - '</script>'.length);
    out += tag + replaceZone(body, 'js') + '</script>';
  }
});

fs.writeFileSync(file, out, 'utf8');
console.log('批量替换完成');

// 验证剩余 emoji
const after = fs.readFileSync(file, 'utf8');
const lines = after.split('\n');
let remain = 0;
lines.forEach((l, i) => {
  const mm = l.match(EMO_RE);
  if (mm && mm.length) { remain += mm.length; console.log('剩余 ' + (i+1) + ': [' + mm.join('') + '] ' + l.trim().slice(0, 70)); }
});
console.log('剩余 emoji 数:', remain);
