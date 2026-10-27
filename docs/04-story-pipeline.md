# 04 · 故事片管线目标（2026-10-27）

主人明确：不要「左标题 + 右小人比划」的固定 PPT 片；要做成**有背景、有场景、有表演**的短故事片。文案不同 → 分镜与画面应不同。

## 目标形态（仍本地 Remotion + edge-tts）

1. **分镜随文案**：旁白/剧情 → 镜头表（场次、景别、角色、动作、对白/旁白、背景）
2. **多场景背景**：室内/室外/办公室等 SVG 或简易场景层（可换色板），不是纯网格底
3. **表演**：走位、进出场、指向物体、对话站位（双人）、情绪姿态；不是单人右下角循环
4. **景别变化**：全景 / 中景 / 近景（缩放 + 裁切），避免每镜同一构图
5. **质量门**：一切 2–4s；主画面静止 ≤2.5s；镜头认领旁白句；3 秒内出现主体

## 首版范围（sample-story，约 20–25s）

- 一个迷你故事（例：主角想用云端 → 卡住 → 改本地 → 出片庆祝）
- 3–4 个场景背景（办公室桌、云端排队墙、本机工作台、成片舞台）
- 1–2 个火柴人角色 + 简单道具（显示器、云图标、本机）
- 布局模式：`wide`（全景走位）/ `medium`（角色+道具）/ `close`（表情/手势）
- 仍 Edge TTS 旁白；先不做口型

## 非目标（首版不做）

- 真人手绘 / 生成式视频模型
- Whisper 口型
- 复杂 AE 级转场

---

## 实现摘要（首版，2026-10-27）

### schema 字段（`src/types.ts`）

新增类型，`Shot` / `Script` 保持向后兼容（旧字段全部变可选，旧 JSON 不用改）：

| 类型 | 取值 / 说明 |
|---|---|
| `Framing` | `"wide"`（全景走位）/ `"medium"`（中景角色+道具）/ `"close"`（近景表情手势） |
| `SceneId` | `"office"` / `"queue"` / `"desk"` / `"stage"` |
| `PropId` | `"monitor"` / `"cloud"` / `"laptop"` / `"clapper"` / `"progress"` |
| `CastMember` | `id, x(0–1), y?(0–1, 默认脚底 0.78), scale?, pose, action?, facing?, color?` |
| `CastAction` | `enter-left` / `enter-right` / `exit-left` / `exit-right` / `walk-to` / `none` |
| `ShotProp` | `id, x(0–1 中心), y(0–1 底边), scale?, appearAt?(镜内秒)` |

`Shot` 新增：`scene?` `framing?` `cast?` `props?` `caption?`；旧字段 `heading` `bullets` `pose` 保留可选，`duration` / `beat` / `motion` 共用。
`Script` 新增：`mode?: "card" | "story"`（缺省自动推断）与 `ttsRate?: string`。

模式判定：`resolveMode()` —— 显式 `mode` 优先；否则任一镜 `isStoryShot()`（`scene` 存在且 `cast` 非空）即按 `story` 渲染；否则 `card`。
`normalizeScript()` 会补默认值、过滤非法枚举，两套旧样片行为不变。

### 背景 id（`src/components/Backgrounds.tsx`）

纯 SVG，1280×720 设计坐标，`preserveAspectRatio="xMidYMid slice"`：

- `office`：房间墙板线 + 窗 + 地板 + 桌子 + 挂钟
- `queue`：竖条排队墙 + 「WAIT」挂牌 + 虚线队线 + 地面箭头
- `desk`：本机工作台（显示器轮廓 + 桌面 + 键盘 + 墙插线缆）
- `stage`：舞台地面 + 幕布褶 + 两道聚光 + 星星

色板 `StoryPalette`（`ink / bg / accent / muted / soft / ground / deep`）在 `src/StickmanVideo.tsx` 的 `STORY_PALETTE` 里统一定义，可整体换色。故事模式不再铺纯网格底。

### 组件路径

| 文件 | 职责 |
|---|---|
| `src/components/Backgrounds.tsx` | 4 套场景背景 + `STAGE_W/STAGE_H` + `StoryPalette` |
| `src/components/Props.tsx` | 5 种道具（`PROP_METRICS` 设计尺寸；`progress` 用 `elapsed` 做轻微爬升/循环点亮） |
| `src/components/StoryStage.tsx` | 故事单镜：背景 → 道具（`appearAt` 后 10 帧淡入）→ 角色走位；景别缩放；整镜淡入 9 帧 / 淡出 9 帧；**不画左侧标题/要点** |
| `src/components/StickFigure.tsx` | 新增 `facing`（水平翻转）与 `autoEnter`（舞台接管走位时关掉自带的滑入/淡入）；旧 `SceneCard` 调用不受影响 |
| `src/StickmanVideo.tsx` | 逐镜分发：故事镜 → `StoryStage`，否则 → `SceneCard`（`heading` 缺省 `""`）；网格只在 card 模式铺 |

景别实现：`wide` 1.0、`medium` 1.25（焦点 y≈0.62）、`close` 1.55（焦点 x≈0.44 / y≈0.58），整层 `scale` + 焦点平移到画心，另有 1.5%–3% 轻推近。

走位实现（`castX()`）：`enter-*` 前 12 帧从画外缓动到位；`walk-to` 14 帧从旁侧走入；`exit-*` 末 10 帧滑出；走位期间强制 `pose=walk`，走完回到原 pose。

字幕：优先全局 `captions`（TTS 时间轴）按时间取；没有则回退 `shot.caption ?? narration[i]`。

### 试跑命令

```bash
npm run build:sample-story        # → out/sample-story.mp4
node scripts/render.mjs --project examples/sample-story
```

样片脚本 `examples/sample-story/script.json`：`mode: "story"`，7 句 / 7 镜，`ttsRate: "-18%"`，显式 `duration`（排程仍以 `public/sample-story-captions.json` 为准）。当前实测：旁白约 20.5s，成片约 20.6s（`out/sample-story.mp4`）。
分镜：office/wide → office/medium → queue/wide → queue/close → desk/medium → desk/medium → stage/wide；第 3 镜带 `npc`（灰色）双人排队。

`scripts/render.mjs` 的 `scenesMeta` 对故事镜额外输出 `label`（`scene/framing`），`heading` 缺省 `""`，时间轴规则与 `src/metadata.ts` 完全一致（captions 1:1 → 1 句 1 镜）。
