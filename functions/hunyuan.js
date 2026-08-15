// Cloudflare Pages Function — 腾讯混元视觉大模型 路单表格识别（TokenHub OpenAI 兼容通道）
// POST /hunyuan  body: { imageBase64, goodsName, examples }  → 返回 { ok, text }  text 为模型输出的 JSON 字符串
// 说明：走 TokenHub（https://tokenhub.tencentmaas.com/v1），使用 OpenAI 兼容协议
// 环境变量（Pages 设置 → 环境变量）：
//   HUNYUAN_API_KEY  TokenHub API Key（sk- 开头，控制台 https://console.cloud.tencent.com/tokenhub/apikey 创建）
// 模型：HY-Vision-2.0-Instruct（TokenHub 多模态视觉模型，理解表格结构，可补漏行/正列）
// 提示词版本：v2 豆包优化版（2026-08-07）——三步分析法+七大铁律+自检清单
// 业务变更：常温单据 = 整箱数量 + 物流箱 两列；冷冻/冷藏/面包维持原规则（严禁取整箱数量）
// 优化 v3（2026-08-07）：保守参数(temp 0.01/top_p 0.1)、JSON格式兜底、解析校验+失败重试、
//   服务端结果校验、图片大小校验(2MB)、日志耗时统计、网络重试1次、提示词鲁棒性描述

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
const VALID_TYPES = ['常温', '冷冻', '冷藏', '面包', ''];

async function callHunyuanOnce(API_KEY, payload) {
  const resp = await fetch('https://tokenhub.tencentmaas.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY
    },
    body: payload
  });
  const data = await resp.json();
  if (data.error) {
    const msg = data.error.message || data.error.message_zh || 'TokenHub 错误';
    const e = new Error(msg);
    e.isApiError = true;
    throw e;
  }
  const choices = data.choices || [];
  const text = (choices[0] && choices[0].message && choices[0].message.content) || '';
  if (!text) {
    const e = new Error('混元未返回内容');
    e.isApiError = true;
    throw e;
  }
  return text;
}

// 兜底1：去掉 markdown 代码块标记（兼容 ```json 与裸 ``` 两种开头）
function stripMarkdownFence(text) {
  return String(text)
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
}
// 兜底2：提取第一个完整的 JSON 对象（防止模型输出前后有多余文字）
function extractFirstJsonObject(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  return m ? m[0] : String(text);
}
// 服务端结果校验：基本格式检查（不符合抛错）
function validateOcrResult(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('AI 输出不是 JSON 对象');
  if (!VALID_TYPES.includes(obj.detectedType)) throw new Error('detectedType 非法: ' + obj.detectedType);
  if (!Array.isArray(obj.rows)) throw new Error('rows 不是数组');
  for (const r of obj.rows) {
    if (!r || typeof r !== 'object') throw new Error('行数据不是对象');
    if (typeof r.code !== 'string' || r.code.trim() === '') throw new Error('行缺少 code');
    if (typeof r.name !== 'string' || r.name.trim() === '') throw new Error('行缺少 name: ' + r.code);
    if (!r.cols || typeof r.cols !== 'object' || Array.isArray(r.cols)) throw new Error('行缺少 cols: ' + r.code);
    for (const [k, v] of Object.entries(r.cols)) {
      if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error('列数量非法: ' + r.code + '[' + k + ']=' + v);
    }
  }
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;
  const API_KEY = env.HUNYUAN_API_KEY || '';
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!API_KEY) return json({ error: 'TokenHub API Key 未配置（请在 Cloudflare Pages 环境变量配置 HUNYUAN_API_KEY）' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const imageBase64 = body.imageBase64 || '';
  if (!imageBase64) return json({ error: 'missing imageBase64' }, 400);
  // 图片大小校验：超过 2MB 返回错误，提示前端压缩后再传（防大图浪费 token）
  const imageBytes = Math.ceil(imageBase64.length * 3 / 4); // base64 → 字节数估算
  if (imageBytes > MAX_IMAGE_BYTES) {
    return json({ error: '图片过大(' + Math.round(imageBytes / 1024) + 'KB)，请压缩后再试（上限2MB）' }, 413);
  }
  const goodsName = (body.goodsName || '').toString().trim();
  const examples = Array.isArray(body.examples) ? body.examples : [];

  try {
    return await callHunyuanVision(imageBase64, json, API_KEY, goodsName, examples);
  } catch (e) {
    return json({ error: 'hunyuan error: ' + e.message }, 500);
  }
}

async function callHunyuanVision(imageBase64, json, API_KEY, goodsName, examples) {
  // 按单据类型定制"取哪一列"（2026-08-07 v2 豆包优化版）：
  //   常温 = 整箱数量 + 物流箱（两列都要）
  //   冷冻 = 物流箱 / 冷藏 = 物流篮 / 面包 = 面包筐（严禁取整箱数量）
  goodsName = goodsName || '';
  examples = examples || [];
  // #279 取列规则注明的类型仅"参考"，detectedType 必须按表格表头+列结构判断，防止 goodsName 干扰 AI 判型
  let qtyColRule;
  if (goodsName.includes('冷藏') || goodsName.includes('低温')) {
    qtyColRule = '【你正在录入的筐类型：冷藏】（仅供参考，表格实际是什么类型以表头和列结构为准）\nqty 取「物流篮」列的数字\n【绝对严禁】取「整箱数量」列！整箱数量是发货计数用的，本软件不需要！取了会导致用户录入错误！\n如果没有"物流篮"列，qty=0，name后加"(未找到物流篮列)"';
  } else if (goodsName.includes('面包')) {
    qtyColRule = '【你正在录入的筐类型：面包】（仅供参考，表格实际是什么类型以表头和列结构为准）\nqty 取「面包筐」列的数字\n【绝对严禁】取「整箱数量」列！整箱数量是发货计数用的，本软件不需要！取了会导致用户录入错误！\n如果没有"面包筐"列，qty=0，name后加"(未找到面包筐列)"';
  } else if (goodsName.includes('冷冻')) {
    qtyColRule = '【你正在录入的筐类型：冷冻】（仅供参考，表格实际是什么类型以表头和列结构为准）\nqty 取「物流箱」列的数字\n【绝对严禁】取「整箱数量」列！整箱数量是发货计数用的，本软件不需要！取了会导致用户录入错误！\n如果没有"物流箱"列，qty=0，name后加"(未找到物流箱列)"';
  } else if (goodsName.includes('常温')) {
    qtyColRule = '【你正在录入的筐类型：常温】（仅供参考，表格实际是什么类型以表头和列结构为准）\nqty 取「整箱数量」列的数字\nqty2 取「物流箱」列的数字\n两列都要，是两种不同的数据，数值相同也要分别输出\n如果没有"整箱数量"列，qty=0，name后加"(未找到整箱数量列)"\n如果没有"物流箱"列，qty2=0，name后加"(未找到物流箱列)"';
  } else {
    qtyColRule = '【你正在录入的筐类型：未知】（仅供参考，表格实际是什么类型以表头和列结构为准）\n根据表头判断单据类型后取对应列：常温→整箱数量+物流箱两列；冷冻→物流箱；冷藏→物流篮；面包→面包筐\n【绝对严禁】整箱数量列仅限常温单据使用，冷冻/冷藏/面包严禁取！\n如果找不到对应列，填 0，name 后加注释说明缺哪一列';
  }
  // 成功范例拼接（同类型单据的历史正确案例，教 AI 这种表的列结构/目标列/数据对应）
  let exampleText = '';
  if (examples.length > 0) {
    exampleText = '【同类型单据成功范例】（以下是你之前识别正确的同类型单据，列名结构和取列方式照这些来）：\n' +
      examples.map((ex, ei) => {
        const colLine = Array.isArray(ex.cols) ? ex.cols.join('|') : '';
        const rowLine = (ex.rows || []).map(r => (r.code || '') + ' ' + (r.name || '') + '=' + (r.qty || 0)).join('；');
        return '范例' + (ei + 1) + '：表头"' + (ex.header || '') + '"，列序：' + colLine + '；本单应取"' + (ex.targetCol || '') + '"列\n数据：' + rowLine;
      }).join('\n') + '\n';
  }
  const prompt = [
    '注意：图片可能存在倾斜、模糊、反光、裁切不全等情况，请尽力辨认；实在看不清的数字填0并标注"(存疑)"，不要瞎猜。',
    '你是物流路单表格识别专家，职责是：从配送路单照片中精准提取表格数据，输出结构化JSON。',
    '识别结果直接用于库存录入，任何错误数字都会造成真实业务损失，必须零容忍。',
    '',
    '═══════════════════════════════════════',
    '        第一步：先分析，再输出',
    '═══════════════════════════════════════',
    '',
    '在输出任何内容之前，请先在内部完成以下分析（不要输出分析过程）：',
    '',
    '1. 【数行数】图片里实际有多少行数据？（不含表头、不含合计/总计行）',
    '   → 数清楚，有几行输出几行，绝对不能多不能少',
    '',
    '2. 【认列名】表头有哪些列？每一列的完整原始名称是什么？',
    '   → 一个字都不能漏，包括括号、后缀',
    '   → 特别注意：有没有"物流箱(修正)"这样带括号的列？',
    '',
    '3. 【判类型】这是什么单据？（先看表头文字，再用列结构双重验证，绝不能只看一个信号）',
    '   → 表头含"常温配送路单" → 常温',
    '   → 表头含"冷冻配送路单" → 冷冻',
    '   → 表头含"冷藏配送路单" → 冷藏',
    '   → 表头含"面包配送路单" → 面包',
    '   → 无法判断 → 空字符串',
    '   【列结构双重验证】（判断后必须对照一遍，防止看错表头）：',
    '   → 常温单据：表格里一定有「整箱数量」列',
    '   → 冷冻/冷藏/面包单据：没有「整箱数量」列',
    '   → 如果表头像"冷冻"但表格里出现了"整箱数量"列 → 极可能把表头"常温"看成了"冷冻"，改判常温',
    '   → 如果表头像"常温"但表格里完全没有"整箱数量"列 → 极可能把表头"冷冻"看成了"常温"，改判冷冻',
    '   → 输出 detectedType 前，必须让"表头判断"和"列结构判断"互相印证一致',
    '',
    '4. 【定取列】根据单据类型，确认哪些列是需要的：',
    '   → 常温：整箱数量 + 物流箱（两列都要）',
    '   → 冷冻：物流箱（不要整箱数量）',
    '   → 冷藏：物流篮（不要整箱数量）',
    '   → 面包：面包筐（不要整箱数量）',
    '',
    '5. 【理编号】每一行的路线编号去掉字母前缀和前导零后是什么？',
    '   → 例子：HN43-01 → 43-1，HR05-02 → 5-2，HN40-1 → 40-1',
    '   ⚠️ 数字必须一个不少完整保留：43-01 绝不能写成 3-1！某位数字看不清时，宁可按原样输出（连字母一起）也不要丢数字',
    '',
    '═══════════════════════════════════════',
    '        第二步：输出前自检（必须过）',
    '═══════════════════════════════════════',
    '',
    '输出JSON之前，逐条核对：',
    '',
    '✅ 行数对不对？图上有几行就输出几行',
    '✅ 列名对不对？照抄原文，一个字没改？',
    '✅ 有没有重复列名？两列不同名就必须各用各的全名',
    '✅ 取列对不对？常温要整箱+物流箱，其他不要整箱',
    '✅ 编号对不对？去了字母前缀和前导零，且一个数字都没少（43-01绝不能变成3-1）',
    '✅ 有没有编造？所有数据都是图上肉眼可见的',
    '✅ 有没有合计行？合计/总计行绝对没输出',
    '✅ 店名对不对？照抄了，没省略没猜测',
    '',
    '═══════════════════════════════════════',
    '        第三步：输出格式',
    '═══════════════════════════════════════',
    '',
    '只输出一个JSON对象，绝对不要输出任何其他文字。',
    '不要解释，不要说明，不要注释，不要markdown代码块。',
    '',
    '格式：',
    '{"detectedType":"常温","rows":[{"code":"42-1","name":"门店名称","cols":{"列名1":数字,"列名2":数字}}]}',
    '',
    '═══════════════════════════════════════',
    '        七大铁律（违反任何一条=严重错误）',
    '═══════════════════════════════════════',
    '',
    '🔴 铁律一：列名必须照抄原文，一个字都不能改',
    '   图里叫"物流箱(修正)"就必须输出"物流箱(修正)"，绝不能简化成"物流箱"',
    '   图里叫"物流箱"就输出"物流箱"',
    '   图里叫"整箱数量"就输出"整箱数量"',
    '   两列名字不一样，就必须用各自完整名字，绝对不能输出两个相同列名！',
    '   识别不出的列，数字填0，但列名必须保留',
    '   ⚠️ 血的教训：曾经因为把"物流箱(修正)"简化成"物流箱"，导致JSON重复键覆盖，所有店数量全变0',
    '',
    '🔴 铁律二：整箱数量列的取数规则',
    '   ✅ 常温单据：必须保留"整箱数量"列，正常识别填入',
    '   ❌ 冷冻/冷藏/面包单据：绝对不要"整箱数量"列',
    '   ⚠️ 血的教训：冷冻单取了整箱数量会导致用户录入错误',
    '',
    '🔴 铁律三：绝对不能编造数据！',
    '   图上有几行就输出几行，绝不能凭空补行、续号、猜测',
    '   如果编号缺号（如42-1后直接42-3），照实输出，中间缺的不要补',
    '   门店名称照抄，不要省略，不要猜测',
    '   合计/总计行绝对不能输出',
    '   ⚠️ 血的教训：曾经AI凭空编造出141家店，图中只有10几家',
    '',
    '🔴 铁律四：编号只取数字部分，但数字必须完整保留',
    '   去掉HN/HR等字母前缀',
    '   去掉前导0（如01变成1，05变成5）',
    '   例子：HN43-01 → 43-1，HR05-02 → 5-2',
    '   ⚠️ 数字一个都不能少：43-01 绝不能输出 3-1！某位看不清时，宁可按原样输出（连字母一起）也不要丢数字',
    '',
    '🔴 铁律五：detectedType必须表头+列结构双重验证',
    '   只能是：常温 / 冷冻 / 冷藏 / 面包 / ""（无法判断）',
    '   冷冻和常温是两种完全不同的单据，绝对不能搞混！',
    '   常温单据必有「整箱数量」列；冷冻/冷藏/面包没有「整箱数量」列',
    '   表头判断与列结构判断必须一致；不一致时以列结构为准重新看表头',
    '   ⚠️ 血的教训：冷冻单被当成常温单处理，导致用户操作中断',
    '',
    '🔴 铁律六：店名与数量必须对应',
    '   每一行的店名和它后面的数量必须是同一行的',
    '   绝对不能跨行错位',
    '   看不清就填0并加注释"(数量存疑)"，不要瞎猜',
    '',
    '🔴 铁律七：只输出JSON，其他什么都不要',
    '   不要解释，不要说明，不要注释',
    '   不要markdown代码块',
    '   不要任何多余文字',
    '',
    '═══════════════════════════════════════',
    '        同类型单据成功范例',
    '═══════════════════════════════════════',
    '',
    exampleText,
    '',
    '═══════════════════════════════════════',
    '        不确定时的处理原则',
    '═══════════════════════════════════════',
    '',
    '- 看不清的数字 → 填0，在name后加注释"(数量存疑)"',
    '- 找不到目标列 → 填0，在name后加注释"(未找到XX列)"',
    '- 无法判断单据类型 → detectedType输出""',
    '- 宁可填0加注释，也绝不能猜错数字',
    '',
    '现在开始识别。',
    qtyColRule
  ].join('\n');

  const payload = JSON.stringify({
    model: 'HY-Vision-2.0-Instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } }
      ]
    }],
    temperature: 0.01,
    top_p: 0.1
  });

  const startTs = Date.now();
  // 第7项：网络失败/模型报错 自动重试1次（间隔500ms），第二次还失败才报错
  let lastErr = null;
  let text = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      text = await callHunyuanOnce(API_KEY, payload);
      break;
    } catch (e) {
      lastErr = e;
      if (attempt === 1 && e.isApiError) await sleep(500); // 仅 API 错误重试，参数/鉴权类不重试
    }
  }
  if (!text) throw lastErr || new Error('混元识别失败');

  // 服务端兜底：AI 常把"物流箱(修正)"列简化成"物流箱"导致 JSON 内重复键（后键覆盖前键丢真值）。
  // 对每个 cols 块内重复出现的列名，从第二次起加"(修正N)"后缀，保住第一次的真实值（图里真实物流箱列在前）。
  text = text.replace(/"cols"\s*:\s*\{([^{}]*)\}/g, (whole, inner) => {
    const seen = {};
    const fixed = inner.replace(/"([^"]+)":/g, (m, k) => {
      const n = (seen[k] || 0) + 1;
      seen[k] = n;
      return n > 1 ? '"' + k + '(修正' + (n - 1) + ')":' : m;
    });
    return whole.replace(inner, fixed);
  });
  // 第2项：JSON 格式兜底——去 markdown 代码块标记、提取第一个完整 JSON 对象
  text = stripMarkdownFence(text);
  text = extractFirstJsonObject(text);

  // 第3项：JSON 解析校验——解析成功才返回；失败自动重试一次识别；再失败返回错误
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  if (!parsed) {
    // 重试一次识别（全新调用）
    try {
      text = await callHunyuanOnce(API_KEY, payload);
      text = stripMarkdownFence(extractFirstJsonObject(text));
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    } catch (e) { /* 重试失败，走下面报错 */ }
  }
  if (!parsed) {
    const err = new Error('识别结果无法解析为JSON，请重拍或重试');
    err.isParseError = true;
    throw err;
  }
  // 第4项：服务端结果校验（detectedType/rows/每行code/name/cols/数量非负）
  try { validateOcrResult(parsed); } catch (e) {
    const err = new Error('识别结果格式校验失败: ' + e.message);
    err.isValidationError = true;
    throw err;
  }

  // 第6项：日志与耗时统计
  const elapsed = Date.now() - startTs;
  console.log('[hunyuan] 识别完成: 类型=' + (parsed.detectedType || '未知') + ', 行数=' + (Array.isArray(parsed.rows) ? parsed.rows.length : 0) + ', 耗时=' + elapsed + 'ms');
  return json({ ok: true, text, _elapsedMs: elapsed, _parsed: true });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
