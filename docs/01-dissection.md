# 01 · 原火柴人视频 Skill 拆解

来源（只读）：`dev/stickman-video-director/skills/directing-stickman-videos/`

## 1. 原 Skill 概览（A Director / B Autopilot）

同一个安装、两个互不继承的制作契约：

| | A · Director | B · Autopilot |
|---|---|---|
| 交付物 | Phase A 导演提案 + Phase B 的 N 条独立 Gemini Omni Flash 提示词 | 可直接播放的本地成片：旁白 + 字幕 + 插画 + 微动画 + SFX |
| 产出方式 | 云端文生视频，每条约 10 秒，N = 时长/10 | 本地声明式 `project.json` → 逐帧绘制 → FFmpeg 拼接 |
| 视觉约束 | 严格的 5 阶段叙事、3 拍节奏、≥4 视觉装置、禁屏显文字、色彩锚点等 | 由所选 B 风格（当前仅 B1）自己定义视觉/字幕/声音 |
| 审批 | Phase A 必须显式批准后才出提示词 | 先出约 20 秒样片，用户显式 `approve` 后才能全片 |
| 关键区别 | 强确定性流程（gate 不可被“赶时间”豁免） | 强质量门（禁 idle > 2.5s、voice-led timing） |

SKILL.md 明确：A 的十秒片段规则、无文字规则、Phase B 流程**不得**用于 B。`style` 目前运行时只接受 `B1`。

## 2. A 模式依赖

- **Gemini Omni Flash 视频生成**：Core contract 直接锁定 ~10 秒片段、720p、24 FPS、带同步音频。所有角色/调色/声音锁都写进提示词（`omni-flash-prompt-contract.md` 12 段顺序）。
- **联网**：生成必须调用外部模型；提示词要求逐条自包含、重复完整角色锚点与完整 voice block（防漂移）。
- **审批门（两段式）**：
  1. Setup gate：来源、比例（16:9/9:16）、时长（10 秒倍数）、风格/主题缺一不可，缺则一次性问全并停止。
  2. Phase A 批准：出提案（标题、核心信息、比例、voice profile、调色、BGM、N 行分镜表）→ 停 → 显式批准后才读 `omni-flash-prompt-contract.md` 出 Phase B。
  3. 任何全局变更（比例/时长/风格/旁白/结构）→ 提案失效，重做并重新批准。
- **风险点**：文本一致性只是“visual acceptance check”，不是保证；需要人工回看连拍帧。

## 3. B 模式依赖

- **本地渲染**：`@napi-rs/canvas`（唯一 npm 依赖，0.1.100）+ Node ≥ 20 + FFmpeg/FFprobe（`FFMPEG`/`FFPROBE`/`AUTOPILOT_FONT` 可用环境变量覆盖）。
- 流程：`painter(p)` 返回 `frame(t)` → 每个 shot 用 rawvideo 管道喂 `libx264` → concat → `adelay` 原速旁白 + 程序化 SFX（tap/paper/pop/chime）+ 可选 music → amix + alimiter → 校验全解码 → SRT/VTT + contact sheet + report。
- **缓存**：每个 shot 按内容哈希（layers、字幕重叠、字体、renderer 哈希）缓存 mp4，命中先 probe 帧数；`checkpoint.json` 记录 stage。
- **可选 Gemini API**（`gemini-media.mjs`）：`speech`（PCM→WAV，指定预置音色）与 `image`（原生 image payload，可 `--reference` 上传角色图）。硬约束：必须 `--allow-network`、必须有 `GEMINI_API_KEY`、一次请求不重试、先写 `.request.json` 收据、拒绝 `--direction`。
- **可选 Whisper**：`align_captions.py` 用已缓存的 openai-whisper 词级时间戳；下载模型需显式 `--allow-model-download`。
- 离线可跑：`examples/b1/project.json` 使用内置旁白与手绘素材，无需任何联网。

## 4. 必须联网 vs 可本地替换

| 环节 | 原状态 | 可否本地替换 |
|---|---|---|
| A 片段生成 | Omni Flash，必须联网 | ✗ 概念上必须替换为本地渲染器 |
| B 画面合成 | 已本地（canvas + FFmpeg） | ✓ 直接换 Remotion |
| 旁白 TTS | 默认 Gemini Bodi，可选 | ✓ edge-tts / 本地模型（注意：不能靠变声速适配画面） |
| 插画生成 | 可选 Gemini image | ✓ 手绘素材/本地图像/SVG |
| 字幕对齐 | Whisper（本地，可选） | ✓ 任何强制对齐工具；也接受已给词时间戳 |
| 依赖检查 `doctor` | 纯本地 | ✓ |
| 审批/指纹 | 纯本地哈希 | ✓ |

原则：B 的“质量门”大多与网络无关，真正不可本地化的是 A 的模型生成。

## 5. 可复用的分镜/旁白结构

`project.json`（manifest v1）结构：

```json
{
  "version": 1, "style": "B1", "width": 1280, "height": 720, "fps": 30,
  "voice": {"path": "narration.m4a", "lead": 0, "tail": 0, "contains_sfx": true},
  "captions": [{"start": 0.291, "end": 2.716, "text": "..."}],
  "shots": [{"start": 0, "end": 2.85, "layers": [
     {"type": "text", "text": "YOUR CHANNEL.", "x": 95, "y": 110, "size": 58, "bold": true},
     {"type": "pose", "pose": 1, "x": 720, "y": 35, "w": 445},
     {"type": "image", "path": "@b1/youtube-crayon.png", "x": 120, "y": 300, "w": 270,
      "keys": [{"t": 0, "x": 130, "alpha": 0}, {"t": 0.3, "x": 150, "alpha": 1}]}
  ]}],
  "sfx": [{"time": 0.3, "kind": "pop", "gain": 0.025}]
}
```

要点：
- **voice**：只有 `path/lead/tail/contains_sfx`；拒绝 `speed`。片段必须无缝覆盖 `旁白时长 + lead + tail`（误差 0.06s）。
- **captions**：按短语分组的字幕 cue，非逐词；时间用最终视频时间（含 lead）。
- **shots**：`start/end` 连续无缝隙；layer 类型 `image | pose | text | line | arrow | underline`；`from/to` 控制局部可见；`keys` 支持 `x/y/w/angle/alpha/progress`，smoothstep 插值，**不做任何肢体推断**（图是死的）。
- **坐标系**：设计宽度恒为 1280，高度 = `1280 * H / W`（9:16 ≈ 2275.56），等比缩放；底部 110 单位留给字幕。
- **5 阶段叙事（A，可复用到 B 的脚本层）**：Golden Hook → Disrupting Assumptions → Unveiling Insider Secrets → Ultimate Truth Revelation → Elevation & Discussion；按 30s/60s/90s/3–5min 分配 clip 数量。
- **voice-led timing（B 核心）**：先定旁白（一条连续轨或固定 provider/model/voice 的章节轨），再用真实语音（含自然停顿）决定镜头时长；绝不加速/减速/重合成去凑视觉计划；画面不得有超过 2.5 秒的主画面停滞；角色镜头约占直接可见时长 60–70%（B1 促销格式参考值）。

示例 `examples/b1/project.json`：约 16.4s，6 个镜头（2.85 / 1.85 / 3.2 / 2.9 / 2.25 / 3.35），9 条字幕，`contains_sfx: true` 且 `sfx: []`（已经是混音母带）。

## 6. 迁移到 Remotion + edge-tts 的映射建议

| 原实现 | Remotion 方案 |
|---|---|
| `painter(p)` + `frame(t)` | 一个 `<AbsoluteFill>` 组合：`useCurrentFrame()` 换算 `t = frame/fps`，按 `shots` 选当前 shot，逐 layer 渲染 |
| `keyState` smoothstep 插值 | 同逻辑移植为纯函数 + `interpolate(..., {easing: Easing.inOut(Easing.ease)})`，键名保持 `x/y/w/angle/alpha/progress` 兼容 |
| `image` / `pose` layer | `<Img src={staticFile(...)}>`；pose 用 sprite atlas + `objectPosition` 或裁剪 `<div>` |
| `text` layer | 复用 canvas 测量逻辑（`@remotion/layout-utils` 的 `fitText`/`measureText`）保证换行与超宽报错语义 |
| `line`/`arrow`/`underline` | SVG `<path>` + `strokeDasharray/strokeDashoffset` 表达 `progress` |
| B1 背景网格 `#FDFDFC` + 64px 网格 | 直接 CSS/SVG 背景，底部保留 110 设计单位的字幕带 |
| 字幕烧录（canvas strokeText） | `<Captions>`/`@remotion/captions`，或自绘 cue 组件（两行上限 + 安全边距） |
| `groupWords` 短语分组 | 保留为预处理脚本，输出与 `captions` 同构的 JSON |
| `align_captions.py` | 可用 `@remotion/install-whisper-cpp` 或继续用原 Python 脚本，产出词级 JSON 后交给 `groupWords` |
| 逐 shot canvas→x264→concat | `<Series>` / `<Sequence>`（或 `calculateMetadata` 从旁白时长算 duration），`npx remotion render` |
| 程序化 SFX + amix + `adelay` | `<Audio src={voice} startFrom={0} />` + `<Audio>` 每条 SFX/音乐，`volume` 对应 gain；旁白 lead 用 `trimBefore`/`startFrom` 或 offset |
| 原速旁白约束 | 用 `@remotion/media-utils` 读 WAV 时长（或 ffprobe）写入 `calculateMetadata`；不生成变速 |
| Gemini TTS | **edge-tts** 生成整条或章节轨 → WAV/MP3；固定同一 voice（如 `zh-CN-XiaoxiaoNeural`），记录 provider/voice，保留原速与自然停顿 |
| Gemini image | 手绘 PNG / SVG / 本地生成素材，`staticFile` 引入；保持角色参考一致 |
| 审批门（`approve` 记录指纹） | 保留思路：预览 20 秒样片 → 用户确认 → 再全片渲染；可用 `project.json` 哈希写 `approval.json` |
| `doctor` | 替换为检查 Node/FFmpeg/字体/edge-tts 可用性 |
| 缓存与 checkpoint | Remotion 自带渲染缓存；片段级缓存可用 `<OffthreadVideo>` 预渲染替代 |

迁移原则：
1. **数据契约优先**：继续沿用 `version/style/width/height/fps/voice/captions/shots/layers/sfx`，Remotion 只做渲染层，避免重写分镜资产。
2. **设计坐标系固定 1280 宽**，等比缩放，避免竖屏拉伸变形。
3. **voice-led**：先 edge-tts 出音轨，再生成/更新 `shots` 与 `captions`，最后渲染。
4. **保留质量门**：无 gap/overlap、字幕 ≤2 行、主画面 ≤2.5s 停滞、SFX 低于人声、批准后才全片。
5. **可离线**：全程无网络即可完成成片，网络只用于可选的素材/音色扩展。
