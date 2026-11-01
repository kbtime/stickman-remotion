# 火柴人 Skill（skill-1793110272897）更新草稿

> 草稿，未改动 SKILL.md。合并 PR 后再由主人/主 Agent 决定是否套用。

## 1. 简介句替换
- 原：「Remotion + edge-tts + 按字数比例字幕」
- 改：「Remotion + edge-tts WordBoundary 帧精确字幕（自备音频时回退按字数比例）」

## 2. CLI 段新增
```bash
stickman render --project examples/<slug> --preview 15s   # 只渲前 15 秒，先确认风格
stickman render --project examples/<slug> --aspect 9:16 --preview 15s
stickman qc --video out/<slug>.mp4 --captions public/<slug>-captions.json   # 量化 QC
stickman qc --video out/<slug>-preview.mp4 --captions public/<slug>-captions.json --preview
```
- `--preview` 接受 `30s` / `15` / `10.5s`；未给 `--out` 时输出 `out/<slug>[-9x16]-preview.mp4`。

## 3. 字幕时间轴说明（新增小节）
- 默认 TTS 走 `scripts/edge_tts_boundary.py`（edge_tts 库，boundary="WordBoundary"），逐词边界匹配回 narration 每句，再量化到帧（script.fps，默认 30）。
- captions.json 新字段：`alignment`（`edge-wordboundary` / `proportional`）、`fps`、每条 `startFrame`/`endFrame`/`words`。
- 自备音频 `--audio` 或词边界匹配失败 → 回退字数比例分配，`alignment: "proportional"` 并打印警告。改了旁白后要 `--force-tts`。

## 4. 流程里加两步
- 分镜写好后先 `--preview 15s` 渲一段给用户看风格，确认后再整片渲染。
- 成片后必跑 `stickman qc`：报告在 `qc/<slug>/qc-report.md|json`，FAIL 时退出码 1。检查项：黑帧（≥0.5s FAIL）、空镜（≥1.5s WARN）、主角高度占比（中位数 25–85%）、字幕条安全区（左右 ≥5%、底 ≥3%）、字幕停留（<1.0s FAIL、<1.5s 或 >7s WARN、>8 字/秒 WARN、重叠 FAIL）、视频与字幕时长差。
- 交付时附 QC 结论；有 FAIL 先修再交。

## 5. 质量门自查补充
- 用 QC 报告替代部分人工自查（字幕时长、安全区、黑帧）；画面创意/表演仍需人工看。
- 踩坑见仓库 `reference/lessons.md`。
