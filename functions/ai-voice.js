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
  const scene = body.scene || 'goods';
  const storeCount = parseInt(body.storeCount, 10) || 0;
  const examples = Array.isArray(body.examples) ? body.examples : [];

  try {
    if (scene === 'emit-nums') {
      return await callAiEmitNums(text, storeCount, examples, json, API_KEY);
    }
    return await callAiVoice(text, goodsConfig, mode, json, API_KEY);
  } catch (e) {
    return json({ error: 'ai-voice error: ' + e.message }, 500);
  }
}

// 场景：发出页语音录入——用户说一串数字按店序填（中文数字词转阿拉伯）
async function callAiEmitNums(text, storeCount, examples, json, API_KEY) {
  let exampleText = '';
  if (examples.length > 0) {
    exampleText = '以下是用户之前确认正确的语音范例（用户说的话 → 正确数字序列）：\n' +
      examples.map((ex, i) => `${i + 1}. 用户说「${ex.text || ''}」→ [${(ex.nums || []).join(', ')}]`).join('\n') + '\n';
  }
  const prompt = [
    '你是物流筐收发管理系统的智能语音助手。',
    '用户说出一串数字，表示要按顺序填入多家店的数量。',
    '请把用户说的话转换成阿拉伯数字序列。',
    '规则：',
    '1. 中文数字词转阿拉伯数字：三=3、十二=12、二十三=23、三十=30',
    '2. 用户单个读的数字逐个转换：读"三八四五六七"→[3,8,4,5,6,7]',
    '3. 用户读复合数时整体转换：读"三 十二 五 十一 六 十二"→[3,12,5,11,6,12]',
    '4. 纠正语音转写同音/口语错误（"十二"绝不会拆成"1、2"）',
    '5. 忽略无关文字（"第一个店"里的"一"不是数字；"发出去"不算数字）',
    '6. 只输出一个 JSON 对象：{"nums":[数字序列]}，无法理解时输出 {"nums":[]}，不要输出任何其他文字',
    exampleText,
    '用户语音转写内容：' + text
  ].join('\n');

  const payload = JSON.stringify({
    model: 'HY-Vision-2.0-Instruct',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    top_p: 0.5,
    max_tokens: 200
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

  let t = String(content).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  let parsed = null;
  if (s >= 0 && e > s) { try { parsed = JSON.parse(t.slice(s, e + 1)); } catch (err) {} }
  if (!parsed || !Array.isArray(parsed.nums)) return json({ ok: true, nums: [] });
  const nums = parsed.nums
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n) && n >= 0 && n <= 999)
    .slice(0, storeCount || 999);
  return json({ ok: true, nums });
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
