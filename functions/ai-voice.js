// Cloudflare Pages Function — AI 语音理解（腾讯混元视觉模型纯文本通道，TokenHub）
// POST /ai-voice  body: { text, goodsConfig, mode } → { ok, items: [{goodsIdx, qty}] }
// 用途：
//   1) 语音录入：把 ASR 转写文本（含中文数字/同音字/口语）理解成结构化「筐名+数量」
//   2) 未来智能语音助手：同一接口可扩展意图理解（如"查一下今天发出多少"）
// 说明：复用 HUNYUAN_API_KEY（TokenHub），模型 HY-Vision-2.0-Instruct 支持纯文本输入，
//       单次约 100-200 tokens（≈0.001元），价格可忽略。

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
  if (!API_KEY) return json({ error: 'TokenHub API Key 未配置' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400); }
  const text = (body.text || '').trim();
  if (!text) return json({ error: 'missing text' }, 400);
  const goodsConfig = Array.isArray(body.goodsConfig) ? body.goodsConfig : [];
  const mode = body.mode === 'out' ? 'out' : 'in';

  try {
    return await callAiVoice(text, goodsConfig, mode, json, API_KEY);
  } catch (e) {
    return json({ error: 'ai-voice error: ' + e.message }, 500);
  }
}

async function callAiVoice(text, goodsConfig, mode, json, API_KEY) {
  const modeLabel = mode === 'out' ? '回收' : '发出';
  // 构建筐名+别名列表（动态传入，与用户实际配置一致）
  const goodsList = goodsConfig.map((g, idx) => {
    const aliases = [g.name, ...(g.aliases || [])].filter(Boolean).join('，');
    return idx + '=' + g.name + '(别名:' + aliases + ')';
  }).join('；') || '0=鲜食筐,1=面包筐,2=低温筐,3=冷冻筐,4=常温筐';

  const prompt = [
    '你是物流筐收发管理系统的智能语音助手。',
    '用户刚说了语音，已经转成文字。请理解这段话，提取「筐种类+数量」。',
    '筐种类列表（编号=筐名(别名)）：' + goodsList,
    '当前操作：' + modeLabel,
    '要求：',
    '1. 支持中文数字（五=5、一十二=12）、阿拉伯数字、口语表达（"鲜食来五个""面包三个""低温筐6个"）',
    '2. 能纠正语音转写的常见同音错误（如"鲜食"被写成"鲜食/鲜时/现食"都要理解为鲜食筐；"低温"写成"低温/低问"）',
    '3. 一句话可能包含多种筐（"鲜食五，面包三"→鲜食5+面包3），都要提取',
    '4. 只输出一个 JSON 对象，格式：{"items":[{"goodsIdx":筐编号,"qty":数量}]}',
    '5. 无法理解时输出 {"items":[]}，不要解释',
    '用户语音转写内容：' + text
  ].join('\n');

  const payload = JSON.stringify({
    model: 'HY-Vision-2.0-Instruct',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    top_p: 0.5,
    max_tokens: 300
  });

  const resp = await fetch('https://tokenhub.tencentmaas.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: payload
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || data.error.message_zh || 'TokenHub 错误');
  const choices = data.choices || [];
  const content = (choices[0] && choices[0].message && choices[0].message.content) || '';
  if (!content) throw new Error('AI 未返回内容');

  // 解析 JSON（去 markdown 包裹/噪音）
  let t = String(content).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  let parsed = null;
  if (s >= 0 && e > s) { try { parsed = JSON.parse(t.slice(s, e + 1)); } catch (err) {} }
  if (!parsed || !Array.isArray(parsed.items)) return json({ ok: true, items: [] });

  // 校验/规整
  const items = parsed.items
    .filter(it => it && typeof it.goodsIdx === 'number' && it.goodsIdx >= 0 && it.goodsIdx < 10)
    .map(it => ({ goodsIdx: it.goodsIdx, qty: Math.max(0, parseInt(it.qty, 10) || 0) }))
    .filter(it => it.qty > 0);
  return json({ ok: true, items });
}
