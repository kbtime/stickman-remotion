# stickman-remotion

极简可用的火柴人讲解视频工程：**Remotion 本地逐帧渲染** + **edge-tts 中文旁白** + **按字数比例对齐的字幕**。
不依赖 Gemini、Google Flow 或任何云端视频生成，全程离线成片。

火柴人是 `src/components/StickFigure.tsx` 里用 SVG 现画的（圆头 + 躯干 + 四肢），没有复制任何第三方素材图。

## 依赖

| 依赖 | 版本 / 说明 |
|---|---|
| Node.js | **20+**（本工程用 npm，不要用 pnpm） |
| FFmpeg / ffprobe | 读取音频时长、可选转码 |
| edge-tts | **>= 7.3.1**（7.2.8 及更早会因微软 Sec-MS-GEC 返回 403）；`pip install --user --break-system-packages 'edge-tts>=7.3.1'`（或 `pipx install edge-tts`） |

检查：

```bash
node -v
ffprobe -version | head -1
edge-tts --list-voices | grep zh-CN
```

## 安装

```bash
cd dev/stickman-remotion
npm install
```

## 试跑

```bash
# 竖屏故事样片（9:16，720×1280，复用 sample-story 分镜，站位收窄到中间）
npm run build:sample-story-portrait   # → out/sample-story-portrait.mp4

# 同一条 sample-story 临时切竖屏（不改 script.json，命令行覆盖）
npm run build:sample-story-916        # → out/sample-story-9x16.mp4

# 德鲁克「成效 vs 效率」故事样片（新，7 镜，目标 22–26 秒）
npm run build:sample-drucker    # → out/sample-drucker.mp4

# 故事样片（新，有场景/景别/走位，目标 20–25 秒）
npm run build:sample-story     # → out/sample-story.mp4

# 短卡片样片（左标题 + 右小人，目标 18–25 秒）
npm run build:sample-short     # → out/sample-short.mp4

# 旧的长样片（保留作对照，约 47 秒）
npm run build:sample           # → out/sample.mp4
```

这条命令会依次做：

1. 读 `examples/<项目>/script.json` 的 `narration`
2. 调用 edge-tts 合成整条旁白 → `public/<项目>-narration.mp3`
3. 用 `ffprobe` 拿总时长，按每句字数比例分配 `start/end` → `public/<项目>-captions.json`
4. 调用 Remotion 渲染 → `out/<项目>.mp4`，并打印输出路径

`build:sample-short` / `build:sample-story` / `build:sample-story-portrait` / `build:sample-drucker` 走的是同一条链路，项目目录换成对应的 `examples/<项目>`，产物是 `out/<项目>.mp4`。`build:sample-story-916` 是「同一个项目临时切竖屏」的例子：追加 `--aspect 9:16`，产物是 `out/sample-story-9x16.mp4`。

五个样片的分工：

| 样片 | 渲染模式 | 画幅 | 画面 | 用途 |
|---|---|---|---|---|
| `examples/sample` | card | 16:9 | 左标题 + 右小人，长讲解 | 改进前对照 |
| `examples/sample-short` | card | 16:9 | 左标题 + 右小人，一句一镜 | 纯口播卡片样片 |
| `examples/sample-story` | story | 16:9 | 场景背景 + 景别 + 走位 + 道具 | 故事片首版 |
| `examples/sample-story-portrait` | story | 9:16 | 同一批分镜，站位收窄、道具缩小 | 竖屏/短视频版 |
| `examples/sample-drucker` | story | 16:9 | 满格清单墙 / 客户缺口分区 / 左右分屏 / 透视目标墙 + `theme:"slate"` 冷灰蓝 | 德鲁克「成效比效率重要」故事样片 |

同一份代码两条渲染路径：**镜里有 `scene` 且 `cast` 非空 → `StoryStage`**，否则回落到旧的 `SceneCard`，两套可以在一条片子里混用。

想看交互式预览（改代码即时刷新）：

```bash
npm run studio
```

再单独重出旁白：

```bash
npm run tts -- --project examples/sample
```

## 画幅：16:9 横屏 / 9:16 竖屏

同一份分镜可以出两种画幅，**坐标全是相对实际画布的 0–1 比例**，换画幅不用改分镜。

| 画幅 | 分辨率 | fps | 用途 |
|---|---|---|---|
| `16:9`（默认） | 1280×720 | 30 | B 站 / YouTube / 横屏播放 |
| `9:16` | 720×1280 | 30 | 抖音 / 视频号 / 小红书 |

> 分辨率固定为上面两种，不做任意尺寸自适应：竖屏 720 宽配中文大字足够，成片体积也小。

### 用 JSON 指定

```jsonc
{
  "title": "竖屏故事样片",
  "mode": "story",
  "aspect": "9:16",        // 优先：写 aspect 就按它的分辨率来
  "narration": ["..."],
  "shots": [ /* 同一份分镜 */ ]
}
```

- 写 `aspect` → 直接用 `ASPECT_SIZE` 里的宽高（`16:9` = 1280×720，`9:16` = 720×1280），`width`/`height` 被覆盖；
- 不写 `aspect`、只写 `width`/`height` → 保留你给的尺寸，画的横竖比例决定 `wide` / `tall` 布局；
- 都不写 → 默认 16:9 / 1280×720。

### 用命令行覆盖

```bash
# 把任意项目临时切成竖屏，不改 script.json
node scripts/render.mjs --project examples/sample-story --aspect 9:16

# 指定输出文件
node scripts/render.mjs --project examples/sample --aspect 9:16 --out out/demo-9x16.mp4
```

优先级：**`--aspect` > `script.aspect` > `script.width/height` > 默认 16:9**。渲染日志会打印最终画幅，例如：

```
[render] 画幅 9:16 → 720×1280（CLI --aspect）
```

默认输出文件名：

| 情况 | 输出 |
|---|---|
| 横屏项目 | `out/<项目>.mp4` |
| 竖屏项目（script.json 里就是 9:16） | `out/<项目>.mp4` |
| 横屏项目 + CLI 指定 `--aspect 9:16` | `out/<项目>-9x16.mp4` |

### 竖屏下坐标怎么算

- 角色：`x * 画布宽`、`y * 画布高`；没写 `y` 时脚底默认 **横屏 0.78 / 竖屏 0.82**（底边留给字幕）；
- 角色高度：约 `0.42 × 画布高 × scale`，宽屏时再限制不超过 `0.55 × 画布宽`，所以竖屏人物够大、横屏也不会顶破；
- 道具：显示尺寸 = 设计尺寸 × `min(画布宽, 画布高) / 720` × `prop.scale`，竖屏不会把道具放大成怪物；
- 背景：SVG `viewBox` 直接等于画布尺寸，所有场景按宽高比例重画（窗在 `0.68W`、地板从 `0.78H` 起），竖屏铺满、不拉伸；
- 景别：`wide` / `medium` / `close` 的 zoom 在竖屏下单独调小（1 / 1.16 / 1.38，close 焦点上移到 0.55H），避免半截人。

### 竖屏注意事项

- **站位往中间收**：竖屏宽度只有高度的 56%，双人镜别再用 `x: 0.32` + `x: 0.68`，改成 `0.36` + `0.64`，或前后错开 `y`（例如 0.8 / 0.84）做出层次；
- **x 建议落在 0.3–0.7**，超出就会被门/墙的边缘挡住或者走出画面；单人镜居中略偏（0.45–0.55）最稳；
- **道具要减量**：竖屏一屏放不下并排三个道具，一镜 1–2 个为宜，`scale` 顺手调小到 0.7–0.85，避免和人物抢空间；
- **字幕带**：竖屏字幕在底部 36px 位置、最多两行，人物脚底尽量别低于 `y: 0.85`，否则会被字幕压住；
- **card 模式**：竖屏自动切「上标题 / 下火柴人」纵向堆叠，字号按 720 宽缩放，底部同样留了字幕带；横屏仍是左右布局；
- **近景（close）**：竖屏 close 是整层放大 1.38 倍，角色写 `x` 太靠边会被裁，close 镜请把人物放 0.45–0.55。

## 换主题

复制一份项目目录，改 `script.json` 即可：

```bash
cp -r examples/sample examples/my-topic
```

```jsonc
{
  "title": "视频标题",
  "fps": 30,              // 可选，默认 30
  "aspect": "16:9",       // 可选：16:9（1280×720）| 9:16（720×1280）；写了就覆盖宽高
  "width": 1280,          // 可选，只在没写 aspect 时生效，默认 1280
  "height": 720,          // 可选，只在没写 aspect 时生效，默认 720
  "narration": [
    "第一句旁白。",
    "第二句旁白。"
  ],
  "shots": [
    {
      "heading": "镜头标题",        // 大字
      "bullets": ["要点一", "要点二"], // 可选
      "pose": "point",              // idle | point | think | wave，可选
      "duration": 3.5               // 可选：显式指定该镜头秒数
    }
  ]
}
```

```bash
node scripts/render.mjs --project examples/my-topic
```

### 故事片（story）分镜字段

把 `mode` 设成 `"story"`（或让任一镜带 `scene` + `cast`，会自动识别），shot 换成这套：

```jsonc
{
  "title": "故事标题",
  "mode": "story",
  "theme": "warm",            // warm（默认暖灰纸感）| slate（商业冷静灰蓝，禁砖红）
  "ttsRate": "-5%",
  "narration": ["我想快出一条火柴人片。", "先丢给云端生成。"],
  "shots": [
    {
      "scene": "meeting",         // office | queue | desk | stage | meeting
                                  // | busy-desk | customer-gap | split-board | priority-room（德鲁克样片专用）
      "framing": "wide",          // wide 全景 | medium 中景 | close 近景
      "duration": 3.1,            // 仅参考；有 captions 时 1 句 1 镜
      "beat": "主角走进办公室",      // 分镜表用，渲染忽略
      "motion": "从左侧快步走入",     // 分镜表用，渲染忽略
      "caption": "我想快出一条火柴人片。", // 本镜字幕；不填用 narration[i]
      "cast": [
        {
          "id": "hero",           // 角色 id，双人时区分
          "x": 0.32,              // 0–1 设计坐标（相对画面宽）
          "y": 0.8,               // 0–1，脚底位置，默认 0.78
          "scale": 1,             // 角色大小，默认 1
          "pose": "walk",         // 同 card 模式的八种 pose
          "action": "enter-left", // enter-left|enter-right|exit-left|exit-right|walk-to|none
          "facing": "right",      // left 时水平翻转
          "color": "#1D1D1B"      // 可选，双人换色区分
        }
      ],
      "props": [
        { "id": "board", "x": 0.64, "y": 0.56, "scale": 1, "label": "成效" }
        // id: monitor | cloud | laptop | clapper | progress | board
        //   | spreadsheet | checklist | customer | label-speed | label-effect | goal-card
        // x/y 是道具的水平中心 / 底边（0–1）；appearAt 是镜内秒
        // label：道具上的文字（board 白板标题，默认「成效」；goal-card 目标卡标题）
        // side: left | right —— split-board 分屏时跟随 splitFocus 淡化
        // dim: true —— 手动压暗的次要道具
      ]
    }
  ]
}
```

### 德鲁克专用场景与分屏对比

`busy-desk`（整面清单/表格墙 + 办公桌 + 纸堆）、`customer-gap`（左表单已满 / 右客户问题未解的缺口分区）、`split-board`（中间竖分割线的左右对比墙，左「效率」右「成效」）、`priority-room`（深透视目标墙 + 前景大卡片槽）只给德鲁克样片用，旧场景不受影响。仅 `split-board` 可写镜头级 `splitFocus: "left" | "right" | "both"`：非焦点侧压暗到 32%，另一侧加钢蓝描边，用第 4/5 镜并置对比一眼看出「效率 vs 成效」。配 `theme: "slate"` 时整片换成冷灰蓝调色板（背景冷灰蓝、强调色钢蓝/墨青，不用 #E8543F 砖红），字幕条同步变冷。

story 模式不画左侧标题和要点列表；字幕优先用 `shot.caption`，其次 `narration[i]`，有 TTS 时间轴时以 `captions` 为准。

**镜头与旁白怎么对齐：**

- 镜头默认按 `captions` 顺序均分成 N 组，每个镜头占用「这一组第一句开始 → 最后一句结束」的区间，因此画面切换跟着旁白走；
- 如果所有镜头都写了 `duration`，就完全按手写时长排；
- 首镜从 0 秒开始，末镜延伸到旁白结束，画面不会提前收尾。

`pose` 有八种，每种都有明显不同的肢体目标角 + 镜内循环动作：

（card / story 共用；story 模式下 `action` 会临时接管成 `walk`，走完再回到 `pose`。）

| pose | 静态姿态 | 镜内可感知动作 |
|---|---|---|
| `idle` | 自然站立 | 双臂明显来回摆动（不靠呼吸） |
| `walk` | 迈步前倾 | 左右腿交替迈步 + 身体水平位移约 50px |
| `point` | 右臂近水平指向 | 指尖弹跳 14° + 躯干轻微前压 |
| `think` | 手托下巴 | 轻微点头 |
| `wave` | 右手高举 | 大幅挥动（≥25°） |
| `shrug` | 双肩上抬、双手外翻 | 耸肩节奏的上下起伏 |
| `celebrate` | 双手上举 | 跳跃感（hipY 上下 18px） |
| `busy` | 上身前倾、头略低、双手在桌前 | 双手快速交替小幅上下（敲键盘感，不跳） |

换 pose 时，前 10 帧对关键关节角做插值过渡（`prevPose` → `pose`）；首镜没有上一镜，火柴人从右侧滑入 12 帧。
`beat` / `motion` 是分镜表用的可选字段（格式见 `docs/03-shot-table.md`），渲染层忽略。

## 样片对比

| | `examples/sample`（旧） | `examples/sample-short`（新） |
|---|---|---|
| 旁白 | 6 句长句，单句最长 40+ 字 | 6 句短句，每句 ≤16 字 |
| 时长 | 约 47 秒（实测 46.8s） | 显式 duration 合计 21.5s，目标 18–25 秒 |
| 镜头 | 5 镜，无显式时长，按字幕分组 | 6 镜，1 句 1 镜，每镜 3.4–3.8 秒 |
| 姿态 | 4 种（idle / point / think / wave） | 7 种轮换，相邻镜不重复：walk → point → think → shrug → wave → celebrate |
| 镜内动作 | 主要是轻微摆动 | 走动、指尖弹跳、耸肩、挥手、跳跃 |
| 转场 | 硬切 + 淡入 | 入场 8–12 帧 + 末 10 帧离场；标题先出、要点 stagger；换 pose 插值 |

旧样片**保留不动**，作为改进前对照；新短样片见 `examples/sample-short/script.json`。

## 质量门

摘自 `docs/02-storyboard-benchmarks.md`，新样片必须逐条满足（改动 `script.json` 后自查）：

- [ ] 旁白总长 **18–25 秒**（口播短句，一句一事）
- [ ] 每镜 **2–4 秒**
- [ ] 同一 pose 连续占用 **≤2.5 秒**（相邻镜换 pose）
- [ ] 字幕块中文 **≤16 字**，一句一条字幕
- [ ] 镜数 ≈ 旁白句数（1 句 1 镜）
- [ ] 每镜有**可感知动作**（走动、挥手幅度、指向弹跳、跳跃），禁止仅靠呼吸假动
- [ ] 镜头**入场 8–12 帧 + 离场**，标题/要点 stagger，换 pose 有插值

故事片（`examples/sample-story` 这类）额外要求：

- [ ] **必须换场景**：相邻两镜不要停在同一 `scene`（首版只有 4 套背景，至少交替用 3 套）
- [ ] **必须换景别**：`wide` / `medium` / `close` 轮换，禁止全程同一构图（`wide` 走位、`medium` 角色+道具、`close` 表情手势）
- [ ] 每镜有**明确走位或道具变化**（`enter-*` / `walk-to` / `exit-*` / 道具 `appearAt`），不能全程站定
- [ ] 主画面静止 **≤2.5 秒**（景别有轻微推近，角色有 pose 循环动作）
- [ ] 3 秒内出现主体：首镜主体要在开场 12 帧内进入画面
- [ ] 故事片台词短句同样 **≤16 字**，镜数 = 句数

## 换自有音频

用你自己的 wav / mp3 / m4a 覆盖旁白（TTS 会被跳过，只重新计算字幕时间轴）：

```bash
node scripts/tts.mjs --project examples/sample --audio /path/to/voice.mp3
node scripts/render.mjs --project examples/sample
```

或者一步到位：

```bash
node scripts/render.mjs --project examples/sample --audio /path/to/voice.mp3
```

注意：自备音频里的**句子顺序和数量**必须与 `narration` 一致，因为字幕是按字数比例切的。

常用参数：

```bash
# 换音色 / 语速
node scripts/tts.mjs --project examples/sample --voice zh-CN-YunxiNeural --rate "+5%"

# 强制重出旁白（默认已有音频就跳过）
node scripts/render.mjs --project examples/sample --force-tts

# 指定输出文件
node scripts/render.mjs --project examples/sample --out out/demo.mp4
```

产物命名规则：`public/<项目目录名>-narration.mp3` 和 `public/<项目目录名>-captions.json`，多个项目互不覆盖。

## 目录结构

```
stickman-remotion/
├── docs/01-dissection.md        # 原始需求拆解（只读）
├── docs/02-storyboard-benchmarks.md  # 分镜对标与硬规则
├── docs/03-shot-table.md        # 分镜表格式（heading/beat/pose/motion/duration）
├── examples/sample/script.json  # 旧样例脚本（约 47s，保留作对照）
├── examples/sample-short/script.json  # 短卡片样片脚本（约 21.5s）
├── examples/sample-story/script.json  # 故事样片脚本（7 镜，约 22.5s）
├── examples/sample-drucker/script.json  # 德鲁克「成效比效率重要」故事样片（7 镜，约 23s）
├── examples/sample-story-portrait/script.json  # 竖屏 9:16 版（复用 sample-story 分镜）
├── public/                      # TTS 产物（运行时生成，已在 .gitignore）
├── out/                         # 渲染输出
├── scripts/
│   ├── tts.mjs                  # edge-tts + ffprobe + 字幕时间轴
│   └── render.mjs               # 一键 TTS + render
└── src/
    ├── index.ts                 # registerRoot
    ├── Root.tsx                 # Composition "StickmanVideo"
    ├── metadata.ts              # 时间轴计算（镜头 / 时长）
    ├── StickmanVideo.tsx        # 主成片
    ├── types.ts
    └── components/
        ├── SceneCard.tsx        # card 模式：标题 + 要点 + 火柴人
        ├── StoryStage.tsx       # story 模式：背景 + 景别 + 道具 + 走位
        ├── Backgrounds.tsx      # 9 套纯 SVG 场景（旧 5 套 + 德鲁克 4 套）
        ├── Props.tsx            # 12 种 SVG 道具（旧 6 种 + 德鲁克 6 种）
        ├── StickFigure.tsx      # SVG 火柴人（8 种 pose + 插值过渡 + facing）
        └── Caption.tsx          # 底部字幕条
```

## 已知限制

- **字幕是按字数比例估时间的，不是强制对齐。** 时间按「音频总时长 + 每句字数比例」估算，句内停顿与语气词会让个别 cue 早到或晚到 0.2–0.5 秒。需要像素级准确时可接 Whisper / 其他强制对齐工具（可选，默认不装），替换 `captions.json` 即可，渲染层不需要改。
- **字幕 cue 是单句一条**，没有做长句自动折行分组；一行超过约 26 个汉字会被 CSS 截断成两行（`-webkit-line-clamp: 2`），更长的句子会被裁掉。
- **edge-tts 需要联网**（微软在线语音服务）。自备音频（`--audio`）可完全离线渲染。
- **火柴人是极简 SVG，程序化画出来的**，没有 B1 手绘素材，也没有 pose sheet；`point` / `think` 的手部是角度近似，不保证手正好贴在脸上。
- **动画已有 pose 插值 / 走动 / 挥手**：7 种 pose 各有独立目标角和镜内循环动作，换 pose 有 10 帧关节角插值。但仍是关节角程序化驱动，没有 IK、没有手绘分镜关键帧，复杂手势（握物、指代多个对象）做不了。
- **旧长样片仍保留作对照**：`examples/sample` 约 47 秒、无显式 `duration`、仅 4 种 pose，质量门不覆盖它；新短样片见 `examples/sample-short`（约 21.5 秒）。
- **镜头切换是淡入淡出 + 走位**，没有转场特效、跟拍运镜、音效和背景音乐；故事片只有轻微推近（`wide` 3%、其余 1.5%），没有真正的镜头运动。
- **`beat` / `motion` 字段仅作文档**，渲染层不解析；镜内动作由 `pose` 与 story 的 `action` 决定，想加新动作要改 `StickFigure.tsx`。
- **故事片首版只有 4 套背景、5 个道具（德鲁克样片另有 4 套场景 + 6 个道具）**，角色没有手持道具的 IK，道具是独立图层摆在旁边；`close` 景别是整层放大，靠近边缘的角色/道具会被裁切，写分镜时把焦点放在画面中部（竖屏 close 尤其明显）。
- **画幅只支持 16:9（1280×720）与 9:16（720×1280）两种**，都是 30fps；不做 1:1、4:5 或自定义尺寸的版式适配。竖屏虽然已经按画布比例重画了背景/角色/道具/字幕，但双人镜、并排多道具仍偏挤，写分镜时要遵守上面的「竖屏注意事项」。
- 中文字体依赖系统字体（`Noto Sans SC` / `PingFang SC`）。Linux 上若无中文字体，字会显示成方框，请先 `apt install fonts-noto-cjk`。
- 没有做分段缓存：改一个字也会整天重渲（对几十秒的短片无所谓）。
- **不要依赖 Gemini Omni Flash**，本工程的成片链路与它无关。
