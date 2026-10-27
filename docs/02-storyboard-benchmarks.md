# 02 · 高星分镜 Skill 对标（2026-10-27）

## 对标仓库（已核实 stars）

| 仓库 | Stars | 类型 | 可借鉴点 |
|---|---|---|---|
| [eternityspring/shuohao-skills](https://github.com/eternityspring/shuohao-skills) | ~5505 | AI 短剧 Skill | 段≤15s → **切镜 2–5s 硬门**；镜头认领节拍；脚本校验质量门 |
| [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) | ~3420 | AI 短剧/漫剧 Skill | `## SHOT-...` + 冻结关键帧；连续性边界；先分镜后生产 |
| [Vincentwei1021/anything2explainer](https://github.com/Vincentwei1021/anything2explainer) | ~2779 | Remotion 讲解 Skill | 先旁白后分镜；空行=镜头；字幕≤16字；**静止≤3s**；末拍稳定 1–1.5s；持续动作不许假呼吸凑数 |
| [EveryInc/product-launch-video](https://github.com/everyinc/product-launch-video) | ~33 | Remotion 产品片 | Storyboard first；3 秒内出主体 |
| 原 stickman B Autopilot | — | 本地火柴人 | voice-led；主画面 idle **≤2.5s**；keys 插值 |

## 落到 stickman-remotion 的硬规则（短样片）

1. 旁白总长目标 **18–25 秒**（口播短句，一句一事）
2. 每镜 **2–4 秒**（对标短剧 2–5s；讲解类允许略长但单镜仍 ≤4s）
3. 同一 pose 连续占用 **≤2.5s**；镜内必须有可感知动作（挥手幅度、指向弹跳、走动一步、道具进出），禁止仅靠呼吸假动
4. script 结构：`narration[]` 短句 + `shots[]` 数量 ≈ 旁白句数（1 句 1 镜或 1 句拆 2 镜）
5. 字幕块中文 ≤16 字；优先一句一字幕
6. 姿态库至少扩到：idle / walk / point / think / wave / shrug / celebrate（或同等可感差异）
7. 镜头切换：入场 8–12 帧 + 离场；标题/要点 stagger；右侧火柴人换 pose 有插值过渡
8. 文档写清分镜表格式（heading / beat / pose / motion / duration）
