// Cloudflare Pages Function — 腾讯云 OCR 转发（密钥保存在云端，不暴露前端）
// POST /tcloud  body: { imageBase64 }   → 返回通用印刷体识别结果

// 密钥从 Cloudflare Pages 环境变量读取（不写进代码，防泄露）
// 在 Pages 设置 → 环境变量里配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY

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
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return new Response(JSON.stringify({ error: '腾讯云密钥未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body;
  try { body = await request.json(); } catch(e) { return json({ error: 'invalid json' }, 400); }
  const imageBase64 = body.imageBase64 || '';
  if (!imageBase64) return json({ error: 'missing imageBase64' }, 400);
  try {
    return await callTencentOCR(imageBase64, json, TENCENT_SECRET_ID, TENCENT_SECRET_KEY);
  } catch(e) {
    return json({ error: 'tcloud error: ' + e.message }, 500);
  }
}

async function callTencentOCR(imageBase64, json, TENCENT_SECRET_ID, TENCENT_SECRET_KEY) {
  const service = 'ocr';
  const host = 'ocr.tencentcloudapi.com';
  const region = 'ap-guangzhou';
  const action = 'GeneralBasicOCR';
  const version = '2018-11-19';
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD（腾讯云签名要求带连字符）

  const ts = Math.floor(Date.now() / 1000);
  const isoTime = new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); // 无毫秒
  const payload = JSON.stringify({ ImageBase64: imageBase64, LanguageType: 'zh', IsPdf: false });

  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');

  const credentialScope = date + '/ocr/tc3_request';
  const stringToSign = [algorithm, isoTime, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

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
  if (resp2.Error) throw new Error(resp2.Error.Message || '腾讯OCR错误');
  const words = (resp2.TextDetections || []).map(x => x.DetectedText);
  return json({ ok: true, words });
}
