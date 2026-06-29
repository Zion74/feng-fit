# 冯总减脂 · 全流程 App

移动端优先的减脂网页，**单文件、无构建**，静态部署 GitHub Pages + Supabase 云同步。

**两种角色**（右上角齿轮切换）：
- **用户模式（冯总）**：每日打卡（体重/训练/腰部）+ **按食物营养率记饮食**（选食物→填克数→自动算碳水蛋白→对照配额进度条）。
- **教练模式（你）**：输入 PIN 进入「方案设计」——编辑冯总信息、设定每日配额（含公式一键估算）、增删训练动作；保存后冯总端同步。

三个页面：用户=今日打卡/训练计划/进度监看；教练=进度监看/训练计划/方案设计。

> 没填 Supabase 密钥时自动跑「本地演示模式」（数据存本机），双击 `index.html` 即可预览。

---

## 一、Supabase 设置（约 10 分钟，永久免费额度够用）

1. https://supabase.com → GitHub 登录 → **New project**（Region 选 Singapore/Tokyo），等初始化完成。
2. 左侧 **SQL Editor** → New query → 把 [`supabase-schema.sql`](supabase-schema.sql) 全部粘进去 → **Run**（建 checkins + config 两张表）。
3. **Project Settings → API**，复制 **Project URL** 和 **anon public** key。
4. 编辑 [`index.html`](index.html) 顶部 `const CONFIG = {`：
   ```js
   SUPABASE_URL:      'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: '你的 anon public key',
   COACH_PIN: '1990',   // ← 改成你自己的教练密码！
   ```
5. 保存。右上角小圆点/标识显示「教练/用户」即正常；冯总信息、配额、训练动作都在 App 内「方案设计」页填，**不写进代码**（这样公开仓库不泄露真实数据）。

---

## 二、部署到 GitHub Pages

仓库已由脚本/命令创建。若要手动：仓库 **Settings → Pages → Deploy from a branch → main / (root)**，1-2 分钟后得到
`https://<用户名>.github.io/<仓库名>/`，发给冯总，浏览器「添加到主屏幕」当 App 用。

更新内容：改完 `index.html` 重新 `git push` 覆盖即可。

---

## 三、隐私

- anon key 在前端公开，安全靠 RLS + 网址保密，对 2 人私用够了，**别公开发网址**。
- 真实身体数据存 Supabase（App 内填），代码默认值是通用占位，公开仓库不泄露。
- 想「仅登录可见」：开 Supabase Auth，把策略 `to anon` 改 `to authenticated` 并加登录——需要可找我加。

---

## 四、食物营养率来源

`index.html` 里 `FOODS` 数组源自 B 站「好人松松」套表 sheet19《日常食物营养率》（碳水/蛋白每 100g 或每份克数；脂肪按松松体系不单独计）。要加食物：在 `FOODS` 里照格式加一行。

---

## 五、AI 语音 / 拍照记录（需部署 Edge Function）

冯总在「饮食」Tab 加食物时，可**说一句**或**拍张外卖照**，AI（StepFun）按松松营养率自动算出碳水/蛋白，确认后加入对应餐。不部署也不影响手动记录。

> ⚠️ StepFun 是付费 LLM key，**绝不能放进前端**，所以用 Supabase Edge Function 当代理藏 key。

**部署步骤（控制台，约 5 分钟）：**

1. **建函数**：Supabase 控制台 → 左侧 **Edge Functions** → **Deploy a new function / Create function** → 名字填 **`diet-ai`** → 把 [`supabase/functions/diet-ai/index.ts`](supabase/functions/diet-ai/index.ts) 全部内容粘进编辑器。
2. **关掉 JWT 校验**：创建时把 **Verify JWT** 开关**关闭**（前端用 publishable key 调用，非 JWT）。若已创建，在函数 Settings 里关。
3. **设密钥**：Edge Functions → **Secrets**（或 Project Settings → Edge Functions）→ 新增
   `STEPFUN_API_KEY` = 你的 StepFun key。
4. **Deploy**。完成后前端会自动调用 `<SUPABASE_URL>/functions/v1/diet-ai`，无需改前端。

**用 CLI 部署（可选）：**
```bash
supabase functions deploy diet-ai --no-verify-jwt --project-ref rkqdpgeqieltxuyzjxdr
supabase secrets set STEPFUN_API_KEY=你的key --project-ref rkqdpgeqieltxuyzjxdr
```

**模型**：识图+分析 `step-3.7-flash`，语音转文字 `stepaudio-2.5-asr`（都在 index.ts 顶部可改）。
