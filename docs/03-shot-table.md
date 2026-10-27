# 03 · 分镜表格式（heading / beat / pose / motion / duration）

短样片（`examples/sample-short`）用一行一镜的分镜表驱动，字段与 `Shot` 类型一一对应：

| 字段 | 说明 | 示例 |
|---|---|---|
| `heading` | 镜内大字标题，短（≤6 字为宜） | `按回车就渲` |
| `bullets` | 1–2 条要点，按 4–6 帧 stagger 入场 | `["零云端依赖", "不用等审核"]` |
| `pose` | 火柴人姿态：`idle` / `walk` / `point` / `think` / `wave` / `shrug` / `celebrate` | `point` |
| `beat` | 这一镜的叙事节拍（仅文档，渲染忽略） | `指向本机，强调立刻开跑` |
| `motion` | 镜内可感知动作（仅文档，渲染忽略；实际动作由 pose 决定） | `右手水平指向，指尖上下弹跳 14°` |
| `duration` | 镜头秒数，2–4 秒；全镜显式写出时按手写时长排轴 | `3.6` |

约束：镜数 ≈ 旁白句数（1 句 1 镜）；相邻镜避免同 pose（同一 pose 连续 ≤2.5s）；每镜都要有可感知动作，禁止只靠呼吸。
