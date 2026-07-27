# 技术报告 — 2026/07/27

> 本文为 `docs/RELATORIO-TECNICO-27-07.md`（葡萄牙语原件）的中文译本。
> 代码、文件路径、行号与数字保持原样。

**范围：** 提交 `bff4e0d..b07826b`（7 个 PR：#151-#157）+ PR #158（文档）。
**改动量：** 18 个文件 · **+347 / −90** 行 · 120 个测试（原为 119）·
`tsc --noEmit` 无错误 · ESLint 0 错误（3 条 react-hooks 警告为既有问题，未改动）。

| 提交 | UTC 时间 | 主题 |
|---|---|---|
| `bff4e0d` | 09:15 | 扫描器止损下限 + 修复经验被截断 |
| `669c894` | 10:37 | 面板时间窗口 |
| `472c99f` | 17:40 | 从未被读取的缓存 + 推理 token |
| `fd97c31` | 17:53 | A 代理退役 + B 代理去 Anthropic 化 |
| `c199653` | 18:04 | `oracle_self` 退役 |
| `7b463d9` | 18:11 | 神谕台冷却期改为全台级 |
| `b07826b` | 18:14 | 雷达豁免止损下限（纯净对照组） |

---

# 第一部分 — 缺陷：根本原因、证据与修复

## D1 · 扫描器缺少止损下限

**症状。** 扫描器的平均止损在两个队列之间反而**收窄**了：2.02% → 1.72%，
同时平均盈亏比从 2.11 升至 2.58。

**根本原因。** `reward/risk >= MIN_RR`（2）这个门控有两种满足方式：把**目标价**
推远，或把**止损**拉近。对模型而言拉近止损永远更"省力"，而落在标的噪声区间内的
止损死于波动，而非死于判断错误。7/25 的修复（`stopFloorGate`）只作用于狙击手
（`sniper.ts`），没有进入共享漏斗。

**证据。** `self_scan` 自身的 Auto-Retro（自省）写道：
> *"Tight stops in TRENDING_DOWN SELLs (under 1%) are getting clipped almost
> instantly (DOGE 0.4%, SOL 0.8%, BNB 0.3%, XRP 0.7% all stopped in under 7h)"*

**修复** — `src/lib/zion/backtest.ts`

新增常量（L431-432）：
```ts
const MIN_STOP_ATR = Number(process.env.BACKTEST_MIN_STOP_ATR ?? 1.5); // × 1h ATR%
const MIN_STOP_PCT = Number(process.env.BACKTEST_MIN_STOP_PCT ?? 1.2);
```

`ExtractOpts` — **修改前**（单行）：
```ts
export interface ExtractOpts { minRR?: number; regimeFilter?: boolean; minStopPct?: number }
```
**修改后**（L448-454）：
```ts
export interface ExtractOpts {
  minRR?: number; regimeFilter?: boolean; minStopPct?: number;
  atrPctBySymbol?: Map<string, number>; minStopAtr?: number;
  stopFloor?: boolean;   // 见 D6
}
```

`extractSuggestion` 中的新门控（L537-544），置于几何校验**之前** ——
顺序很重要：先以"噪声止损"拒绝，再评估盈亏比：
```ts
if ((opts?.stopFloor ?? true) && entry && entry > 0 && stop) {
  const atrPct = opts?.atrPctBySymbol?.get(base);
  const floor = Math.max(
    atrPct != null && atrPct > 0 ? atrPct * (opts?.minStopAtr ?? MIN_STOP_ATR) : 0,
    opts?.minStopPct ?? MIN_STOP_PCT,
  );
  if ((Math.abs(entry - stop) / entry) * 100 < floor) return null;
}
```

`logSuggestions` 开始从指标中提取 ATR（L568-574）：
```ts
+ const atrBy = new Map<string, number>();
  for (const ind of indicators) { ...
+   if (ind.atrPct != null && ind.atrPct > 0) atrBy.set(sym, ind.atrPct);
  }
```

提示词（`buildScanInstruction`，L94-97）—— 告知模型该门控的存在，避免浪费卡片：
```
STOP FLOOR — the stop must sit at least max(1.5×ATR, 1.2%) from entry.
Build the RR ratio by choosing the TARGET, never by tightening the stop.
```

`sniper.ts` L143 —— 改为使用同一映射（此前狙击手有独立的门控）：
```diff
- const s = extractSuggestion(card, refBy, regimeBy);
+ const s = extractSuggestion(card, refBy, regimeBy, { atrPctBySymbol: atrBy });
```

**保留的语义：** 下限仅在卡片**带有**止损时生效。无括号的方向性判断仍可通过
（按持有期到期结算）。

**测试**（`backtest.test.ts`，+2）：ATR 1.4% 时（下限 2.1%）拒绝 1.5% 的止损；
接受 2.5% 的止损且目标价仍满足盈亏比 ≥2；无 ATR 读数时套用 1.2% 的固定下限。

---

## D2 · 自省经验在"处方"部分被截断

**症状。** 经验句子在处方处戛然而止：
`"...until a higher-conviction filter is a"`、`"...require a s"`、
`"...my tight-stop short entries are being "`。

**根本原因。** `MAX_LESSON_CHARS = 220` —— 这是我在 7/25 未依据数据选定的常量。
模型产出的格式是*诊断 + 处方*，而截断点系统性地落在处方上，也就是真正改变行为的
那一半。

**修复** — `src/lib/zion/retro.ts` L28-32：
```diff
- const MAX_LESSON_CHARS = 220;
+ const MAX_LESSON_CHARS = Number(process.env.RETRO_LESSON_CHARS ?? 400);
```
**测试**已更新为断言 400，**并**验证 7/26 那一轮真实产出的一条经验（205 字符）
完整保留 —— 用暴露该缺陷的真实数据做回归测试，而不是用合成样本。

---

## D3 · 面板把不同配置时代压平成一个平均值

**症状。** 锦标赛面板显示 `Mistral: −0.23%`，而它近期时代的实际表现是 `+0.12%`。
一个真正奏效的修复在数学上变得不可见。

**根本原因。** 两个路由都在无时间切分的情况下聚合**整个存活轮次**。存活轮次里
积累了多个配置时代（审计前、周末队列、止损下限之后），终身平均把新时代稀释进了
旧时代。

**设计决策。** 按 `created_at` 切分，**而非** `resolved_at`：一张卡片属于**生成
它**的那套配置。在旧配置下生成、今天才结算的卡片，属于旧时代的数据。

**修复** — `src/app/admin/api/backtest/route.ts` L36-38（`tournament/route.ts` 同理）：
```ts
const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "");
const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 3650 ? rawDays : null;
const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
```
应用于分页查询（L48）与最近列表（L56）。在锦标赛中，交易台的周期按 `closed_at`
切分（它们在同一个 tick 内开仓并平仓）。

`tournament/route.ts` 需要访问查询字符串，故签名变更：
```diff
- export async function GET(): Promise<NextResponse> {
+ export async function GET(req: NextRequest): Promise<NextResponse> {
```

面板：新增 `24H · 7D · 30D · TUDO(全部)` 一排按钮，默认 **7D**，并标注
"按卡片生成日期（即生成它的配置）"。

**保持的不变量：** 该窗口**仅用于展示**。`runTournamentCull` 依旧基于整个存活
轮次进行裁决 —— 24 小时视图不可能"处决"一个代理。

---

## D4 · 付费写入却从未被读取的缓存

**症状。** 7 月 Anthropic 账单：**$25.07**。

**根本原因。** 3 条定时任务路径上设了 `cacheSystem: true`。Anthropic 提示词缓存
的默认 TTL 是 **5 分钟**；回测定时任务每 **30 分钟**运行一次，神谕台每天
**1 次**。每一次写入都在任何读取之前过期 —— 我们支付了写入溢价（1.25× 输入价），
却几乎完全没有拿到读取折扣（0.1× 输入价）。

**证据**（官方 CSV 汇总）：
```
缓存写入：2,389,090 tokens
缓存读取：    9,432 tokens   → 命中率 0.39%
```
账单拆解：

| 模型 | 输入 | **缓存写入** | 缓存读取 | 输出 | 合计 |
|---|---:|---:|---:|---:|---:|
| sonnet-4-6 | $2.85 | **$5.09** | $0.003 | $3.52 | $11.46 |
| opus-4-8 | $3.99 | **$6.45** | $0.000 | $3.16 | $13.60 |

**为什么 1 小时 TTL 同样救不了：** 写入 2× 输入价 + 一次 0.1× 的读取，在我们的
节奏下平均约为每次调用 1.05×，仍然差于纯输入（1.0×）。

**修复** —— 移除 3 处 `cacheSystem`：
`backtest.ts` L197（A 代理）、`backtest.ts` L385（CEO）、`oracle.ts`（神谕台）。

---

## D5 · 推理 token 未计入成本

**症状。** xAI 控制台：`Reasoning text tokens 359.2K = $0.90`，对比
`Completion text tokens 140K = $0.35`。

**根本原因。** `openaiCompatChat` 只读取 `completion_tokens`。带推理能力的供应商
会把内部推理过程作为**独立计费项** —— 因此 **Grok 输出成本的 72%** 从未进入
FINANCE 面板。

**修复** — `src/lib/ai/provider.ts` L118-137：
```diff
- usage?: { prompt_tokens?: number; completion_tokens?: number };
+ usage?: {
+   prompt_tokens?: number; completion_tokens?: number;
+   completion_tokens_details?: { reasoning_tokens?: number };
+ };
...
- outTokens: data.usage?.completion_tokens ?? 0,
+ outTokens: (data.usage?.completion_tokens ?? 0)
+   + (data.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
```

**我自己的报告更正。** 我曾断言 FINANCE 面板低估了成本。**这是错的**：
`estimateCost`（`ai-cost.ts` L57-65）一直都在计算
`cacheWriteTokens × p.cacheWrite5m`。忽略该列的是**我临时写的那条 SQL**，
也正因如此我把 Mistral（免费套餐，现金成本 $0）判定为我们最贵的代理。
`ai-cost.ts` 已加注释，说明 Mistral 那一行是启用按量付费后**才会**适用的费率。

---

## D6 · 神谕台冷却期只作用于单个模型（ARB 漏洞）

**症状。** 神谕台战绩 **0 胜 6 负**；**6 笔亏损中有 5 笔是做多 ARB**，
分别来自 3 个不同的模型。

| source | 标的 | 市场状态 | 结果 | 建立日期 |
|---|---|---|---:|---|
| oracle_deepseek | ARB | RANGING | −5.4% | 07/17 |
| oracle_mistral | ARB | RANGING | −5.4% | 07/17 |
| oracle_mistral | ARB | RANGING | −5.5% | 07/18 |
| oracle_deepseek | ARB | RANGING | −6.6% | 07/18 |
| oracle_kimi | ARB | TRENDING_DOWN | −4.5% | **07/25** |
| oracle_deepseek | ADA | TRENDING_UP | −4.5% | 07/26 |

**根本原因。** 7/25 的冷却期以 `source` 为索引。Kimi 在 25 日进场 ARB ——
即 DeepSeek 与 Mistral 在该标的止损后的两天 —— 因为 *Kimi 本身*从未在 ARB 上
被止损过。这道锁完全按规格运行；**是规格本身错了：一次止损是关于"标的"的证据，
而不是关于"下单的分析师"的证据。**

**修复** — `src/lib/zion/oracle.ts`：
```diff
- const cooldownBy = new Map<string, Set<string>>();   // 按 source
+ const deskCooldown = new Set<string>();              // 全台级（L164）
...
-     if (r.status === "hit_stop") {
-       (cooldownBy.get(r.source) ?? cooldownBy.set(r.source, new Set()).get(r.source)!).add(r.symbol);
-     }
+     if (r.status === "hit_stop") deskCooldown.add(r.symbol);   // L176
...
-     if (!symbolAllowed(s.symbol, { cooldown, ownOpen, ... }))
+     if (!symbolAllowed(s.symbol, { cooldown: deskCooldown, ownOpen, ... }))  // L231
```
提示词中的记忆区块（L180-190）现在会明确说明该规则，而不是让模型通过卡片被
静默丢弃去自行发现。

**保留：** 记忆仍然**按模型**划分（这正是自省之所以"属于自己"的原因）；
只有**锁**变成了集体的。`symbolAllowed` 签名不变 —— 既有测试覆盖新语义，
注释已更新。

---

## D7 · 对照组被"施加了处理"

**症状（在重新开启之前的自查中发现）。** 雷达通过 `logSuggestions` 记录，
与被处理的代理走同一个漏斗 —— 因此它也接受了 D1 的止损下限。

**为何严重。** 雷达是系统中唯一未被处理的标尺；正是它证明了 7/17 的崩塌与
7/26 的暴涨都是**市场状态所致，而非能力所致**。一个被施加处理的对照组，会把本周
的实验退化成"前后对比" —— 这恰恰是已经骗过我们两次的设计。

**修复** — `backtest.ts` L575-583：
```ts
const isControl = source === "radar";
const rows = cards
  .map((c) => extractSuggestion(c, refBy, regimeBy,
      isControl ? { stopFloor: false } : { atrPctBySymbol: atrBy }))
```
并附 7 行注释说明理由，以及明确指令
*"Do not 'fix' this to make the radar look better."*（不要为了让雷达好看而"修"它）
—— 因为它看起来一定像 bug。

**豁免范围：** 仅限止损下限。雷达仍需通过量级合理性（±25%）、几何校验、
最小盈亏比、目标价钳制与市场状态过滤。
**测试**（+1）：豁免后的对照组接受 1% 的止损，但盈亏比 0.33 的卡片仍被拒绝。

---

# 第二部分 — 架构变更（并非缺陷）

## A1 · A 代理退役

**理由：** 实测表现与免费大脑相差约 1 个百分点以内，却是账单上最大的经常性支出项。

- `app/api/zion/backtest/route.ts`：该阶段已从 `Promise.all` 中移除。
  **之前：** `const [claudeCards, hybridCards, ...providerCards]`，首位是
  `runBacktestScan(marketData)`，并调用
  `logSuggestions(claudeCards, ..., "self_scan")`。
  **之后：** `const [hybridCards, ...providerCards]` —— 该阶段不复存在。
- `cull.ts` L30：`self_scan` 从 `CULL_SOURCES` 移除（不再运行，也就无从裁撤）。
- `runBacktestScan` 作为**有文档说明的死代码**保留 —— 台账中仍有 `self_scan`
  的历史数据。
- 面板：标签改为 `Agent A · ZION (aposentado/已退役)`，`kind: "retired"`
  （颜色 `--adm-ink-4`），回测筛选器中显示为 `A·ZION†`。

## A2 · B 代理去 Anthropic 化重建

`registry.ts` L108-127 —— 新增 `ceo` 角色并重排优先级链：
```diff
- export type HybridRole = "brain" | "macro" | "sentiment";
+ export type HybridRole = "brain" | "macro" | "sentiment" | "ceo";
  const ROLE_PREFERENCE: Record<HybridRole, string[]> = {
-   brain:     ["deepseek", "mistral"],
-   macro:     ["kimi", "deepseek"],
+   brain:     ["mistral", "kimi"],
+   macro:     ["kimi", "mistral"],
    sentiment: ["grok", "mistral"],
+   ceo:       ["deepseek", "kimi", "mistral"],
  };
```

**决策：** `brain` 从 DeepSeek 换成 Mistral 是**刻意为之** —— 若 DeepSeek 既签字
又起草，CEO 就是在审阅自己的稿子（那是盖章，不是第二意见）。附带好处：
Mistral 是免费套餐。

`backtest.ts` `runHybridScan` —— 守卫与开关（L340-345）：
```diff
- if (process.env.HYBRID_B_ENABLED !== "true") return [];
- const anthropicKey = process.env.ANTHROPIC_API_KEY;
- const brain = roleProvider("brain");
- if (!anthropicKey || !brain?.apiKey) return [];
+ if ((process.env.HYBRID_B_ENABLED ?? "true") === "false") return [];
+ const brain = roleProvider("brain");
+ const ceo = roleProvider("ceo");
+ if (!brain?.apiKey || !ceo?.apiKey) return [];
```
*（该开关原本是为了保护 Opus 额度；昂贵席位取消后，默认值反转为开启）*

CEO 席位（L380-398）—— 从"`anthropicChat` + 两个 Anthropic 模型"改为
"`openaiCompatChat` + 跨供应商回退"，并且**开始遵守熔断器**（Anthropic 版本
此前并不遵守）：
```diff
- const primaryModel  = process.env.HYBRID_ORCH_MODEL ?? "claude-opus-4-8";
- const fallbackModel = process.env.HYBRID_ORCH_FALLBACK_MODEL ?? modelChain()[0];
- for (const [model, role] of [[primaryModel, "hybrid_ceo"], [fallbackModel, "hybrid_ceo_fallback"]]) {
-   const o = await anthropicChat({ model, ... }, anthropicKey);
+ const ceoFallback = configuredProviders().find((p) => p.id !== ceo.id && p.id !== brain.id) ?? null;
+ for (const [provider, role] of [[ceo, "hybrid_ceo"], [ceoFallback, "hybrid_ceo_fallback"]]) {
+   if (!provider?.apiKey) continue;
+   if (await isTripped(provider.id)) continue;
+   const o = await openaiCompatChat({ model: provider.model, ... }, { apiKey, baseUrl });
+   await recordResult(provider.id, provider.label, true);
```
错误现在会调用 `recordResult(false)` + `logError`（此前是静默的 `catch {}`）。

`retro.ts` L138-143 —— `hybrid_scan` 的自省跟随席位：
```ts
if (source === "hybrid_scan") {
  const ceo = roleProvider("ceo");
  return ceo ? { kind: "compat", providerId: ceo.id } : null;
}
```

## A3 · `oracle_self` 退役

`oracle.ts` 中的 `if (claudeKey) { runs.push({ source: "oracle_self", ... }) }`
区块已移除。`anthropicChat`、`modelChain` 与 `SCAN_CARDS_SCHEMA` 三个 import
随之成为孤儿并被删除。结果：**飞轮中已无任何 Anthropic 席位**。
其 3 条未结算论点仍会正常结算（结算与 source 无关）。

---

# 第三部分 — 度量

## 09:01 队列 —— 周末实验的裁决

混杂因素查询（正是它改变了结论）：
```sql
SELECT CASE WHEN created_at >= '2026-07-25T15:40:00Z' THEN 'FDS' ELSE 'pre' END AS coorte, side,
  COUNT(*) FILTER (WHERE status='hit_target') AS w,
  COUNT(*) FILTER (WHERE status='hit_stop') AS l
FROM zion_suggestions WHERE archived_at IS NULL AND source LIKE '%_scan'
GROUP BY 1,2;
```
| 队列 | 做多 | 做空 |
|---|---:|---:|
| 之前 | 26%（6胜/17负） | 7%（6胜/76负） |
| 周末 | **77%**（23胜/7负） | **4%**（1胜/27负） |

做多 77% / 做空 4% = 单边上涨行情的特征。**裁决：未证明有任何能力提升。**
几何数据也印证了那个恶习：平均止损 2.02% → 1.72%，盈亏比 2.11 → 2.58，
触发止损的时长 18.9h → 11.5h。

## 18:01 队列 —— 完整战绩

| 代理 | 胜/负/到期 | 净期望 | 平均止损 |
|---|---|---:|---:|
| 狙击手 Sniper | 6/6/0 | −0.02% | 1.80% |
| Mistral | 19/31/5 | −0.09% | 1.50% |
| 雷达（对照组） | 11/14/6 | −0.36% | 2.67% |
| self_scan † | 7/28/7 | −0.53% | 1.99% |
| Kimi | 7/39/9 | −0.87% | 1.93% |
| Grok | 6/32/2 | −0.98% | 1.98% |
| hybrid_scan | 1/3/0 | −1.46% | 1.64% |
| DeepSeek | 2/17/3 | −1.47% | 2.19% |
| 神谕台（3 个模型） | 0/6/0 | −4.6 至 −5.7 | 4.4-5.5% |

交易台：**Arbiter** +$58.95（+5.90%，420 个周期，0 亏损，24 小时内 40 个周期）·
**Arbiter 2.0** +$23.75（基于 $300 本金 +7.92%，140 个周期，0 亏损，24 小时 20 个）。

## 成本 —— 与账单的对账

| 供应商 | 7 月 | 来源 |
|---|---:|---|
| Anthropic | **$25.07** | 官方 CSV（与控制台一致） |
| xAI | $3.50 | 控制台（其中 26% 为推理） |
| Kimi | ~$1.50 | 控制台 |
| DeepSeek | $0.74 | 控制台（1,153 次请求） |
| Mistral | **$0** | 免费套餐，配额已用 19% |

Anthropic 每日成本：**07/11-13 = $5.56 / $5.97 / $6.01**（B 代理搭配 Opus）·
**07/18-24 = $0.04**（已暂停）· **07/26 = $1.64**（周末）。
三天的 Opus = **$17.50 = 当月账单的 70%**。

---

# 第四部分 — 运行状态

**今日 `admin_kv` 变更：**
| 键 | 09:10 | 18:20 |
|---|---|---|
| `pause_agent_a` | true | true（代码中该阶段已移除） |
| `pause_agent_b` | true | **false** |
| `pause_tournament` | true | **false** |
| 其余开关 | false | false |

今日无数据库迁移。无任何 `culled:*` 键处于激活状态。

**新增/变更的环境变量：** `BACKTEST_MIN_STOP_ATR`（1.5）·
`BACKTEST_MIN_STOP_PCT`（1.2）· `RETRO_LESSON_CHARS`（400）· `HYBRID_CEO` ·
`HYBRID_BRAIN` · `HYBRID_B_ENABLED`（默认值反转为开启）·
`HYBRID_ORCH_MODEL`/`HYBRID_ORCH_FALLBACK_MODEL` **已废弃**。

**新增测试覆盖：** 4 个用例 —— 带 ATR 的止损下限 · 无 ATR 时的固定下限 ·
对照组豁免 · 经验文本 400 字符截断（含基于真实经验的回归断言）。

**本周预先登记的判定标准：** 成功 = 受处理队列在**相对雷达的双重差分
（diff-in-diff）**上优于未受处理队列，且平均止损从 1.72% 升至约 2.5% 以上。
失败 = 只是产出更少的卡片，而相对表现没有改善。
