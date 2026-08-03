// Cloudflare Pages Function — 腾讯混元视觉大模型 路单表格识别（密钥复用 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）
// POST /hunyuan  body: { imageBase64 }  → 返回 { ok, text }  text 为模型输出的 JSON 字符串
// 说明：与 functions/tcloud 同一套腾讯云密钥（TC3-HMAC-SHA256 签名），无需新增环境变量
// 模型：hunyuan-vision（多模态视觉大模型，理解表格结构，可补漏行/正列）

async function sha256Hex(msg) {
  const data = new TextEncoder().encode(msg);
  const d = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacSha256(keyBytes, msg) {
  const data = new TextEncoder().encode(msg);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}
async function hmacSha256Hex(keyBytes, msg) {
  return Array.from(await hmacSha256(keyBytes, msg)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  const TENCENT_SECRET_ID = env.TENCENT_SECRET_ID || '';
  const TENCENT_SECRET_KEY = env.TENCENT_SECRET_KEY || '';
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return json({ error: '腾讯云密钥未配置（TENCENT_SECRET_ID / TENCENT_SECRET_KEY）' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const imageBase64 = body.imageBase64 || '';
  if (!imageBase64) return json({ error: 'missing imageBase64' }, 400);

  try {
    return await callHunyuanVision(imageBase64, json, TENCENT_SECRET_ID, TENCENT_SECRET_KEY);
  } catch (e) {
    return json({ error: 'hunyuan error: ' + e.message }, 500);
  }
}

async function callHunyuanVision(imageBase64, json, TENCENT_SECRET_ID, TENCENT_SECRET_KEY) {
  const service = 'hunyuan';
  const host = 'hunyuan.tencentcloudapi.com';
  const region = 'ap-guangzhou';
  const action = 'ChatCompletions';
  const version = '2023-09-01';
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date().toISOString().slice(0, 10);

  const ts = Math.floor(Date.now() / 1000);
  const isoTime = new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

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
    Model: 'hunyuan-vision',
    Messages: [{
      Role: 'user',
      Contents: [
        { Type: 'text', Text: prompt },
        { Type: 'image_url', ImageUrl: { Url: 'data:image/jpeg;base64,' + imageBase64 } }
      ]
    }],
    Stream: false,
    Temperature: 0.1,
    TopP: 0.5
  });

  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');

  const credentialScope = date + '/' + service + '/tc3_request';
  const stringToSign = [algorithm, String(ts), credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const secretDate = await hmacSha256(new TextEncoder().encode('TC3' + TENCENT_SECRET_KEY), date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  const authorization = [algorithm + ' Credential=' + TENCENT_SECRET_ID + '/' + credentialScope, 'SignedHeaders=' + signedHeaders, 'Signature=' + signature].join(', ');

  const resp = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(ts),
      'X-TC-Region': region,
    },
    body: payload
  });
  const data = await resp.json();
  const resp2 = data.Response || {};
  if (resp2.Error) throw new Error(resp2.Error.Message || '混元错误');
  const choices = resp2.Choices || [];
  const text = (choices[0] && choices[0].Message && choices[0].Message.Content) || '';
  if (!text) throw new Error('混元未返回内容');
  return json({ ok: true, text });
}
