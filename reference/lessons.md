# 踩坑记录（lessons learned）

这份工程是「Remotion 逐帧渲染 + edge-tts 旁白 + 字幕 QC」的本地管线。下面记录的是实际踩过、并且已经写进代码的坑，改脚本前先看一遍。

## edge-tts / WordBoundary

1. **edge-tts 7 默认只返回 SentenceBoundary。**
   `Communicate(text, voice, rate=...)` 不传 `boundary` 时，流里只有整句边界；想要逐词时间轴必须显式写：
   ```python
   edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
   ```
   返回的 chunk 里 `type == "audio"` 是 mp3 数据，`type == "WordBoundary"` 才是词边界。

2. **offset / duration 的单位是 100ns，不是毫秒。**
   换算成秒要除以 `10_000_000`：
   ```python
   start = offset / 10_000_000
   end = (offset + duration) / 10_000_000
   ```
   直接当毫秒用会得到小了 10000 倍的时间。

3. **中文 WordBoundary 是“词”，不是“字”。**
   “第一句测试”通常返回 `第一` / `句` / `测试` 这样的词边界，长度不固定；不要假设一个 boundary 对应一个汉字。

4. **标点通常不会出现在 WordBoundary.text 里。**
   旁白里的“，。！？”往往被朗读但不出现在边界文本中，所以把词匹配回句子时必须先把两边的标点、空白、符号都去掉（本工程用 `\p{P}` / `\p{S}`）。

5. **`--rate=-8%` 要用 `=` 形式。**
   直接写 `--rate -8%` 时，有些命令行解析器会把 `-8%` 当成新选项。edge-tts CLI 和本工程的 `scripts/tts.mjs` 都推荐：
   ```bash
   --rate=-8%
   ```

6. **TTS 文本和 narration 的头尾标点要一致地清洗。**
   本工程把每句末尾标点去掉，再用“。”拼接整条文本；匹配时又统一去掉标点。只要两边清洗规则一致，词序列就能按字符顺序对回原句。

7. **词边界匹配失败必须能回退。**
   数字、英文缩写、emoji、TTS 内部归一化都可能让边界文本和原文对不上。匹配失败或 python 报错时，回退到「按字数比例分配」，并在 captions.json 里写 `"alignment": "proportional"`，不要让整条管线崩掉。

## 字幕时间轴

8. **字幕时间必须量化到帧。**
   Remotion 按整数帧渲染；如果 caption 的 start/end 是 3.472 秒这种非帧时间，字幕会在相邻帧边缘闪烁或晚一帧出现。做法是：
   ```text
   startFrame = round(start * fps)
   start = startFrame / fps
   ```
   endFrame 取下一句的 startFrame，末句取音频总帧数；同时强制 `endFrame > startFrame`，保证单调、不重叠、每条至少 1 帧。

9. **句与句的切点用“下一句首词 start”，不是上一句末词 end。**
   这样相邻字幕严格首尾相接，不会因为词间停顿出现空档；末句再补到音频时长。

10. **`--audio` 自备音频没有词边界。**
    这时仍然按原来的字数比例分配，`alignment` 写 `proportional`。别把自备音频伪装成 `edge-wordboundary`。

## 渲染 / 预览

11. **预览不要用“渲染完整片再截断”。**
    Remotion CLI 的 `--frames=0-(N*fps-1)` 只渲染指定帧区间，速度快很多，也不会先生成一整条再切。
    本工程 `--preview 30s` 会算成 `previewFrames = min(总帧数, floor(30 * fps))`，再传 `--frames=0-(previewFrames-1)`。

12. **预览默认文件名要带后缀。**
    `out/<name>.mp4` → `out/<name>-preview.mp4`，竖屏 `out/<name>-9x16.mp4` → `out/<name>-9x16-preview.mp4`，避免覆盖正片。

## QC 抽帧与阈值

13. **抽帧用 ffmpeg rawvideo，不要在 Node 里解 mp4。**
    ```bash
    ffmpeg -i in.mp4 -an -vf fps=2,scale=320:-2,format=gray -f rawvideo -pix_fmt gray pipe:1
    ```
    Node 只负责按 `width * height` 切帧、算亮度和外接框。小尺寸灰度图足够做黑帧、空镜、主体尺寸和字幕条检测。

14. **帧尺寸要自己算清楚。**
    `scale=320:-2` 的高度取决于原视频比例。本工程固定算成偶数高度再显式传给 ffmpeg，避免 raw 帧切分错位。

15. **黑帧看平均亮度，空镜看标准差和前景比例。**
    - 平均亮度 `< 16` 判黑；连续 `>= 0.5s` 报 FAIL。
    - 标准差 `< 6`，或与背景差值 `> 40` 的暗色墨迹像素少于 0.1%，判空镜；连续 `>= 1.5s` 报 WARN。
    - 阈值是给当前浅色纸感背景调的；换深色主题要重调。

16. **主角尺寸排除底部字幕带。**
    只取画面上方 78% 区域，背景亮度取整帧众数，找与背景差值 `> 40` 的暗色墨迹外接框，高度占比的中位数应在 0.25–0.85。字幕条很暗，不排除会把“主角”量成整块字幕。

17. **字幕条检测用颜色带 + 行/列投影，不能只找“最暗像素”。**
    字幕条 `rgba(29,29,27,0.86)` 叠在浅色背景上，灰度大约 55–70；火柴人墨迹更黑（约 29），白字更亮。先取这个窄亮度带，再找行投影面积最大的连续块，最后用列投影去掉零散深色像素。

18. **“顶部不高于画面 60%”指字幕条顶部不能越过 60% 横线。**
    也就是 `topY / height >= 0.60`，字幕条应留在画面下方 40% 内。写反了会把所有正常底部字幕判成 FAIL。

19. **预览视频的 QC 要限制在视频时长内。**
    预览只渲了前 N 秒，captions.json 仍是整片的。`--preview` 时只检查 `start < 视频时长` 的字幕；如果忘记加标记，脚本检测到“视频明显短于字幕末尾”会自动按预览模式处理，并给一条时长 WARN 提醒。

20. **字幕时长和字数阈值。**
    `< 1.0s` FAIL、`< 1.5s` WARN、`> 7s` WARN；每秒有效字数 `> 8` WARN；相邻字幕重叠 FAIL；`startFrame` / `endFrame` 存在时必须是整数帧。

21. **换字体、换主题、换字幕样式后要重新看 QC。**
    字幕条颜色、边框、底部距离、字号都会影响灰度检测和安全区；当前阈值是按 1280×720 / 720×1280、`Caption.tsx` 的样式调的。

## 工程约定

22. **不要 git commit，不要改 main。**
    这是当前工作区的约定；脚本改动跑 `node --check`，python 改动跑 `py_compile`。

23. **公共产物不要手写。**
    `public/*-narration.mp3`、`public/*-captions.json`、`out/`、`qc/` 都是运行产物；改 script.json 后重新跑 TTS / render / qc 即可。

## 内容层

24. **先核实再写稿。**
    数字、年份、“第一/最/研究表明”这类说法最容易在口播里变成假事实。先用 `stickman research` 抽出来联网核对，再决定保留、改写还是删掉；搜索不到来源就按未证实处理，不要把“没搜到反例”当成“已证实”。

25. **每镜一个 point。**
    `shots[].point` 是这一镜要观众记住的一句话，不是标题也不是旁白原文。写不出 point 通常说明这一镜可以删；一镜塞两个 point 就拆镜。旁白、画面和字幕都服务同一个 point，`stickman lint` 先查 point 缺不缺，再查 `beatRole` 的五段时长是否偏得离谱。

26. **内容规则要可配置。**
    钩子、术语、结尾行动、镜头对齐这些判断会随片型和账号变化，不要硬编码在脚本里。规则放 `qc-rules.json`（version 2），用 `id/name/description/type/check/params/prompt/level/stage/enabled` 描述；项目目录可以放自己的同名文件覆盖仓库默认，临时试规则用 `--rules <file>`。禁用规则要显示 `DISABLED`，而不是悄悄消失。

27. **LLM 判断只能当建议。**
    内容检查受 prompt、模型和输入长度影响，同一句稿两次结果可能不同。规则级别是 `FAIL` 也只计入 QC 的总体 WARN，不改变退出码；最终发不发仍要人看一遍成片。把 LLM 当“第二个编辑”，不是审核闸门。

28. **规则分成 builtin / regex / llm 三类，阈值全部进 params。**
    C01–C26 里能用确定性逻辑判断的写成 builtin 检查器，纯词表/正则的写成 `type=regex`，需要语感的才交给 LLM。阈值、术语表、开场套话正则都放 `params`，改规则不用改脚本；`loadRules` 会在启动时报出「哪条规则哪个字段」不合法，正则编译失败也在这里拦住。C08a 和 C12a 合入 C08/C12 的 params，不再单独占 id；4 条 LLM 规则保留旧 id，对应规范 L01–L04。

29. **字数只算中文字、英文字母和数字。**
    标点、空格、换行都不算。C01/C02/C04/C05 共用同一个 `countChars`，否则同一条稿子在不同规则里会得到互相矛盾的字数。

30. **stage 决定规则什么时候拦人。**
    `stage=render` 的规则默认在 draft 阶段 SKIP；C17 配了 `"draftStatus": "PASS"`，所以草稿阶段显示 PASS/不拦，只有 `lint --stage render` 或 `render --content-gate` 才真正检查【待补】。内容门默认关闭，旧示例不加参数照常出片；打开后渲染前先跑一遍 lint，有 FAIL 就中止，避免把【待补】渲进成片。

31. **内容 FAIL 与视觉 FAIL 分开。**
    画面/字幕的 FAIL 决定 QC 退出码；内容规则即使是 FAIL，也只计入总体 WARN，并在报告里标「内容 FAIL（渲染前需改）」。LLM 判断受 prompt 和输入长度影响，不能当自动审核闸门。

32. **C08 先看实测时间，再看文案兜底。**
    有 captions 时用 `start/end` 或 `startFrame/endFrame` 除以 fps 取前 3 秒的句子检查开场套话，同时 `narration[0..2]` 也要查（C08a 词表在 `params.openerPattern`）；没有 captions 才退化为只查 narration，并在 detail 写「未用实测时间」。第一镜必须 `beat=hook`。

33. **句长要折中，不能一味短。**
    v2 允许 17–22 字的信息句，但要占额度：钩子+问题合计 ≤1，拆解每 8 镜 ≤1，结论+行动合计 ≤1；≥23 仍直接 FAIL。C02 的 detail 要列出占用额度的句子，C21 单独汇总额度。另一个极端是分行体：连续 ≥4 句都 ≤8 字就 FAIL（C20），连续 5 句都在 12–16 字且相邻差 ≤2 则 WARN（C26）。

34. **结尾和假对比要分开判。**
    C10 只管「不是…而是…」「不只是…更是…」「并非…而是…」；整句同时出现保存/上传、前端/后端这类对立名词时降 WARN，否则 FAIL。评论区、你学会了吗、口号问句归 C12：口号空问 FAIL，含具体对象的问题 WARN，无问句 PASS；C12a 口号词表（未来可期、让我们、致敬等）也合在 C12。

35. **C14 和 C23 不要重复计数。**
    连续同开头 ≥3 句交给 C23 机械排比（WARN）；C14 只报连续=2 的情况。三连四字词和「从…到…，从…到…」也归 C23。这样同一段稿子不会同时被两条规则各报一次。

36. **旧样片不过检不是回归。**
    `examples/sample*` 是 v1 之前的存量稿，文案和 beat 都不符合 v2。`npm run lint:examples` 报 FAIL 可以接受；不要为了让旧样片过检去改 16:9/9:16 渲染默认路径，新稿从 `test/fixtures/style-guide-demo.json` 起步。
