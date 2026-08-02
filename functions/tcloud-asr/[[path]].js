// Cloudflare Pages Function — 腾讯云语音识别（一句话识别）
// POST /tcloud-asr  { audioBase64, mime } → 返回识别文本

// 密钥从 Cloudflare Pages 环境变量读取（TENCENT_SECRET_ID / TENCENT_SECRET_KEY）


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
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const sid = env.TENCENT_SECRET_ID || '';
  const skey = env.TENCENT_SECRET_KEY || '';
  if (!sid || !skey) return json({ error: '语音识别密钥未配置' }, 500);
  let body;
  try { body = await request.json(); } catch(e) { return json({ error: 'invalid json' }, 400); }
  const audioBase64 = body.audioBase64 || '';
  const mime = body.mime || '';
  const dataLen = body.len || 0;
  if (!audioBase64) return json({ error: 'missing audio' }, 400);

  // VoiceFormat 映射
  let voiceFormat = 'm4a';
  if (mime.includes('webm')) voiceFormat = 'ogg';
  else if (mime.includes('ogg')) voiceFormat = 'ogg';
  else if (mime.includes('mp3')) voiceFormat = 'mp3';
  else if (mime.includes('wav')) voiceFormat = 'wav';

  const service = 'asr';
  const host = 'asr.tencentcloudapi.com';
  const action = 'SentenceRecognition';
  const version = '2019-06-14';
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: voiceFormat,
    Data: audioBase64,
    DataLen: dataLen || Math.floor(audioBase64.length * 0.75)
  });

  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');
  const credentialScope = date + '/asr/tc3_request';
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const secretDate = await hmacSha256(new TextEncoder().encode('TC3' + skey), date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);
  const authorization = ['TC3-HMAC-SHA256 Credential=' + sid + '/' + credentialScope, 'SignedHeaders=' + signedHeaders, 'Signature=' + signature].join(', ');

  const resp = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(ts),
      'X-TC-Region': 'ap-guangzhou',
    },
    body: payload
  });
  const data = await resp.json();
  const resp2 = data.Response || {};
  if (resp2.Error) throw new Error(resp2.Error.Message || '语音识别错误');
  return json({ ok: true, text: resp2.Result || '' });
}
