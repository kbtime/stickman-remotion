# 05 · 内容层：事实核查 / point / 五段节奏 / 内容规则

画面没问题不代表内容成立。内容层管四件事：**说法是否可靠、每镜有没有 point、五段节奏是否合理、内容规则是否通过**。

对应命令：

```bash
stickman research --project <dir>          # 先核实数字和事实说法
stickman lint --project <dir>              # 结构 + 五段节奏 + 非 LLM 规则
stickman qc ... --script <dir>/script.json # 画面 QC + 全量内容规则（含 LLM）
stickman render --project <dir> --content-gate  # 渲染前内容门（可选）
```

写作规范原文见 `/workspace/drafts/stickman-koubo-style-guide-v2.md`（仓库外），本文是 v2 落地到脚本和规则的说明。v1 的 C 规则编号已由本文件与 `qc-rules.json` 覆盖。

## 1. 事实核查：research

`scripts/research.mjs` 从旁白里抽取需要核实的数字/事实说法，逐条联网搜索并判定。

```bash
stickman research --project examples/sample-story
stickman research --project examples/sample-story --no-llm --n 3
stickman research --project examples/sample-drucker --out out/drucker-research.md
```

产物：

- `<项目目录>/research.md`：给人看的核查表，列出说法、结论、来源 URL、备注；
- `<项目目录>/research.json`：同样的数据加 `counts` / `warnings`，方便脚本消费。

| 项 | 说明 |
|---|---|
| `--project <dir>` | 项目目录，读 `<dir>/script.json` |
| `--out <file>` | 报告路径；JSON 写同名 `.json` |
| `--n <n>` | 每条说法最多取几条搜索结果，默认 5 |
| `--max-claims <n>` | 最多核查多少条说法，默认 12 |
| `--no-llm` | 不用 LLM，走正则抽取 + 数字比对启发式 |
| `--model <name>` | LLM 模型，默认 `deepseek-v4-flash` |
| `DEEPSEEK_API_KEY` | 有 key 时才做 LLM 抽取与判定；没有就自动走启发式 |
| `DS_SEARCH_BIN` | 搜索命令，默认 `/home/box/.local/bin/ds-search` |

判定只有三种：`supported`（已证实）、`contradicted`（有出入）、`unverified`（未证实）。**`source_url` 必须是搜索结果里出现过的 URL**；写入报告前会统一去掉 `#1`、`#12` 这类纯数字序号锚点，保留 `#section` 这类有意义的 fragment。LLM 返回带 `#N` 的 URL 也会规范化回搜索结果原始 URL。`generatedAt` 使用带本地时区偏移的 ISO 时间，如 `2026-11-01T08:53:04+08:00`，不是 UTC 的 `Z`。

`research` 是建议工具，不改变渲染流程；有出入/未证实的说法要人工决定改稿还是删掉。`lint`/`qc` 会自动读取 `<项目目录>/research.md` 给 C18 用。

## 2. script.json：point / beat / 节奏

### 2.1 每镜一个 point

```jsonc
{
  "title": "AI 写周报为什么像套话",
  "mode": "story",
  "aspect": "9:16",
  "theme": "warm",
  "fps": 30,
  "ttsRate": "-12%",
  "narration": ["AI 写的周报，一看就是 AI 写的。"],
  "shots": [
    {
      "beat": "hook",
      "point": "AI 写的东西一眼能看出来",
      "scene": "desk",
      "framing": "medium",
      "caption": "一看就是 AI 写的",
      "cast": [
        {
          "id": "hero",
          "x": 0.42,
          "y": 0.8,
          "scale": 1,
          "pose": "shrug",
          "action": "enter-left",
          "facing": "right"
        }
      ],
      "props": [{ "id": "laptop", "x": 0.7, "y": 0.82, "scale": 0.95 }]
    }
  ]
}
```

`cast` 的完整写法以 `examples/sample-story/script.json` 为准：每个角色都有 `id` / `x` / `y` / `scale` / `pose` / `action` / `facing`；场景、道具、姿势只用 `src/types.ts` / SKILL.md 里列出的值。

`point` 是**这一镜看完观众记住了什么**，不是标题、不是旁白原文、也不是画面描述。写分镜时先写 point，再让旁白和画面服务它；一镜只保留一个 point，多个 point 就拆镜。数字或关键短句想做成大字卡就放进 `caption`，不为了上大字卡去凑金句。

### 2.2 beat：规范五段

`shots[].beat` 取值：`hook` / `problem` / `breakdown` / `takeaway` / `action`。只有属于这个枚举的值才被当作段落；旧示例里 `beat` 是自由文本描述（如「主角走进办公室，抛出需求」），这种不会被当成段落。

兼容旧字段 `beatRole`：`hook` / `problem` / `breakdown` / `conclusion` / `action`，其中 `conclusion` 统一映射成 `takeaway`。同一个镜头同时有 `beat` 枚举和 `beatRole` 时以 `beat` 为准。

| 段落 | 这段干什么 | 建议字数 | 镜头数（长版） | 时长（长版） | 短版 |
|---|---|---:|---:|---|---|
| 钩子 `hook` | 第一句给场面或反常结果 | 30–60 | 3–5 | 6–12 秒 | 1–2 镜 |
| 问题 `problem` | 把卡住的地方说具体 | 60–120 | 5–8 | 12–24 秒 | 1–2 镜 |
| 拆解 `breakdown` | 一步一步讲怎么做/为什么 | 150–450 | 12–30 | 30–90 秒 | 1–2 镜 |
| 结论 `takeaway` | 一两句把判断说清楚 | 30–80 | 2–5 | 6–16 秒 | 1–2 镜 |
| 行动 `action` | 一个看完马上能做的小动作 | 15–50 | 1–3 | 4–10 秒 | 1–2 镜 |

长版指 1–3 分钟、约 25–60 镜；短版指 18–25 秒，五段都要有，各段 1–2 镜，钩子和行动不能省。

`lint` 的节奏提示用这张表：标了 beat 的段落，镜头数或时长落在区间外会 WARN；还缺哪些段落没标会给 INFO。相邻镜头换不换场景不是硬规则，连续 3 镜以上同一个场景只给 INFO。

### 2.3 九类 AI 腔（口播版摘要）

v2 把影视旁白版的「去 AI 腔」压成火柴人口播版。写稿和自检时逐类扫一遍：

| # | AI 腔 | 口播反例 | 改法 | 对应质检 |
|---|---|---|---|---|
| 1 | 万能开头 | 随着 AI 的发展 / 大家好，今天分享 / 在……背景下 | 前三句直接给具体场面、物件或结果 | C08（C08a 词表） |
| 2 | 材料腔抽象大词 | 赋能、闭环、生态、抓手、本质是、底层逻辑 | 换成动作、结果或可见变化；点题词全片最多一处 | C09 / C24 |
| 3 | 假对比 | 不是工具不行，而是认知要重构 / 不只是效率，更是认知 | 删掉后半句空道理，只留事实；真实纠正可保留但只算 WARN | C10 |
| 4 | 机械排比 | 从效率到质量，从个人到团队 / 连续三句同开头 | 留一句最具体的，删掉同构句 | C23（连续 ≥3 句）；C14 只提示连续=2 |
| 5 | 替人物抒情 | 那一刻我深知肩上的责任 / 心中充满自豪 | 只写动作和事实；没提供的情绪标【待补】 | C25 |
| 6 | 过早总结 | 前 30% 就「总之 / 一句话 / 这就是……」 | 先讲完事实和步骤，点题留到结论段 | C22 |
| 7 | 结尾口号腔 | 未来可期 / 让我们一起 / 致敬 / 评论区聊聊 | 动作、意象回扣、原话、事实或具体留白问题 | C11 / C12 |
| 8 | 宣传腔和夸大 | 极致、领先、完美、零缺陷、彻底解决、最顶级 | 删形容词，只留能在 research.md 对上依据的事实 | C09 / C19 |
| 9 | 分行体 | 夜班。/ 灯还亮着。/ 她拿起周报。/ 全是套话。 | 长短交替；连续 ≥4 句 ≤8 字必须合并 | C20 / C26 |

### 2.4 句长折中（口播版）

| 规则 | 要求 | 质检 |
|---|---|---|
| 默认单句 | ≤16 字 | C02 FAIL（未占信息句额度） |
| 信息句额度 | 17–22 字：钩子+问题合计 ≤1；拆解每 8 镜 ≤1；结论+行动合计 ≤1 | C02 / C21 FAIL |
| 超长句 | ≥23 字 | C02 FAIL |
| 分行体 | 连续 ≥4 句，每句 ≤8 字 | C20 FAIL |
| 长短交替 | 连续 ≥5 句都在 12–16 字且相邻差 ≤2 | C26 WARN |

信息句不是免死金牌：C02 的 detail 会列出每一句占用额度的信息句（第几句、所在段、字数、原文），方便判断该合并还是删。短版允许「结论=事实句，行动=动作动词镜」，C11 两者拆开也能过。

## 3. lint：结构 + 节奏 + 非 LLM 规则

```bash
stickman lint --project examples/sample-story
stickman lint --project examples/sample-story --stage render
stickman lint --project examples/sample-story --rules ./my-rules.json
stickman lint --project examples/sample-story --captions public/sample-story-captions.json
```

| 参数 | 说明 |
|---|---|
| `--project <dir>` | 必填，读 `<dir>/script.json` |
| `--rules <file>` | 规则文件；优先级 `--rules` > `<dir>/qc-rules.json` > 仓库根 `qc-rules.json` |
| `--stage draft\|render` | 默认 `draft`；`stage=render` 的规则只在 `render` 阶段执行（例如 C17） |
| `--captions <file>` | 显式指定字幕时间轴；默认找 `public/<目录名>-captions.json`，再找 `<dir>/captions.json` |

自动发现：

- `<项目目录>/research.md` → C18「数字有出处」；
- captions → C08「钩子在 3 秒内」用实测时间。没有 captions 时 C08 退化为检查 `narration[0]`，detail 会注明「未用实测时间」。

检查内容：

- 结构：shot 缺 `point`（WARN，保留旧行为）、`narration` 与 `shots` 数量不一致、`beatRole` 非法；
- 五段节奏：见上表；
- C01–C26 中所有 `type=builtin` / `type=regex` 规则；
- LLM 规则不在 lint 里跑。

退出码：**有 FAIL 为 1**；只有 WARN / INFO / SKIP 为 0。

## 4. 规则文件 qc-rules.json（version 2）

默认规则在仓库根 `qc-rules.json`；项目目录下的同名文件优先；`--rules <file>` 覆盖。

优先级：

```text
--rules <file>  >  <项目目录>/qc-rules.json  >  仓库根/qc-rules.json
```

```json
{
  "version": 2,
  "rules": [
    {
      "id": "C01",
      "name": "首句够短",
      "description": "首句只算中文字/英文字母/数字，不超过 14 字",
      "type": "builtin",
      "check": "first_sentence_length",
      "params": { "max": 14 },
      "level": "FAIL",
      "stage": "draft",
      "enabled": true
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 规则唯一标识；不能重复。C 规则用 `C01`…，LLM 规则用 `hook_3s` 等 |
| `name` | 是 | 中文名，报告里显示 |
| `description` | 否 | 一句话说明这条规则管什么 |
| `type` | 是 | `builtin` / `regex` / `llm` |
| `check` | `builtin` 必填 | 内置检查器名，见第 6 节 |
| `params` | 否 | 阈值、正则、词表等，全部可配；默认 `{}` |
| `prompt` | `llm` 必填 | 给 LLM 的检查说明 |
| `level` | 是 | 不通过时上报 `FAIL` 或 `WARN`（规范 error→FAIL，warn→WARN） |
| `stage` | 否 | `draft`（默认）或 `render`；`render` 规则只在 `--stage render` 时执行 |
| `draftStatus` | 否 | `PASS` 或 `SKIP`，默认 `SKIP`；只对 `stage=render` 的规则生效。C17 配成 `PASS`，所以草稿阶段显示 PASS/不拦，render 阶段才 FAIL |
| `enabled` | 否 | 默认 `true`；`false` 的规则不执行，报告中标 `DISABLED` |

校验（`loadRules`）：

- 顶层必须是带 `version: 2` 和 `rules` 数组的 JSON 对象；
- `id` 唯一，`name` 非空；
- `type` / `level` / `stage` 只能是上面列出的值；
- `type=builtin` 时 `check` 必须存在（注册表见 `scripts/content-rules.mjs`）；
- `type=regex` 时 `params.pattern` 或 `params.patterns` 必须存在，且正则可以编译；
- `type=llm` 时 `prompt` 非空；
- `enabled` 必须是布尔值，`params` 必须是对象。

错误会指出「哪条规则（id）的哪个字段」，例如：

```text
内容规则文件 /path/qc-rules.json 第 3 条规则（C09）的 params.pattern 无法编译：……
```

### 4.1 规则状态

| 状态 | 含义 |
|---|---|
| `PASS` | 通过 |
| `WARN` / `FAIL` | 不通过，按规则自己的 `level` |
| `SKIP` | 没有执行：缺 research、当前 stage 不适用、没有 LLM key、LLM 未返回等 |
| `DISABLED` | `enabled: false`，不执行但保留在报告里 |

`stage=render` 的规则在 draft 阶段默认 `SKIP`；配置 `draftStatus: "PASS"` 时改为 `PASS`（C17 就是这种，草稿允许【待补）。

## 5. 默认规则：C01–C26

字数统一口径：**只算中文字、英文字母、数字，不算标点和空格**（`countChars`）。`narration` 拼接为全文。C08a 与 C12a 不单独占 id：C08a 词表合入 C08 的 `params.openerPattern`，C12a 口号词表合入 C12 的 `params.sloganPattern`。

| ID | 规则 | 检查方法 | 阈值 / params | 级别 | 阶段 |
|---|---|---|---|---|---|
| C01 | 首句够短 | `countChars(narration[0])` | `max: 14` | FAIL | draft |
| C02 | 单句长度（折中） | ≤16 普通；17–22 信息句占额度；≥23 | `normalMax: 16`、`infoMax: 22`、额度见 2.4 | FAIL | draft |
| C03 | 镜句对齐 | `narration.length === shots.length` | 相等 | FAIL | draft |
| C04 | 总字数 | 全文 `countChars` | `min: 300`、`max: 800`；短版 `60–120` | FAIL | draft |
| C05 | point 必填 | 每个 `shots[i].point` 非空且长度 | `min: 1`、`max: 20` | FAIL | draft |
| C06 | point 不复读 | point 与对应 narration 完全相同的占比 | `maxRatio: 0.3` | WARN | draft |
| C07 | 五段齐全 | `beat`（或 `beatRole`）出现且顺序正确 | hook→problem→breakdown→takeaway→action，允许同段相邻重复 | FAIL | draft |
| C08 | 钩子在 3 秒内 + C08a | 第一镜 `beat=hook`；前 3 秒 captions（`start/end` 秒或 `startFrame/endFrame + fps`）与 `narration[0..2]` 不命中万能开头 | `seconds: 3`、`narrationLines: 3`、`openerPattern` | FAIL | draft |
| C09 | 禁用词（宣传/材料/夸张） | 全文正则，v2 词表含未来可期、闭环、生态、极致、完美等 | `pattern`、`max: 0` | FAIL | draft |
| C10 | 假对比句式 | `不是…而是` / `不只是…更是` / `并非…而是`；整句含明确纠正对象对立名词时降 WARN | `patterns`、`correctionNouns` | FAIL / WARN | draft |
| C11 | 结尾动作 | 最后 1–2 句去掉「现在/今天/先/就」后以动作动词开头；短版允许结论事实句 + 行动动词镜 | `lastN: 2`、`verbs`（含「补」） | FAIL | draft |
| C12 | 结尾问句判定 + C12a | 空问 FAIL；含具体对象名词的问句 WARN；无问句 PASS；最后 2 句命中口号词 FAIL | `emptyQuestionPattern`、`concreteNouns`、`sloganPattern` | FAIL / WARN | draft |
| C13 | 术语解释 | 术语首次出现的句子或下一句有解释标记 | `terms`、`markers` | WARN | draft |
| C14 | 同句式开头（仅提示连续 2 句） | 连续句子前 2 字相同；连续=2 才由 C14 报，≥3 交给 C23 | `maxRun: 2`、`prefixChars: 2` | WARN | draft |
| C15 | 第一人称 | 全文「我」出现次数 | `token: 我`、`min: 2` | WARN | draft |
| C16 | 等长排比 | 连续 3 句字数相同且前 2 字相同；或连续 3 个四字词 | 0 处 | WARN | draft |
| C17 | 待补占位 | 全文含 `【待补` | `max: 0`、`draftStatus: PASS` | FAIL | **render** |
| C18 | 数字有出处 | 含阿拉伯数字或「百分之/倍」的句子，在 research.md 找到同一数字 | research.md | WARN | draft |
| C19 | 夸张词 | `最\|第一\|彻底\|所有\|永远\|100%\|极致\|完美\|零缺陷` | `max: 2` | WARN | draft |
| C20 | 分行体 | 连续 ≥4 句，每句 ≤8 字 | `minRun: 4`、`maxLength: 8` | FAIL | draft |
| C21 | 信息句额度 | 17–22 字句按钩子+问题 / 拆解 / 结论+行动分组占额度 | 同 C02 | FAIL | draft |
| C22 | 过早总结 | 全文前 30% 字符内出现 `总之\|总的来说\|一句话\|归根结底\|这就是…` | `ratio: 0.3`、`patterns` | WARN | draft |
| C23 | 机械排比 / 同构开头 | 连续 ≥3 句前 2 字相同；连续 3 个四字词；`从…到…，从…到…` | `minPrefixRun: 3`、`fourCharRun: 3`、`fromToPattern` | WARN | draft |
| C24 | 抽象大词（材料腔扩展） | `本质是\|底层逻辑\|认知重构\|真正赋能\|核心竞争力\|价值闭环` | 0 次 | WARN | draft |
| C25 | 替人物抒情套话 | `深知\|充满了…自豪/感动\|那一刻…明白了\|心中涌起` | 0 次 | WARN | draft |
| C26 | 长短交替提示 | 连续 ≥5 句都在 12–16 字且相邻差 ≤2 | `minRun: 5`、`maxDiff: 2` | WARN | draft |

### 5.1 C02 / C21 信息句额度

- **普通句**：≤16 字。
- **信息句**：17–22 字。全片按段落占额度：钩子+问题合计 ≤1；拆解每 8 镜 ≤1（`ceil(拆解镜数 / 8)`）；结论+行动合计 ≤1。
- **超长句**：≥23 字，C02 直接 FAIL。
- C02 的 `detail` 和 `items` 都会列出占用额度的句子（第几句、所在段、字数、原文）；C21 单独汇总额度。未标 beat 的镜头按拆解额度处理，避免旧脚本因为缺 beat 误伤。

### 5.2 C08 / C08a 万能开头

C08 同时检查三件事：

1. 第一镜 `beat=hook`；
2. captions 前 3 秒（`start/end` 秒，或 `startFrame/endFrame` 除以 fps）不命中 `params.openerPattern`；
3. `narration[0..2]` 不命中同一词表。

没有 captions 时退化为只查 narration，detail 写明「未用实测时间（没有 captions）」。C08a 不再单独占 id，报告里在 C08 的 items 中标「命中万能开头（C08a）」。

### 5.3 C10 假对比

默认 FAIL。只有整句同时出现 `params.correctionNouns` 里的一组对立名词（默认 保存/上传、前端/后端、客户端/服务端等）才降为 WARN，例如「不是保存的问题，而是上传的问题」。`correctionNouns` 可写成对立名词组数组，也可写成扁平数组（出现任意两个即算明确纠正对象）。评论区、点赞、你学会了吗不再归 C10，统一归 C12。

### 5.4 C12 结尾问句细则（含 C12a）

| 情况 | 判定 | 例 |
|---|---|---|
| 口号式空问 | **FAIL** | 你学会了吗？/ 对不对？/ 欢迎在评论区聊聊 / 你觉得呢 |
| 问句但没有具体对象 | **FAIL** | 那到底该怎么办呢？ |
| 问句含具体对象名词 | **WARN** | 你上周周报里有几条是自己写的事实？ |
| 无问句 | **PASS**（动作由 C11 检查） | 现在打开备忘录，先记一条。 |
| 最后 2 句命中 C12a 口号词 | **FAIL** | 未来可期 / 让我们一起 / 致敬 / 新的篇章 |

具体对象名词在 `params.concreteNouns` 配置（周报、备忘录、会议纪要、提示词、表格等）。v2 的口径是：真实问题只作次选，行动段仍优先给动作；具体问题只 WARN，不直接拦渲染。

### 5.5 其他阈值说明

C04 的短版判定：`script.length === "short"` **或** `shots.length <= 12`，使用 60–120 字；否则 300–800 字。阈值都在 `params` 里，可改。

C13 是 WARN：术语表默认 Agent / 提示词 / 大模型 / API / 多模态 / Token / RAG / 微调，可在 `params.terms` 扩展，解释标记在 `params.markers`。

C17 默认 `draftStatus: "PASS"`：草稿阶段 PASS/不拦，`--stage render` 时才检查；因此 `【待补】` 可以留在 draft，但进不了渲染。

C14 与 C23 分工：C14 只提示连续=2 的同开头，连续 ≥3 句统一由 C23 报，避免一条稿子被两个规则重复计数。

## 6. 默认规则：4 条 LLM 规则

规范里的 L01–L04 在规则文件中保留旧 id，避免已有报告和调用方断掉：

| 规范编号 | 规则文件 id | 中文名 | 默认级别 | 检查什么 |
|---|---|---|---|---|
| L01 | `hook_3s` | 开头 3 秒钩子（LLM） | WARN | 开头有没有冲突/反常识/明确收益 |
| L02 | `jargon` | 术语解释（LLM） | WARN | 旁白里有没有未解释的术语、缩写、行话 |
| L03 | `actionable_ending` | 结尾可行动（LLM） | WARN | 最后一句有没有可执行动作 |
| L04 | `point_alignment` | 镜头与 point 对齐（LLM） | WARN | 每镜旁白是否支撑该镜 point |

- 只把 `type=llm`、`enabled=true`、当前 stage 生效的规则送进提示；
- 一次请求批量返回 `{"checks":{"<id>":{"pass":boolean,"detail":"...","items":[]}}}`；
- 模型默认 `deepseek-v4-flash`（`--model` 或 `STICKMAN_LLM_MODEL` 覆盖），读 `DEEPSEEK_API_KEY`；
- 没有 key → 这些规则 `SKIP`，detail 写「未设置 DEEPSEEK_API_KEY」；
- 调用失败 → `SKIP` 带原因，不影响 builtin 结果；
- `pass=true` → `PASS`，`pass=false` → 规则自己的 `level`（默认 WARN）。

## 7. 如何新增一条规则

### 7.1 新增一条 regex 规则

在 `qc-rules.json` 的 `rules` 里追加，不用改代码：

```json
{
  "id": "brand_word",
  "name": "竞品词",
  "description": "口播里不要提竞品或友商",
  "type": "regex",
  "params": {
    "patterns": ["竞品", "友商"],
    "max": 0
  },
  "level": "FAIL",
  "enabled": true
}
```

`params.pattern` 支持单个正则字符串；`params.patterns` 支持数组，所有命中数相加。`params.max` 是允许的命中次数，默认 0。`params.flags` 可选。

### 7.2 已有 builtin 检查器改阈值

例如把首句放宽到 16 字，不用改脚本：

```json
{
  "id": "C01",
  "name": "首句够短",
  "description": "首句不超过 16 字",
  "type": "builtin",
  "check": "first_sentence_length",
  "params": { "max": 16 },
  "level": "WARN",
  "enabled": true
}
```

已注册的 builtin 检查器：

```text
first_sentence_length    sentence_length          shot_alignment
total_chars              point_present            point_repeat
beats_complete           hook_within_3s           contrast_pattern
ending_action            ending_question          jargon_explained
consecutive_same_prefix  first_person             parallelism
numbers_sourced          line_break_style         info_sentence_quota
early_summary            mechanical_parallelism   length_alternation
```

> `ending_not_question` 仍保留为兼容旧自定义规则的别名；新规则请用 `ending_question`。

### 7.3 新增一条 builtin 规则（示例：检查连续感叹号）

纯词表能用 `regex` 就不要改代码；需要看句间关系时才加 builtin。新增检查器要改两处：`scripts/content-rules.mjs` 的 `CHECKS` 和 `BUILTIN_CHECK_INFO`。

```js
// scripts/content-rules.mjs，放进 CHECKS
/** C27 连续感叹号 */
no_double_exclamation(ctx) {
  const items = ctx.sentences
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => /[！!]{2,}/.test(sentence))
    .map(({ sentence, index }) => `第 ${index + 1} 句连续感叹号：${sentence}`);
  return {
    pass: items.length === 0,
    detail: items.length === 0 ? "没有连续感叹号" : `${items.length} 处连续感叹号`,
    items,
  };
}
```

然后在 `qc-rules.json` 里追加：

```json
{
  "id": "C27",
  "name": "连续感叹号",
  "description": "一句里不要连用两个以上感叹号",
  "type": "builtin",
  "check": "no_double_exclamation",
  "params": {},
  "level": "WARN",
  "enabled": true
}
```

检查器返回 `{pass, detail, items}`；需要某条命中降级时可在结果里带 `level: "WARN"`（C10 / C12 就是这样）。如果规则只适用于渲染前，加 `"stage": "render"`；想草稿阶段显示 PASS 而不是 SKIP，再加 `"draftStatus": "PASS"`（C17 的做法）。

### 7.4 新增一条 LLM 规则

```json
{
  "id": "cta_link",
  "name": "关注引导",
  "description": "结尾有没有自然的关注引导",
  "type": "llm",
  "prompt": "检查最后一句或结尾画面有没有给出具体的关注/收藏理由；只有「点个关注」四个字不算，要有观众能带走的下一步。",
  "level": "WARN",
  "enabled": true
}
```

LLM 会收到全部 enabled 的 LLM 规则，并按 id 返回：

```json
{
  "checks": {
    "cta_link": {
      "pass": false,
      "detail": "结尾只有口号，没有具体理由",
      "items": ["最后一句停在「点个关注」"]
    }
  }
}
```

### 7.5 只想临时试规则

复制一份规则文件，用 `--rules` 指定：

```bash
cp qc-rules.json /tmp/my-rules.json
# 改 /tmp/my-rules.json
stickman lint --project examples/sample-story --rules /tmp/my-rules.json
stickman qc --video out/sample-story.mp4 \
  --captions public/sample-story-captions.json \
  --script examples/sample-story/script.json --rules /tmp/my-rules.json
```

## 8. 裁决说明（与规范原文的落地差异）

1. **字数口径统一**：只算中文字、英文字母、数字，不算标点和空格；C01/C02/C04/C05 都用同一个 `countChars`。规范示范表里的「17 字信息句」按这个口径计数，fixture 已写成有效字 17。
2. **C08 同时查 captions 与 narration**：有 captions 时取 `start/end` 秒或 `startFrame/endFrame / fps` 覆盖前 3 秒的句子，并且 `narration[0..2]` 也查；没有 captions 才退化为只查 narration，并在 detail 注明「未用实测时间」。第一镜必须 `beat=hook`。
3. **C08a / C12a 合入主规则**：C08a 万能开头词表在 C08 的 `params.openerPattern`；C12a 口号词表在 C12 的 `params.sloganPattern`。规则总数仍是 C01–C26。
4. **C02 / C21 共用信息句额度**：17–22 字不再一律 FAIL，但必须占额度；≥23 仍 FAIL。未标 beat 的信息句按拆解额度处理。
5. **C10 与 C12 分工**：C10 只管「不是…而是…」类假对比，评论区 / 你学会了吗 / 口号问句归 C12；C10 命中明确纠正对象时降 WARN，C12 具体留白问题降 WARN。
6. **C14 与 C23 衔接**：C14 只报连续=2 的同开头；连续 ≥3 句交给 C23，避免重复计数。
7. **段落字段**：规范写 `shots[].beat`，仓库旧示例里 `beat` 是自由文本，所以只有 `hook/problem/breakdown/takeaway/action` 枚举值才算段落；同时兼容已实现的 `beatRole`，`conclusion` 映射成 `takeaway`。lint/qc 的节奏建议统一成规范五段，用规范表的建议字数/镜头数/时长区间提示；「相邻镜头换场景」不做硬规则，最多 INFO。
8. **C13 术语解释是 WARN**，术语表在 `params.terms` 可扩展。
9. **C04 短版判定**：`script.length === "short"` 或镜头数 ≤ 12 时用 60–120 字。
10. **C17 是 render 阶段规则**：默认 `draftStatus: "PASS"`，草稿阶段 PASS/不拦，`--stage render` 或 `render --content-gate` 才 FAIL。

## 9. qc 里的内容检查

```bash
stickman qc --video out/sample-story.mp4 \
  --captions public/sample-story-captions.json \
  --script examples/sample-story/script.json \
  --stage draft

# 关闭内容检查（builtin / regex / LLM 全跳过）
stickman qc ... --script examples/sample-story/script.json --no-content
```

- `qc-report.json` 写入 `content` **数组**：`[{id,name,type,level,stage,status,detail,items}]`；
- 同时写 `contentSummary`：`status` / `model` / `rulesFile` / `fail` / `warn` / `skip` / `disabled`；
- `qc-report.md` 写入「## 内容检查」表，列为 **ID、规则、级别、状态、说明**；
- 内容 FAIL 计入总体 `WARN` 并在汇总标「**内容 FAIL（渲染前需改）**」，但**不改变 qc 的视觉退出码**——画面/字幕的硬 FAIL 才决定退出码。

### 渲染前内容门

```bash
stickman render --project examples/sample-story --content-gate
```

`--content-gate` 在渲染前跑 `lint --stage render`：C17 等 render 规则生效，有 FAIL 就中止渲染。**默认关闭**，旧示例不加这个参数照常渲染 16:9 和 9:16。

## 10. 推荐顺序

1. 改 `script.json`，每镜写 `point` 和 `beat`；
2. `stickman research --project <dir>` 核查数字/事实说法，改掉有出入的表达；
3. `stickman lint --project <dir>` 看结构、五段节奏和 C01–C26；
4. 内容有 FAIL/WARN 就改稿，再跑一遍；
5. TTS / render（需要更严时加 `--content-gate`）；
6. `stickman qc ... --script <dir>/script.json` 跑画面、字幕和全量内容规则；
7. 内容规则和 LLM 判断只作建议，最终仍要人工看一遍片子。

## 11. 测试与回归

```bash
npm test          # node:test：每条 builtin 正反用例、v2 示范 9 镜、C20–C26、规则校验、LLM mock
npx tsc --noEmit  # 类型检查
```

`test/fixtures/style-guide-demo.json` 是 v2 第四节示范改写的 9 镜：结论「稿子里每条都是我这周干过的。」，行动「现在打开备忘录，先记一条今天的。」，镜 6 为 17 字信息句，镜 3 保留【待补】。断言：C17 draft PASS / render FAIL；C02 信息句不超额度 PASS；无 C20；C11/C12 PASS；C18 无 research 时 SKIP，其余 C 规则 PASS。

另有针对性单测覆盖 C12 空问 FAIL / 具体问 WARN、C20 分行体、C21 超额度、C22–C26。

> `examples/sample*` 是 v1 规范落地前的旧样片（`beat` 仍是自由文本，文案也含旧腔调）。用 v2 的 `npm run lint:examples` 会对部分旧样片报 C 规则 FAIL，这是预期的存量差异；不要为了让旧样片过检去改渲染默认路径。新稿从 `test/fixtures/style-guide-demo.json` 和本文五段模板起步。
