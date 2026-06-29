// ============================================================
// 冯总减脂 · diet-ai Edge Function（v2 · 多模型组合，更快更稳）
// 语音 stepaudio-2.5-asr → 文字；文字/语音用 step-2-16k 出结构化；
// 拍照用 step-1o-vision-32k 描述食物 → 再交 step-2-16k 按松松营养率换算。
// 部署：Supabase Edge Functions → diet-ai → 粘贴本文件 → 关闭 Verify JWT → Deploy
// 密钥：Edge Functions → Secrets 加 STEPFUN_API_KEY
// ============================================================
const KEY = Deno.env.get("STEPFUN_API_KEY") ?? "";
const BASE = "https://api.stepfun.com/v1";
const M_ASR = "stepaudio-2.5-asr";
const M_TEXT = "step-2-16k";          // 文字→结构化（快·稳）
const M_VISION = "step-1o-vision-32k"; // 识图→描述

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYS = `你是减脂饮食助手，按「好人松松」营养率把食物换算成碳水、蛋白质克数（脂肪不计）。
碳水率(每100g)：米饭30 软饭25 粥12 馒头面包50 熟面25 红薯土豆18 玉米20 燕麦干60；水果算碳水：香蕉22 苹果13 橙11 葡萄12 西瓜7 芒果13 梨13。
蛋白率(每100g)：熟瘦肉(鸡牛鱼虾)25 生瘦肉20 瘦肉干40 豆腐7；鸡蛋6/个 牛奶10/盒 酸奶10/盒 蛋白粉23/勺。
只算瘦肉(去皮去肥；鸡皮排骨肥牛炸物protein记0)；水果算碳水；糖油混合物(炸物蛋糕奶茶)只计碳水。模糊量按常见估(一碗饭200g 外卖饭250g 一块肉150g 一根香蕉120g)。
把用户提到的每样食物都列出。只输出JSON：
{"items":[{"name":"食物","amount":数字,"unit":"g或个或盒或勺","carb":数字,"protein":数字}],"note":"一句估算说明","warn":"不利减脂的提醒，没有就空字符串"}`;

const VISION_PROMPT = "用中文列出这张照片里你看到的所有食物，以及每样的大致分量（用 克/碗/份/个/根 描述）。只描述食物和分量，不要换算、不要多余的话。例如：米饭约一碗250g、红烧鸡腿1个、清炒青菜一份。";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function chat(model: string, messages: unknown[], jsonMode = false): Promise<string> {
  const payload: Record<string, unknown> = { model, temperature: 0.1, max_tokens: 1500, messages };
  if (jsonMode) payload.response_format = { type: "json_object" };
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}
// 容错：无论模型返回 {items:[]} / 单个对象 / 裸数组，都能抽出食物列表
function extractItems(parsed: any): any[] {
  if (!parsed) return [];
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed)) return parsed;
  if (parsed.name && (parsed.carb != null || parsed.protein != null)) return [parsed];
  for (const k of Object.keys(parsed)) {
    const v = parsed[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!KEY) return json({ error: "未配置 STEPFUN_API_KEY 密钥" }, 500);

  try {
    const body = await req.json();
    let userText: string = body.text ?? "";
    let transcript = "";

    // 1) 语音 → 文字
    if (body.kind === "audio" && body.audio) {
      const fd = new FormData();
      fd.append("model", M_ASR);
      fd.append("file", new Blob([b64ToBytes(body.audio)], { type: body.mime || "audio/wav" }), "a.wav");
      const ar = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: fd });
      const aj = await ar.json();
      transcript = aj.text ?? "";
      if (!transcript) return json({ items: [], note: "没听清，请再说一遍", transcript: "", warn: "" });
      userText = transcript;
    }

    // 2) 图片 → 先让视觉模型描述食物
    if (body.kind === "image" && body.image) {
      const desc = await chat(M_VISION, [{ role: "user", content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: body.image } },
      ] }]);
      userText = `${desc}${body.meal ? "（这是" + body.meal + "）" : ""}`;
    } else {
      userText = `${userText}${body.meal ? "（这是" + body.meal + "）" : ""}`;
    }

    // 3) step-2-16k 按松松营养率出结构化
    const raw = await chat(M_TEXT, [{ role: "system", content: SYS }, { role: "user", content: userText }], true);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const items = extractItems(parsed).map((x: any) => ({
      name: String(x.name || x.食物 || "食物"),
      amount: Math.round((+x.amount || +x.数量 || 0) * 10) / 10,
      unit: x.unit || x.单位 || "g",
      carb: Math.round((+x.carb || +x.碳水 || 0) * 10) / 10,
      protein: Math.round((+x.protein || +x.蛋白 || +x.蛋白质 || 0) * 10) / 10,
    })).filter((x: any) => x.carb > 0 || x.protein > 0);

    return json({ items, note: parsed.note || "", warn: parsed.warn || "", transcript });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
