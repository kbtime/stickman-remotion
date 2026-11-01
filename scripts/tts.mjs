#!/usr/bin/env node
/**
 * 生成旁白 + 字幕时间轴。
 *
 * 默认路径（帧精确）：
 *   1. python3 scripts/edge_tts_boundary.py 用 edge-tts 7 的 WordBoundary
 *      合成 mp3，并拿到逐词边界；
 *   2. 把词按字符顺序匹配回 narration 的每一句；
 *   3. 每句 start = 首词 start，end = 下一句首词 start（末句 = 音频时长）；
 *   4. 按 fps 量化到整数帧，避免字幕跨帧闪烁。
 *
 * 自备音频（--audio）或词边界匹配失败时，回退为按字数比例分配。
 *
 * 用法：
 *   node scripts/tts.mjs --project examples/sample
 *   node scripts/tts.mjs --project examples/sample --audio ./my-voice.mp3
 *   node scripts/tts.mjs --project examples/sample --voice zh-CN-YunxiNeural --rate +0%
 *
 * 产物（全部落在项目根目录 public/ 下，文件名带 project 名，避免多项目互相覆盖）：
 *   public/<name>-narration.mp3
 *   public/<name>-captions.json
 *     -> { audio, duration, fps, alignment, captions: [{start, end, startFrame, endFrame, text, words}] }
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const BOUNDARY_SCRIPT = path.join(ROOT, "scripts", "edge_tts_boundary.py");

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_RATE = "+0%";
/** 句间自然停顿（毫秒）：只用于回退路径的字幕时间轴分配 */
const SENTENCE_GAP_MS = 320;

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        // 支持 --rate=-8% / --preview=10.5s 这种 = 形式，
        // 避免 -8% 被某些命令行解析器当成新选项。
        out[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
};

const log = (...msg) => console.log("[tts]", ...msg);
const warn = (...msg) => console.warn("[tts] 警告：", ...msg);

const which = async (bin) => {
  try {
    await exec("which", [bin]);
    return true;
  } catch {
    return false;
  }
};

const probeDuration = async (file) => {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe 读不到有效时长：${file}`);
  }
  return d;
};

/** 中文句子的“口播权重”：去掉标点后的字符数，中文字 1，英数 0.55 */
const weightOf = (text) =>
  Array.from(text.replace(/[\s，。、！？；：“”‘’（）《》…—,.!?;:'"()\-]/g, ""))
    .map((ch) => (/[\u4e00-\u9fa5]/.test(ch) ? 1 : 0.55))
    .reduce((a, b) => a + b, 0);

/**
 * 按字数比例分配时间（回退路径）。
 * 总时长里先扣掉 (n-1) 个句间停顿，再按权重分，避免句子间出现不自然的挤在一起。
 */
const allocate = (sentences, totalSeconds) => {
  const n = sentences.length;
  const gap = n > 1 ? SENTENCE_GAP_MS / 1000 : 0;
  const speech = Math.max(0.5, totalSeconds - gap * (n - 1));
  const weights = sentences.map(weightOf);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;

  const captions = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const dur = (weights[i] / sum) * speech;
    const start = cursor;
    const end = i === n - 1 ? totalSeconds : start + dur;
    captions.push({
      start: Number(start.toFixed(3)),
      end: Number((end + (i === n - 1 ? 0 : gap)).toFixed(3)),
      text: sentences[i],
    });
    cursor = end + gap;
  }
  // 修正浮点误差导致的尾巴越界
  captions[captions.length - 1].end = Number(totalSeconds.toFixed(3));
  return captions;
};

/** 去掉空白和标点，只留下真正会被念出来的字符 */
const normalizeSpeech = (text) =>
  Array.from(String(text ?? "").replace(/[\s\p{P}\p{S}]/gu, ""));

const buildTtsText = (sentences) =>
  sentences
    .map((s) => s.trim().replace(/[，。、；：,.!?！？；：]$/, ""))
    .join("。") + "。";

/** 最后兜底：python 路径失败且没有音频时，退回原来的 edge-tts CLI */
const synthesizeWithCli = async ({ sentences, voice, rate, outFile }) => {
  if (!(await which("edge-tts"))) {
    throw new Error(
      "找不到 edge-tts。请先安装：pip install --user --break-system-packages 'edge-tts>=7.3.1'"
    );
  }
  await exec(
    "edge-tts",
    [
      `--voice=${voice}`,
      `--rate=${rate}`,
      "--text",
      buildTtsText(sentences),
      "--write-media",
      outFile,
    ],
    { maxBuffer: 1024 * 1024 * 16 }
  );
};

/**
 * 调用 python 侧 edge-tts WordBoundary 合成。
 * 文本写临时文件，避免很长的中文旁白撞上命令行参数长度限制。
 */
const synthesizeWithBoundaries = async ({
  sentences,
  voice,
  rate,
  outAudio,
  outBoundaries,
}) => {
  if (!(await which("python3"))) {
    throw new Error("找不到 python3，无法生成逐词边界");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stickman-tts-"));
  const textFile = path.join(tmpDir, "narration.txt");
  const text = buildTtsText(sentences);
  try {
    await fs.writeFile(textFile, text, "utf8");
    await exec(
      "python3",
      [
        BOUNDARY_SCRIPT,
        `--text-file=${textFile}`,
        `--voice=${voice}`,
        `--rate=${rate}`,
        `--audio=${outAudio}`,
        `--boundaries=${outBoundaries}`,
      ],
      { maxBuffer: 1024 * 1024 * 32 }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  const raw = await fs.readFile(outBoundaries, "utf8");
  const boundaries = JSON.parse(raw);
  if (!Array.isArray(boundaries) || boundaries.length === 0) {
    throw new Error("WordBoundary 结果为空");
  }
  return boundaries;
};

/**
 * 把逐词边界按字符顺序匹配回 narration 的每一句。
 * 标点、空白、符号在两边都忽略；匹配不上就抛错，由调用方回退。
 */
const alignWordsToSentences = (sentences, boundaries) => {
  const normalized = sentences.map((s) => normalizeSpeech(s));
  const ranges = [];
  let globalCursor = 0;
  for (const chars of normalized) {
    const start = globalCursor;
    globalCursor += chars.length;
    ranges.push({ start, end: globalCursor });
  }
  const full = normalized.map((chars) => chars.join("")).join("");

  const words = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    const chars = normalizeSpeech(boundary.text);
    if (chars.length === 0) continue;

    const word = chars.join("");
    const expected = full.slice(cursor, cursor + word.length);
    if (word !== expected) {
      throw new Error(
        `第 ${words.length + 1} 个词 "${boundary.text}" 对不上旁白，期望 "${expected || "<文本末尾>"}"`
      );
    }

    const sentenceIndex = ranges.findIndex(
      (r) => cursor >= r.start && cursor < r.end
    );
    if (sentenceIndex < 0) {
      throw new Error(`词 "${boundary.text}" 找不到所属句子`);
    }

    const start = Number(boundary.start);
    const end = Number(boundary.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error(`词 "${boundary.text}" 的边界时间无效`);
    }

    words.push({
      start,
      end,
      text: String(boundary.text),
      sentenceIndex,
    });
    cursor += word.length;
  }

  if (cursor !== full.length) {
    throw new Error(
      `逐词边界只匹配到 ${cursor}/${full.length} 个字符，旁白末尾没有被念出来`
    );
  }

  ranges.forEach((range, i) => {
    if (!words.some((w) => w.sentenceIndex === i)) {
      throw new Error(`第 ${i + 1} 句没有匹配到任何词`);
    }
  });

  return words;
};

/** 由逐词边界生成句级字幕，并量化到整数帧 */
const buildFrameExactCaptions = (sentences, words, duration, fps) => {
  const groups = sentences.map(() => []);
  words.forEach((word) => groups[word.sentenceIndex].push(word));

  const raw = groups.map((group, i) => ({
    start: group[0].start,
    end: i < groups.length - 1 ? groups[i + 1][0].start : duration,
    text: sentences[i],
    words: group.map((w) => ({
      start: Number(w.start.toFixed(6)),
      end: Number(w.end.toFixed(6)),
      text: w.text,
    })),
  }));

  // startFrame = round(start * fps)，并强制严格递增（每条至少 1 帧）
  const startFrames = raw.map((c) => Math.max(0, Math.round(c.start * fps)));
  for (let i = 1; i < startFrames.length; i++) {
    if (startFrames[i] <= startFrames[i - 1]) {
      startFrames[i] = startFrames[i - 1] + 1;
    }
  }

  const audioFrames = Math.max(1, Math.round(duration * fps));
  const endFrames = raw.map((_, i) =>
    i < raw.length - 1 ? startFrames[i + 1] : audioFrames
  );
  for (let i = 0; i < endFrames.length; i++) {
    if (endFrames[i] <= startFrames[i]) {
      endFrames[i] = startFrames[i] + 1;
    }
  }

  return raw.map((caption, i) => ({
    start: Number((startFrames[i] / fps).toFixed(6)),
    end: Number((endFrames[i] / fps).toFixed(6)),
    startFrame: startFrames[i],
    endFrame: endFrames[i],
    text: caption.text,
    words: caption.words,
  }));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(
    ROOT,
    typeof args.project === "string" ? args.project : "examples/sample"
  );
  const scriptPath = path.join(projectDir, "script.json");

  const raw = await fs.readFile(scriptPath, "utf8");
  const script = JSON.parse(raw);
  const narration = Array.isArray(script.narration) ? script.narration : [];
  if (narration.length === 0) {
    throw new Error(`${scriptPath} 的 narration 为空，没法生成字幕`);
  }

  const fps = Number(script.fps) || 30;
  const name = path.basename(projectDir);
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const outAudioName = `${name}-narration.mp3`;
  const outAudio = path.join(PUBLIC_DIR, outAudioName);
  const outCaptions = path.join(PUBLIC_DIR, `${name}-captions.json`);

  // 语速优先级：CLI --rate > script.json 的 ttsRate > 默认 +0%
  const rate =
    typeof args.rate === "string"
      ? args.rate
      : typeof script.ttsRate === "string" && script.ttsRate.trim()
        ? script.ttsRate.trim()
        : DEFAULT_RATE;

  let duration;
  let captions;
  let alignment;

  if (typeof args.audio === "string") {
    const custom = path.resolve(process.cwd(), args.audio);
    await fs.access(custom);
    log(`使用自备音频：${custom}`);
    await fs.copyFile(custom, outAudio);
    duration = await probeDuration(outAudio);
    captions = allocate(narration, duration);
    alignment = "proportional";
    log("自备音频没有词边界，字幕按字数比例分配（alignment=proportional）");
  } else {
    if (!(await which("ffprobe"))) {
      throw new Error("找不到 ffprobe，请先安装 FFmpeg（含 ffprobe）");
    }
    if (!(await which("ffmpeg"))) {
      throw new Error("找不到 ffmpeg，请先安装 FFmpeg");
    }

    const voice = typeof args.voice === "string" ? args.voice : DEFAULT_VOICE;
    log(
      `edge-tts WordBoundary 合成 ${narration.length} 句，voice=${voice} rate=${rate}`
    );

    const outBoundaries = path.join(
      os.tmpdir(),
      `stickman-${name}-${process.pid}-boundaries.json`
    );
    // 避免失败的 python 进程留下上一轮的旧音频，造成“看似成功”
    await fs.rm(outAudio, { force: true });
    await fs.rm(outBoundaries, { force: true });

    let boundaries = null;
    let synthError = null;
    try {
      boundaries = await synthesizeWithBoundaries({
        sentences: narration,
        voice,
        rate,
        outAudio,
        outBoundaries,
      });
    } catch (err) {
      synthError = err;
    } finally {
      await fs.rm(outBoundaries, { force: true });
    }

    if (synthError) {
      warn(`逐词边界合成失败：${synthError.message}`);
      try {
        duration = await probeDuration(outAudio);
      } catch {
        warn("python 路径没有产出可用音频，回退到 edge-tts CLI 合成");
        try {
          await synthesizeWithCli({
            sentences: narration,
            voice,
            rate,
            outFile: outAudio,
          });
          duration = await probeDuration(outAudio);
        } catch (cliError) {
          throw new Error(
            `edge-tts 合成失败，且没有可用的音频可回退：${synthError.message}；CLI 回退也失败：${cliError.message}`
          );
        }
      }
      captions = allocate(narration, duration);
      alignment = "proportional";
      warn("已回退到按字数比例分配字幕（alignment=proportional）");
    } else {
      duration = await probeDuration(outAudio);
      log(`音频时长 ${duration.toFixed(2)}s -> ${path.relative(ROOT, outAudio)}`);
      try {
        const words = alignWordsToSentences(narration, boundaries);
        captions = buildFrameExactCaptions(narration, words, duration, fps);
        alignment = "edge-wordboundary";
        log(
          `词边界对齐成功：${words.length} 个词 -> ${captions.length} 句，fps=${fps}`
        );
      } catch (err) {
        warn(`词边界匹配失败：${err.message}`);
        captions = allocate(narration, duration);
        alignment = "proportional";
        warn("已回退到按字数比例分配字幕（alignment=proportional）");
      }
    }
  }

  const payload = {
    audio: outAudioName,
    duration: Number(duration.toFixed(3)),
    fps,
    alignment,
    voice:
      typeof args.audio === "string"
        ? null
        : typeof args.voice === "string"
          ? args.voice
          : DEFAULT_VOICE,
    rate: typeof args.audio === "string" ? null : rate,
    generatedAt: new Date().toISOString(),
    captions,
  };
  await fs.writeFile(outCaptions, JSON.stringify(payload, null, 2), "utf8");

  log(`字幕 ${captions.length} 条 -> ${path.relative(ROOT, outCaptions)}`);
  captions.forEach((c) => {
    const frames =
      c.startFrame !== undefined
        ? ` [${c.startFrame}-${c.endFrame}]`
        : "";
    log(`  ${c.start.toFixed(2)}–${c.end.toFixed(2)}${frames}  ${c.text}`);
  });
  log("提示：渲染时 scripts/render.mjs 会自动读取这个 captions.json");
};

main().catch((err) => {
  console.error("[tts] 失败：", err.message);
  process.exit(1);
});
