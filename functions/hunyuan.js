// Cloudflare Pages Function — 腾讯混元视觉大模型 路单表格识别（TokenHub OpenAI 兼容通道）
// POST /hunyuan  body: { imageBase64 }  → 返回 { ok, text }  text 为模型输出的 JSON 字符串
// 说明：走 TokenHub（https://tokenhub.tencentmaas.com/v1），使用 OpenAI 兼容协议
// 环境变量（Pages 设置 → 环境变量）：
//   HUNYUAN_API_KEY  TokenHub API Key（sk- 开头，控制台 https://console.cloud.tencent.com/tokenhub/apikey 创建）
// 模型：HY-Vision-2.0-Instruct（TokenHub 多模态视觉模型，理解表格结构，可补漏行/正列）

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
  const goodsName = (body.goodsName || '').toString().trim();
  const examples = Array.isArray(body.examples) ? body.examples : [];

  try {
    return await callHunyuanVision(imageBase64, json, API_KEY, goodsName, examples);
  } catch (e) {
    return json({ error: 'hunyuan error: ' + e.message }, 500);
  }
}

async function callHunyuanVision(imageBase64, json, API_KEY, goodsName, examples) {
  // 按单据类型定制"取哪一列"：用户业务铁律——冷冻/常温=物流箱、冷藏=物流篮、面包=面包筐；本软件【完全不需要】整箱数量列
  goodsName = goodsName || '';
  examples = examples || [];
  let qtyColRule;
  if (goodsName.includes('冷藏') || goodsName.includes('低温')) {
    qtyColRule = 'qty 取表格中【明确标有"物流篮"表头的那一列】的数字。如果表格里没有"物流篮"这个列名，qty 写 0，并在 name 后加注释 "(未找到物流篮列)"。\n【绝对严禁】取【整箱数量】列！整箱数量是发货计数计费用，本软件完全不需要这个数字！取了会导致用户录入错误！';
  } else if (goodsName.includes('面包')) {
    qtyColRule = 'qty 取表格中【明确标有"面包筐"表头的那一列】的数字。如果表格里没有"面包筐"这个列名，qty 写 0，并在 name 后加注释 "(未找到面包筐列)"。\n【绝对严禁】取【整箱数量】列！整箱数量是发货计数计费用，本软件完全不需要这个数字！取了会导致用户录入错误！';
  } else if (goodsName.includes('冷冻') || goodsName.includes('常温')) {
    qtyColRule = 'qty 取表格中【明确标有"物流箱"表头的那一列】的数字。如果表格里没有"物流箱"这个列名，qty 写 0，并在 name 后加注释 "(未找到物流箱列)"。\n【绝对严禁】取【整箱数量】列！整箱数量是发货计数计费用，本软件完全不需要这个数字！取了会导致用户录入错误！';
  } else {
    qtyColRule = 'qty 根据表头判断的单据类型取对应列：冷冻/常温→【物流箱】列；冷藏→【物流篮】列；面包→【面包筐】列。\n【绝对严禁】取【整箱数量】列！整箱数量是发货计数计费用，本软件完全不需要！\n如果表格里找不到对应的筐/箱/篮列名，qty 写 0，并在 name 后加注释 "(未找到对应筐/箱/篮列)"。';
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
    '你是物流路单表格识别专家。请识别图片中的配送路单表格。',
    '表格每一行包含：路线编号（形如 HR42-1 / 42-1）、门店名称、多列数量。',
    '请提取每一行的【路线编号】【门店名称】【表格里每一列的列名和数字】，并判断单据类型。只输出一个 JSON 对象，不要输出任何其他文字，不要 markdown 代码块。',
    '格式：{"detectedType":"常温","rows":[{"code":"42-1","name":"门店名","cols":{"整箱数量":10,"物流箱":1,"纸箱":0,"笼车":0,"保温袋":0,"修正单张":1}}]}',
    exampleText,
    '【铁律】',
    '1. code 只取编号数字部分（如 42-1，去掉 HR/HN 等字母前缀，去掉前导0）',
    '2. 【必须把表格里每一列的列名和数字都识别出来】，放在 cols 对象里，列名做 key（保留图里的原始列名），数字做 value',
    '3. detectedType 根据表格【表头文字】精确判断单据类型：表头含"常温配送路单"→"常温"；含"冷冻配送路单"→"冷冻"；含"冷藏配送路单"→"冷藏"；含"面包配送路单"→"面包"；无法判断时输出""。绝不能混淆冷冻和常温，它们是两种单据',
    '4. 【严禁编造】只输出图中【肉眼可见的】数据行！图上有几行就输出几行，绝不能凭空补漏/续号/猜测多出来的行',
    '5. 如果编号有缺（如 42-1 后直接 42-3），照实输出 42-1 和 42-3，中间缺的不要补',
    '6. 不要包含"合计/总计"行',
    '7. 门店名称照抄表格，不要省略，不要猜测'
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
    temperature: 0.1,
    top_p: 0.5
  });

  const resp = await fetch('https://tokenhub.tencentmaas.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY
    },
    body: payload
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || data.error.message_zh || 'TokenHub 错误');
  const choices = data.choices || [];
  const text = (choices[0] && choices[0].message && choices[0].message.content) || '';
  if (!text) throw new Error('混元未返回内容');
  return json({ ok: true, text });
}
