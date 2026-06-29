// ============================================================
// 冯总减脂 · diet-ai Edge Function
// 作用：藏住 StepFun key，把冯总的「语音/图片/文字」按松松营养率
//      解析成结构化食物 {name,amount,unit,carb,protein}
// 部署：Supabase 控制台 Edge Functions → 新建 diet-ai → 粘贴本文件 → 关闭 Verify JWT → Deploy
// 密钥：Edge Functions → Secrets 添加 STEPFUN_API_KEY = 你的 StepFun key
// ============================================================
const STEPFUN_KEY = Deno.env.get("STEPFUN_API_KEY") ?? "";
const BASE = "https://api.stepfun.com/v1";
const CHAT_MODEL = "step-3.7-flash";
const ASR_MODEL = "stepaudio-2.5-asr";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYS = `你是减脂饮食助手，依据「好人松松」营养率体系，把用户描述或照片里的食物换算成碳水和蛋白质克数（脂肪按松松体系不计）。

【碳水率·每100g】生米75% | 米饭(软25/一般30/偏硬35)% | 白粥10-13% | 馒头花卷面包50% | 熟面(细23/粗30)% | 米线33% | 红薯/土豆(蒸煮18/烤23)% | 甜玉米20% 糯玉米35% | 山药12% | 贝贝南瓜21% | 燕麦/黑麦片(干)60% | 八宝粥约47g/罐 | 旺仔小馒头约37g/袋
【水果碳水率·算进碳水】香蕉22 苹果13 橙11 葡萄提子12 猕猴桃15 芒果13 梨13 火龙果13 桃10 西瓜7 圣女果6 榴莲28 (单位%)
【蛋白率】生瘦鱼虾15% | 生瘦肉(去皮去肥的鸡鸭猪牛羊)20% | 熟瘦肉(一般)25% | 酱牛肉/柴卤肉30% | 瘦肉干40% | 蛋白粉75%(约23g/勺) | 鸡蛋6g/个 | 牛奶10g/250ml盒 | 无糖酸奶10g/盒 | 北豆腐7% | 毛豆/鲜黄豆13%

【铁律】
1. 只算「瘦肉」的蛋白：去皮鸡鸭、无白色脂肪层的猪牛羊、鱼虾贝、肝肾肚血。鸡鸭皮/排骨/肥牛肥羊/午餐肉/肉肠肉丸/炸肉/糖醋里脊等不是瘦肉，蛋白按0并在warn里提醒。
2. 水果的糖算进碳水。米面薯类是碳水主食。
3. 脂肪不单独计。糖油混合物(饼干蛋糕油条煎饼花式面包甜品)只计碳水并在warn提醒少吃。
4. 描述模糊就按常见分量估重：一碗米饭≈200g、一份外卖米饭≈250g、一块鸡胸≈150g、一根香蕉≈120g、一个鸡蛋按1个、一盒牛奶按1盒。照片按可见份量估，宁可略保守。
5. 看到明显煎炸/重油/肥肉/糖油混合物，照常估算但在 warn 里用一句话提醒冯总。

只输出 JSON（不要多余文字）：
{"items":[{"name":"食物名","amount":数字,"unit":"g或个或盒或勺","carb":数字,"protein":数字}],"note":"一句话估算说明","warn":"若有不利减脂的食物给一句提醒，否则空字符串"}`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
  if (!STEPFUN_KEY) return json({ error: "未配置 STEPFUN_API_KEY 密钥" }, 500);

  try {
    const body = await req.json();
    let userText: string = body.text ?? "";
    let transcript = "";

    // 1) 语音 → ASR
    if (body.kind === "audio" && body.audio) {
      const bytes = b64ToBytes(body.audio);
      const fd = new FormData();
      fd.append("model", ASR_MODEL);
      fd.append("file", new Blob([bytes], { type: body.mime || "audio/wav" }), "audio.wav");
      const ar = await fetch(`${BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${STEPFUN_KEY}` },
        body: fd,
      });
      const aj = await ar.json();
      transcript = aj.text ?? "";
      if (!transcript) return json({ items: [], note: "没听清，请再说一遍", transcript: "", warn: "" });
      userText = transcript;
    }

    // 2) 组装多模态消息
    const content: any[] = [];
    if (body.kind === "image" && body.image) {
      content.push({ type: "text", text: `这是一张食物照片${body.meal ? "（" + body.meal + "）" : ""}，请识别其中食物并按规则换算。${userText}` });
      content.push({ type: "image_url", image_url: { url: body.image } });
    } else {
      content.push({ type: "text", text: `${userText}${body.meal ? "（这是" + body.meal + "）" : ""}` });
    }

    // 3) step-3.7-flash 分析
    const cr = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${STEPFUN_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content }],
      }),
    });
    const cj = await cr.json();
    const raw = cj?.choices?.[0]?.message?.content ?? "";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = { items: [], note: "解析失败，请换种说法", warn: "" }; }
    // 数值清洗
    parsed.items = (parsed.items || []).map((x: any) => ({
      name: String(x.name || "食物"),
      amount: Math.round((+x.amount || 0) * 10) / 10,
      unit: x.unit || "g",
      carb: Math.round((+x.carb || 0) * 10) / 10,
      protein: Math.round((+x.protein || 0) * 10) / 10,
    })).filter((x: any) => x.carb > 0 || x.protein > 0);

    return json({ items: parsed.items, note: parsed.note || "", warn: parsed.warn || "", transcript });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
