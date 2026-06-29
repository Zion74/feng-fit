-- ============================================================
-- 冯总减脂 · 全流程 App · Supabase 建表脚本
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 1) 每日打卡（含饮食记录）
create table if not exists public.checkins (
  log_date   date primary key,   -- 一天一条，主键=日期
  weight     numeric,            -- 体重 kg
  plan       text,               -- A上肢/B下肢/休息
  training   text,               -- 完成/部分/未练/休息
  diet       text,               -- 优/良/差
  steps      integer,
  sleep      numeric,
  water      numeric,
  back       text,               -- 腰部感受 无/轻微/明显
  note       text,
  foods      jsonb,              -- 当日食物明细 [{n,u,a,carb,prot}]
  carbs      numeric,            -- 当日碳水合计 g
  protein    numeric,            -- 当日蛋白合计 g
  created_at timestamptz default now()
);

-- 2) 方案配置（教练在「设计」页编辑，单行 id=1，两端共享）
create table if not exists public.config (
  id         int primary key default 1,
  profile    jsonb,   -- {name,age,height,start_date,start_weight,target_weight}
  quota      jsonb,   -- {train:{carb,protein,fat}, rest:{...}}
  plan       jsonb,   -- {core:[...], A:[...], B:[...]}
  updated_at timestamptz default now()
);

-- 行级安全
alter table public.checkins enable row level security;
alter table public.config   enable row level security;

-- 匿名读写（2 人私用、低敏感；想更严见 README「隐私加固」）
create policy "ci_sel" on public.checkins for select to anon using (true);
create policy "ci_ins" on public.checkins for insert to anon with check (true);
create policy "ci_upd" on public.checkins for update to anon using (true) with check (true);
create policy "cf_sel" on public.config for select to anon using (true);
create policy "cf_ins" on public.config for insert to anon with check (true);
create policy "cf_upd" on public.config for update to anon using (true) with check (true);

-- 实时（可选，多设备更新更快互通）
alter publication supabase_realtime add table public.checkins;
alter publication supabase_realtime add table public.config;
