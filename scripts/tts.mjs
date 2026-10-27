#!/usr/bin/env node
/**
 * 生成旁白 + 字幕时间轴（轻量版，不依赖 Whisper）。
 *
 * 用法：
 *   node scripts/tts.mjs --project examples/sample
 *   node scripts/tts.mjs --project examples/sample --audio ./my-voice.mp3
 *   node scripts/tts.mjs --project examples/sample --voice zh-CN-YunxiNeural --rate +0%
 *
 * 产物（全部落在项目根目录 public/ 下，文件名带 project 名，避免多项目互相覆盖）：
 *   public/<name>-narration.mp3
 *   public/<name>-captions.json   -> { audio, duration, captions: [{start, end, text}] }
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_RATE = "+0%";
/** 句间自然停顿（毫秒）：只用于字幕时间轴分配，音频里的停顿由标点自然产生 */
const SENTENCE_GAP_MS = 320;

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
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
 * 按字数比例分配时间。
 * 总时长里先扣掉 (n-1) 个句间停顿，再按权重分，避免句子间出现不自然的挤在一起。
 */
const allocate = (sentences, totalSeconds) => {
  const n = sentences.length;
  const gap = n > 1 ? (SENTENCE_GAP_MS / 1000) : 0;
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

const synthesize = async ({ sentences, voice, rate, outFile }) => {
  if (!(await which("edge-tts"))) {
    throw new Error(
      "找不到 edge-tts。请先安装：pip install edge-tts（或 pipx install edge-tts）"
    );
  }

  // 一次合成整条：句子之间用中文句号，edge-tts 会给出自然停顿。
  const text = sentences
    .map((s) => s.trim().replace(/[，。、；：,.!?！？；：]$/, ""))
    .join("。") + "。";

  await exec(
    "edge-tts",
    [
      // 用 key=value 形式：--rate -8% 会被当成新选项，合并后不会。
      `--voice=${voice}`,
      `--rate=${rate}`,
      "--text",
      text,
      "--write-media",
      outFile,
    ],
    { maxBuffer: 1024 * 1024 * 16 }
  );
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

  if (typeof args.audio === "string") {
    const custom = path.resolve(process.cwd(), args.audio);
    await fs.access(custom);
    log(`使用自备音频：${custom}`);
    await fs.copyFile(custom, outAudio);
    duration = await probeDuration(outAudio);
  } else {
    if (!(await which("ffprobe"))) {
      throw new Error("找不到 ffprobe，请先安装 FFmpeg（含 ffprobe）");
    }
    // ffmpeg 也用于后续可能的转码，这里一并检查
    if (!(await which("ffmpeg"))) {
      throw new Error("找不到 ffmpeg，请先安装 FFmpeg");
    }

    const voice = typeof args.voice === "string" ? args.voice : DEFAULT_VOICE;
    log(`edge-tts 合成 ${narration.length} 句，voice=${voice} rate=${rate}`);
    await synthesize({ sentences: narration, voice, rate, outFile: outAudio });
    duration = await probeDuration(outAudio);
    log(`音频时长 ${duration.toFixed(2)}s -> ${path.relative(ROOT, outAudio)}`);
  }

  const captions = allocate(narration, duration);
  const payload = {
    audio: outAudioName,
    duration: Number(duration.toFixed(3)),
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
  captions.forEach((c) =>
    log(`  ${c.start.toFixed(2)}–${c.end.toFixed(2)}  ${c.text}`)
  );
  log("提示：渲染时 scripts/render.mjs 会自动读取这个 captions.json");
};

main().catch((err) => {
  console.error("[tts] 失败：", err.message);
  process.exit(1);
});
