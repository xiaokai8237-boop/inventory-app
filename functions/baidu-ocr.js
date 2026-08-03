// Cloudflare Pages Function — 百度 OCR 后端转发（密钥保存在云端环境变量，不暴露前端）
// POST /baidu-ocr  body: { imageBase64, endpoint }
//   endpoint: 'table' | 'accurate_basic' | 'handwriting'（百度 OCR 接口名）
// 返回百度原始 JSON（与直连百度返回结构一致）
// 环境变量（Pages 设置 → 环境变量）：
//   BAIDU_API_KEY    百度智能云 API Key
//   BAIDU_SECRET_KEY 百度智能云 Secret Key

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

  const BAIDU_API_KEY = env.BAIDU_API_KEY || '';
  const BAIDU_SECRET_KEY = env.BAIDU_SECRET_KEY || '';
  if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
    return json({ error: '百度OCR密钥未配置（请在 Cloudflare Pages 环境变量配置 BAIDU_API_KEY / BAIDU_SECRET_KEY）' }, 500);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const imageBase64 = body.imageBase64 || '';
  if (!imageBase64) return json({ error: 'missing imageBase64' }, 400);
  const endpoint = ['table', 'accurate_basic', 'handwriting'].includes(body.endpoint) ? body.endpoint : 'accurate_basic';

  try {
    // 1. 获取 access_token（KV 缓存 24 小时，避免每次请求都换 token）
    let token = '';
    try {
      if (env.BACKUP_KV) token = (await env.BACKUP_KV.get('baidu_access_token')) || '';
    } catch (e) {}
    if (!token) {
      const tokenResp = await fetch(
        'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' + BAIDU_API_KEY + '&client_secret=' + BAIDU_SECRET_KEY,
        { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const tokenData = await tokenResp.json();
      if (!tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || '获取token失败');
      token = tokenData.access_token;
      try {
        if (env.BACKUP_KV) await env.BACKUP_KV.put('baidu_access_token', token, { expirationTtl: 86400 });
      } catch (e) {}
    }

    // 2. 调用百度 OCR 对应接口
    let formBody = 'image=' + encodeURIComponent(imageBase64);
    if (endpoint === 'accurate_basic') formBody += '&language_type=CHN_ENG&detect_direction=true&paragraph=false&probability=false';
    else if (endpoint === 'handwriting') formBody += '&language_type=CHN_ENG';
    else formBody += '&language_type=CHN_ENG&result_type=json';

    const resp = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/' + endpoint + '?access_token=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: formBody
    });
    const data = await resp.json();
    return json(data);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
