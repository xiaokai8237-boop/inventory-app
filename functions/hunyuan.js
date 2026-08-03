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

  try {
    return await callHunyuanVision(imageBase64, json, API_KEY);
  } catch (e) {
    return json({ error: 'hunyuan error: ' + e.message }, 500);
  }
}

async function callHunyuanVision(imageBase64, json, API_KEY) {
  const prompt = [
    '你是物流路单表格识别专家。请识别图片中的配送路单表格。',
    '表格每一行包含：路线编号（形如 HR42-1 / 42-1）、门店名称、各数量列。',
    '请提取每一行的【路线编号】【门店名称】【物流筐数量】，只输出一个 JSON 数组，不要输出任何其他文字，不要 markdown 代码块。',
    '格式：[{"code":"42-1","name":"门店名","qty":2}]',
    '要求：',
    '1. code 只取编号数字部分（如 42-1，去掉 HR/HN 等字母前缀，去掉前导0）',
    '2. qty 取"物流筐"列的数量；若单据没有"物流筐"列，则取数量列中与筐/箱/篮/袋相关的第一列',
    '3. 必须包含表格中所有数据行；编号必须连续，若中间缺号（如 42-1 后直接 42-3）说明漏了 42-2，也要补上，qty 用 0',
    '4. 不要包含"合计/总计"行',
    '5. 门店名称照抄表格，不要省略'
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
