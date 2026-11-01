#!/usr/bin/env node
/**
 * 成片 QC：抽帧 + captions.json 检查，输出 qc-report.json / qc-report.md。
 *
 * 用法：
 *   node scripts/qc.mjs --video out/x.mp4 --captions public/x-captions.json
 *   node scripts/qc.mjs --video out/x-preview.mp4 --captions public/x-captions.json --preview
 *   node scripts/qc.mjs --video out/x.mp4 --captions public/x-captions.json \
 *     --out-dir qc/x --sample-fps 2
 *
 * 检查项：
 *   1. 黑帧（平均亮度 < 16，连续 >= 0.5s -> FAIL）
 *   2. 空镜（标准差 < 6 或几乎没有前景，连续 >= 1.5s -> WARN）
 *   3. 主角尺寸（上方 78% 区域墨迹外接框高度占比，中位数应在 0.25–0.85）
 *   4. 字幕安全区（左右 >= 5% 宽、底边 >= 3% 高、顶部不高于 60%）
 *   5. 字幕停留/字数/重叠/整数帧
 *   6. 视频时长与字幕末尾差值（> 0.5s -> WARN；--preview 时跳过）
 *
 * 退出码：有 FAIL 为 1，否则 0。
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const THRESHOLDS = {
  blackMean: 16,
  blackSeconds: 0.5,
  emptyStd: 6,
  emptyInkRatio: 0.001,
  emptySeconds: 1.5,
  subjectMin: 0.25,
  subjectMax: 0.85,
  subjectTopRegion: 0.78,
  inkDelta: 40,
  safeLeftRight: 0.05,
  safeBottom: 0.03,
  safeTopMax: 0.6,
  captionMin: 1.0,
  captionWarn: 1.5,
  captionMax: 7.0,
  charsPerSecond: 8,
  durationTolerance: 0.5,
  sampleWidth: 320,
};

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

const log = (...m) => console.log("[qc]", ...m);

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

const probeVideo = async (file) => {
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      file,
    ],
    { maxBuffer: 1024 * 1024 * 8 }
  );
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const width = Number(stream.width);
  const height = Number(stream.height);
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`ffprobe 读不到视频尺寸：${file}`);
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe 读不到视频时长：${file}`);
  }
  return { width, height, duration };
};

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const fmtPct = (v) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(2)}%`);
const fmtSec = (v) => `${Number(v).toFixed(2)}s`;

/** 单帧灰度统计：亮度、标准差、背景众数、墨迹外接框 */
const analyzeFrame = (buf, width, height) => {
  const total = width * height;
  const hist = new Uint32Array(256);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < total; i++) {
    const v = buf[i];
    hist[v]++;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / total;
  const variance = Math.max(0, sumSq / total - mean * mean);
  const std = Math.sqrt(variance);

  let bgMode = 0;
  let bestCount = -1;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > bestCount) {
      bestCount = hist[v];
      bgMode = v;
    }
  }

  // 排除底部字幕带，只看上方 78%
  const topHeight = Math.max(1, Math.floor(height * THRESHOLDS.subjectTopRegion));
  let minX = width;
  let minY = topHeight;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;
  for (let y = 0; y < topHeight; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (bgMode - buf[row + x] > THRESHOLDS.inkDelta) {
        inkPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const inkRatio = inkPixels / (width * topHeight);
  const bbox =
    inkPixels > 0 && maxX >= minX && maxY >= minY
      ? {
          x0: minX,
          x1: maxX,
          y0: minY,
          y1: maxY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : null;

  return {
    mean,
    std,
    bgMode,
    inkRatio,
    bbox,
    subjectRatio: bbox ? bbox.height / height : null,
    black: mean < THRESHOLDS.blackMean,
    empty: std < THRESHOLDS.emptyStd || inkRatio < THRESHOLDS.emptyInkRatio,
  };
};

/**
 * 检测底部字幕条：字幕条 rgba(29,29,27,0.86) 叠在浅色背景上，灰度约 42–82。
 * 每行取“最长连续”的该亮度段（字幕条是实心块，桌面/线条等深色细节不连续或很薄），
 * 从画面底部往上找第一段连续候选行作为字幕条，避免把场景里的深色家具误判成字幕。
 */
const detectSubtitleBar = (buf, width, height) => {
  const startY = Math.floor(height * 0.4);
  const minSpan = Math.max(8, Math.round(width * 0.12));
  const spans = new Array(height).fill(null);
  for (let y = startY; y < height; y++) {
    const row = y * width;
    let bestLen = 0, bestX = -1, runX = -1;
    for (let x = 0; x <= width; x++) {
      const v = x < width ? buf[row + x] : 255;
      const hit = v >= 42 && v <= 82;
      if (hit && runX < 0) runX = x;
      if (!hit && runX >= 0) {
        if (x - runX > bestLen) { bestLen = x - runX; bestX = runX; }
        runX = -1;
      }
    }
    if (bestLen >= minSpan) spans[y] = { x0: bestX, x1: bestX + bestLen - 1 };
  }
  // 从底部往上找第一段连续（允许 1 行断档）的候选行
  let y1 = -1, y0 = -1, gap = 0;
  for (let y = height - 1; y >= startY; y--) {
    if (spans[y]) {
      if (y1 < 0) y1 = y;
      y0 = y;
      gap = 0;
    } else if (y1 >= 0) {
      gap++;
      if (gap > 1) break;
    }
  }
  if (y1 < 0 || y1 - y0 + 1 < 3) return null;
  const xs0 = [], xs1 = [];
  for (let y = y0; y <= y1; y++) if (spans[y]) { xs0.push(spans[y].x0); xs1.push(spans[y].x1); }
  xs0.sort((m, n) => m - n); xs1.sort((m, n) => m - n);
  const x0 = xs0[Math.floor(xs0.length / 2)];
  const x1 = xs1[Math.floor(xs1.length / 2)];
  return { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
};

const findRuns = (metrics, predicate, sampleFps) => {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= metrics.length; i++) {
    const ok = i < metrics.length && predicate(metrics[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const end = i - 1;
      runs.push({
        startFrame: start,
        endFrame: end,
        start: start / sampleFps,
        end: (end + 1) / sampleFps,
        seconds: (end - start + 1) / sampleFps,
      });
      start = -1;
    }
  }
  return runs;
};

/** 用 ffmpeg 把视频抽成小尺寸灰度 raw，在 Node 里逐帧分析 */
const analyzeVideo = async ({ video, sampleFps, selectedFrames }) => {
  const info = await probeVideo(video);
  const targetWidth = THRESHOLDS.sampleWidth;
  const targetHeight = Math.max(
    2,
    Math.round(((info.height * targetWidth) / info.width) / 2) * 2
  );
  const frameSize = targetWidth * targetHeight;

  const selected = new Map();
  for (const item of selectedFrames) {
    const list = selected.get(item.frameIndex) ?? [];
    list.push(item);
    selected.set(item.frameIndex, list);
  }

  const metrics = [];
  const subtitleBars = new Map();
  const stderr = [];

  await new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        video,
        "-an",
        "-vf",
        `fps=${sampleFps},scale=${targetWidth}:${targetHeight},format=gray`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let pending = Buffer.alloc(0);
    let frameIndex = 0;
    let failed = null;

    proc.stdout.on("data", (chunk) => {
      if (failed) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      try {
        while (pending.length - offset >= frameSize) {
          const frame = pending.subarray(offset, offset + frameSize);
          const metric = analyzeFrame(frame, targetWidth, targetHeight);
          metric.index = frameIndex;
          metric.time = frameIndex / sampleFps;
          metrics.push(metric);

          const selectedItems = selected.get(frameIndex);
          if (selectedItems) {
            const bar = detectSubtitleBar(frame, targetWidth, targetHeight);
            for (const item of selectedItems) {
              subtitleBars.set(item.captionIndex, {
                time: item.time,
                frameIndex,
                bar,
              });
            }
          }

          frameIndex++;
          offset += frameSize;
        }
      } catch (err) {
        failed = err;
        proc.kill("SIGKILL");
        return;
      }
      pending = offset > 0 ? pending.subarray(offset) : pending;
    });

    proc.stderr.on("data", (chunk) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (failed) {
        reject(failed);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg 抽帧失败（退出码 ${code}）：${Buffer.concat(stderr).toString("utf8").trim()}`
          )
        );
        return;
      }
      resolve();
    });
  });

  return { info, targetWidth, targetHeight, metrics, subtitleBars };
};

const buildMarkdown = (report) => {
  const { summary, checks, issues } = report;
  const captionRows = checks.captionTiming.rows;
  const subtitleRows = checks.subtitleSafe.rows;
  const lines = [];
  lines.push(`# QC 报告 — ${path.basename(report.video)}`);
  lines.push("");
  lines.push(`- 视频：\`${report.video}\``);
  lines.push(`- 字幕：\`${report.captions}\``);
  lines.push(
    `- 尺寸/时长：${report.videoWidth}×${report.videoHeight} / ${fmtSec(report.videoDuration)}`
  );
  lines.push(`- 抽帧：${report.sampleFps} fps，共 ${report.frameCount} 帧`);
  lines.push(
    `- 预览模式：${
      report.preview
        ? "是（--preview，只检查视频时长内的字幕）"
        : report.autoPreview
          ? "自动（视频短于字幕末尾，只检查视频时长内的字幕）"
          : "否"
    }`
  );
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push("");
  lines.push(`## 汇总：**${summary.status}**`);
  lines.push("");
  lines.push(`- FAIL：${summary.fail}`);
  lines.push(`- WARN：${summary.warn}`);
  lines.push("");
  lines.push("| 检查项 | 状态 | 关键数据 |");
  lines.push("|---|---|---|");
  lines.push(
    `| 黑帧 | ${checks.blackFrames.status} | 黑帧 ${checks.blackFrames.blackFrames} 个，最长 ${fmtSec(checks.blackFrames.longestSeconds)} |`
  );
  lines.push(
    `| 空镜 | ${checks.emptyShots.status} | 空镜 ${checks.emptyShots.emptyFrames} 帧，最长 ${fmtSec(checks.emptyShots.longestSeconds)} |`
  );
  lines.push(
    `| 主角尺寸 | ${checks.subjectSize.status} | min ${fmtPct(checks.subjectSize.min)} / median ${fmtPct(checks.subjectSize.median)} / max ${fmtPct(checks.subjectSize.max)} |`
  );
  lines.push(
    `| 字幕安全区 | ${checks.subtitleSafe.status} | 左 ${fmtPct(checks.subtitleSafe.minLeft)}，右 ${fmtPct(checks.subtitleSafe.minRight)}，底 ${fmtPct(checks.subtitleSafe.minBottom)}，顶 ${fmtPct(checks.subtitleSafe.maxTop)} |`
  );
  lines.push(
    `| 字幕时长 | ${checks.captionTiming.status} | ${checks.captionTiming.count} 条，最短 ${fmtSec(checks.captionTiming.minDuration)}，最长 ${fmtSec(checks.captionTiming.maxDuration)} |`
  );
  lines.push(
    `| 时长差 | ${checks.duration.status} | ${
      checks.duration.preview && !checks.duration.autoPreview
        ? "预览模式，跳过完整时长对比"
        : `视频 ${fmtSec(checks.duration.videoDuration)}，字幕末尾 ${fmtSec(checks.duration.lastCaptionEnd)}，差 ${fmtSec(checks.duration.delta)}`
    } |`
  );
  lines.push("");

  lines.push("## 黑帧 / 空镜连续段");
  lines.push("");
  lines.push("| 类型 | 开始 | 结束 | 时长 |");
  lines.push("|---|---|---|---|");
  if (checks.blackFrames.runs.length === 0 && checks.emptyShots.runs.length === 0) {
    lines.push("| — | — | — | 无 |");
  } else {
    for (const run of checks.blackFrames.runs) {
      lines.push(`| 黑帧 | ${fmtSec(run.start)} | ${fmtSec(run.end)} | ${fmtSec(run.seconds)} |`);
    }
    for (const run of checks.emptyShots.runs) {
      lines.push(`| 空镜 | ${fmtSec(run.start)} | ${fmtSec(run.end)} | ${fmtSec(run.seconds)} |`);
    }
  }
  lines.push("");

  lines.push("## 字幕停留与节奏");
  lines.push("");
  lines.push("| # | 开始 | 结束 | 时长 | 字/秒 | 帧 | 状态 | 备注 |");
  lines.push("|---:|---:|---:|---:|---:|---|---|---|");
  if (captionRows.length === 0) {
    lines.push("| — | — | — | — | — | — | — | 无字幕 |");
  } else {
    for (const row of captionRows) {
      const frames =
        row.startFrame === undefined
          ? "—"
          : `${row.startFrame}–${row.endFrame ?? "?"}`;
      lines.push(
        `| ${row.index + 1} | ${fmtSec(row.start)} | ${fmtSec(row.end)} | ${fmtSec(row.duration)} | ${row.charsPerSecond.toFixed(2)} | ${frames} | ${row.status} | ${row.notes.join("；") || "—"} |`
      );
    }
  }
  lines.push("");

  lines.push("## 字幕安全区");
  lines.push("");
  lines.push("| # | 采样时间 | 左 | 右 | 底 | 顶部位置 | 状态 |");
  lines.push("|---:|---:|---:|---:|---:|---:|---|");
  if (subtitleRows.length === 0) {
    lines.push("| — | — | — | — | — | — | 无字幕 |");
  } else {
    for (const row of subtitleRows) {
      lines.push(
        `| ${row.index + 1} | ${fmtSec(row.time)} | ${fmtPct(row.left)} | ${fmtPct(row.right)} | ${fmtPct(row.bottom)} | ${fmtPct(row.topPosition)} | ${row.status} |`
      );
    }
  }
  lines.push("");

  lines.push("## 问题清单");
  lines.push("");
  if (issues.length === 0) {
    lines.push("无。");
  } else {
    lines.push("| 级别 | 检查项 | 问题 |");
    lines.push("|---|---|---|");
    for (const issue of issues) {
      lines.push(`| ${issue.level} | ${issue.check} | ${issue.message} |`);
    }
  }
  lines.push("");
  lines.push(
    `> 阈值：黑帧亮度 < ${THRESHOLDS.blackMean} 且连续 >= ${THRESHOLDS.blackSeconds}s；空镜 std < ${THRESHOLDS.emptyStd} 或前景 < ${THRESHOLDS.emptyInkRatio} 且连续 >= ${THRESHOLDS.emptySeconds}s；主角高度中位数 ${THRESHOLDS.subjectMin}–${THRESHOLDS.subjectMax}；字幕安全区左右 >= ${THRESHOLDS.safeLeftRight * 100}%、底部 >= ${THRESHOLDS.safeBottom * 100}%、顶部不得高于 ${THRESHOLDS.safeTopMax * 100}% 横线。`
  );
  lines.push("");
  return lines.join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.video !== "string") {
    throw new Error("缺少 --video <mp4>");
  }
  if (typeof args.captions !== "string") {
    throw new Error("缺少 --captions <captions.json>");
  }

  const sampleFps = Number(args["sample-fps"] ?? 2);
  if (!Number.isFinite(sampleFps) || sampleFps <= 0) {
    throw new Error(`--sample-fps 必须是正数，收到 "${args["sample-fps"]}"`);
  }

  const video = path.resolve(ROOT, args.video);
  const captionsFile = path.resolve(ROOT, args.captions);
  const markedPreview = args.preview !== undefined;
  const videoBase = path.basename(video, path.extname(video));
  const outDir = path.resolve(
    ROOT,
    typeof args["out-dir"] === "string" ? args["out-dir"] : path.join("qc", videoBase)
  );

  const rawCaptions = await readJson(captionsFile);
  const captions = Array.isArray(rawCaptions)
    ? rawCaptions
    : Array.isArray(rawCaptions.captions)
      ? rawCaptions.captions
      : [];
  if (captions.length === 0) {
    throw new Error(`${captionsFile} 里没有 captions`);
  }

  const info = await probeVideo(video);
  const videoDuration = info.duration;
  const lastCaptionEndAll = Math.max(
    ...captions.map((caption) => Number(caption.end) || 0)
  );

  // 预览视频：--preview 显式标记，或视频明显短于字幕末尾时自动识别。
  // 两种情况下都只检查视频时长内开始的字幕。
  const autoPreview =
    !markedPreview &&
    lastCaptionEndAll - videoDuration > THRESHOLDS.durationTolerance &&
    captions.some((caption) => Number(caption.start) >= videoDuration);
  const preview = markedPreview || autoPreview;

  const checkedCaptions = captions
    .map((caption, originalIndex) => ({ ...caption, originalIndex }))
    .filter(
      (caption) =>
        Number.isFinite(Number(caption.start)) &&
        Number(caption.start) >= 0 &&
        (!preview || Number(caption.start) < videoDuration)
    );

  if (checkedCaptions.length === 0) {
    throw new Error("视频时长内没有可检查的字幕");
  }

  // 每条字幕取一个中间时刻做字幕条安全区检测
  const selectedFrames = checkedCaptions.map((caption, captionIndex) => {
    const start = Number(caption.start);
    const end = Number(caption.end);
    let time = (start + end) / 2;
    if (!Number.isFinite(time)) time = start;
    if (preview) time = Math.min(time, Math.max(0, videoDuration - 0.05));
    const frameIndex = Math.max(0, Math.round(time * sampleFps));
    return { captionIndex, time, frameIndex };
  });

  log(`分析 ${path.relative(ROOT, video)}（${info.width}×${info.height}，${fmtSec(videoDuration)}）`);
  log(`抽帧 ${sampleFps} fps，检查 ${checkedCaptions.length} 条字幕`);
  const { metrics, targetWidth, targetHeight, subtitleBars } = await analyzeVideo({
    video,
    sampleFps,
    selectedFrames,
  });

  if (metrics.length === 0) {
    throw new Error("ffmpeg 没有产出任何帧");
  }

  const issues = [];
  const addIssue = (level, check, message) => {
    issues.push({ level, check, message });
  };

  // 1) 黑帧
  const blackRuns = findRuns(metrics, (m) => m.black, sampleFps);
  const blackFrames = metrics.filter((m) => m.black).length;
  const longestBlack = blackRuns.reduce((max, r) => Math.max(max, r.seconds), 0);
  if (longestBlack >= THRESHOLDS.blackSeconds) {
    addIssue(
      "FAIL",
      "black-frames",
      `连续黑帧 ${longestBlack.toFixed(2)}s（阈值 ${THRESHOLDS.blackSeconds}s）`
    );
  }

  // 2) 空镜
  const emptyRuns = findRuns(metrics, (m) => m.empty, sampleFps);
  const emptyFrames = metrics.filter((m) => m.empty).length;
  const longestEmpty = emptyRuns.reduce((max, r) => Math.max(max, r.seconds), 0);
  if (longestEmpty >= THRESHOLDS.emptySeconds) {
    addIssue(
      "WARN",
      "empty-shots",
      `连续空镜 ${longestEmpty.toFixed(2)}s（阈值 ${THRESHOLDS.emptySeconds}s）`
    );
  }

  // 3) 主角尺寸
  const subjectValues = metrics
    .filter((m) => !m.black && m.subjectRatio !== null && m.inkRatio >= THRESHOLDS.emptyInkRatio)
    .map((m) => m.subjectRatio);
  const subjectMin = subjectValues.length ? Math.min(...subjectValues) : null;
  const subjectMedian = median(subjectValues);
  const subjectMax = subjectValues.length ? Math.max(...subjectValues) : null;
  if (subjectMedian === null) {
    addIssue("WARN", "subject-size", "没有测到主角墨迹，无法判断主角尺寸");
  } else if (
    subjectMedian < THRESHOLDS.subjectMin ||
    subjectMedian > THRESHOLDS.subjectMax
  ) {
    addIssue(
      "WARN",
      "subject-size",
      `主角高度中位数 ${fmtPct(subjectMedian)} 不在 ${THRESHOLDS.subjectMin * 100}%–${THRESHOLDS.subjectMax * 100}% 区间（min ${fmtPct(subjectMin)} / max ${fmtPct(subjectMax)}）`
    );
  }

  // 4) 字幕安全区：每条字幕取中间时刻的抽帧，检测底部深色字幕条外接框
  const subtitleRows = [];
  for (let i = 0; i < checkedCaptions.length; i++) {
    const sample = selectedFrames[i];
    const detection = subtitleBars.get(i);
    const row = {
      index: i,
      time: sample.time,
      frameIndex: sample.frameIndex,
      left: null,
      right: null,
      bottom: null,
      topPosition: null,
      bar: null,
      status: "PASS",
      notes: [],
    };
    const addSafeIssue = (level, message) => {
      row.notes.push(message);
      row.status =
        row.status === "FAIL" || level === "FAIL"
          ? "FAIL"
          : level === "WARN"
            ? "WARN"
            : row.status;
      addIssue(level, "subtitle-safe", `第 ${i + 1} 条：${message}`);
    };

    if (!detection) {
      if (preview) {
        // 预览片可能在字幕中途结束，抽帧覆盖不到最后一条字幕，属于预期情况
        row.status = "SKIP";
        row.notes.push("超出预览时长，跳过");
      } else {
        addSafeIssue("WARN", "抽帧没有覆盖到这条字幕的时刻，跳过安全区检查");
      }
    } else if (!detection.bar) {
      addSafeIssue("FAIL", "未检测到字幕条（深色底块）");
    } else {
      const bar = detection.bar;
      row.bar = bar;
      row.left = bar.x0 / targetWidth;
      row.right = (targetWidth - 1 - bar.x1) / targetWidth;
      row.bottom = (targetHeight - 1 - bar.y1) / targetHeight;
      row.topPosition = bar.y0 / targetHeight;

      if (row.left < THRESHOLDS.safeLeftRight - 1e-9) {
        addSafeIssue(
          "FAIL",
          `左边距 ${fmtPct(row.left)} < ${THRESHOLDS.safeLeftRight * 100}%`
        );
      }
      if (row.right < THRESHOLDS.safeLeftRight - 1e-9) {
        addSafeIssue(
          "FAIL",
          `右边距 ${fmtPct(row.right)} < ${THRESHOLDS.safeLeftRight * 100}%`
        );
      }
      if (row.bottom < THRESHOLDS.safeBottom - 1e-9) {
        addSafeIssue(
          "FAIL",
          `底边距 ${fmtPct(row.bottom)} < ${THRESHOLDS.safeBottom * 100}%`
        );
      }
      // “顶部不高于画面 60%”指字幕条顶部不能越过 60% 横线（y 坐标必须 >= 60%H）
      if (row.topPosition < THRESHOLDS.safeTopMax - 1e-9) {
        addSafeIssue(
          "FAIL",
          `字幕条顶部在 ${fmtPct(row.topPosition)}，越过了 ${THRESHOLDS.safeTopMax * 100}% 横线`
        );
      }
    }
    subtitleRows.push(row);
  }

  // 5) 字幕停留 / 字数 / 重叠 / 整数帧
  const captionRows = [];
  let previous = null;
  for (let i = 0; i < checkedCaptions.length; i++) {
    const caption = checkedCaptions[i];
    const start = Number(caption.start);
    const end = Number(caption.end);
    const duration = end - start;
    const text = String(caption.text ?? "");
    const chars = Array.from(text.replace(/[\s\p{P}\p{S}]/gu, "")).length;
    const charsPerSecond = duration > 0 ? chars / duration : Infinity;
    const row = {
      index: i,
      originalIndex: caption.originalIndex,
      start,
      end,
      duration,
      chars,
      charsPerSecond,
      startFrame: caption.startFrame,
      endFrame: caption.endFrame,
      status: "PASS",
      notes: [],
    };
    const addRowIssue = (level, message) => {
      row.notes.push(message);
      row.status =
        row.status === "FAIL" || level === "FAIL"
          ? "FAIL"
          : level === "WARN"
            ? "WARN"
            : row.status;
      addIssue(level, "caption-timing", `第 ${i + 1} 条：${message}`);
    };

    if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) {
      addRowIssue("FAIL", "start/end 不是有效时间");
    } else {
      if (duration < THRESHOLDS.captionMin) {
        addRowIssue("FAIL", `停留 ${fmtSec(duration)} < ${THRESHOLDS.captionMin}s`);
      } else if (duration < THRESHOLDS.captionWarn) {
        addRowIssue("WARN", `停留 ${fmtSec(duration)} < ${THRESHOLDS.captionWarn}s`);
      }
      if (duration > THRESHOLDS.captionMax) {
        addRowIssue("WARN", `停留 ${fmtSec(duration)} > ${THRESHOLDS.captionMax}s`);
      }
      if (charsPerSecond > THRESHOLDS.charsPerSecond) {
        addRowIssue(
          "WARN",
          `每秒 ${charsPerSecond.toFixed(2)} 字 > ${THRESHOLDS.charsPerSecond}`
        );
      }
      if (previous && start < previous.end - 1e-6) {
        addRowIssue(
          "FAIL",
          `与上一条重叠 ${fmtSec(previous.end - start)}（上一条结束 ${fmtSec(previous.end)}）`
        );
      }
    }

    for (const [key, label] of [
      ["startFrame", "startFrame"],
      ["endFrame", "endFrame"],
    ]) {
      const value = caption[key];
      if (value !== undefined && value !== null) {
        if (!Number.isInteger(Number(value))) {
          addRowIssue("FAIL", `${label}=${value} 不是整数帧`);
        }
      }
    }
    if (
      caption.startFrame !== undefined &&
      caption.endFrame !== undefined &&
      Number(caption.endFrame) <= Number(caption.startFrame)
    ) {
      addRowIssue("FAIL", "endFrame <= startFrame");
    }

    previous = { end: Number.isFinite(end) ? end : 0 };
    captionRows.push(row);
  }

  // 6) 视频时长 vs 字幕末尾
  const lastCaptionEnd = lastCaptionEndAll;
  const durationDelta = Math.abs(videoDuration - lastCaptionEnd);
  if (!markedPreview) {
    if (autoPreview) {
      addIssue(
        "WARN",
        "duration",
        `视频 ${fmtSec(videoDuration)} 明显短于字幕末尾 ${fmtSec(lastCaptionEnd)}，已自动只检查视频时长内的字幕（确认是预览可加 --preview 消除此提示）`
      );
    } else if (durationDelta > THRESHOLDS.durationTolerance) {
      addIssue(
        "WARN",
        "duration",
        `视频 ${fmtSec(videoDuration)} 与字幕末尾 ${fmtSec(lastCaptionEnd)} 相差 ${fmtSec(durationDelta)}（> ${THRESHOLDS.durationTolerance}s）`
      );
    }
  }

  const statusOf = (check) => {
    const list = issues.filter((issue) => issue.check === check);
    if (list.some((issue) => issue.level === "FAIL")) return "FAIL";
    if (list.some((issue) => issue.level === "WARN")) return "WARN";
    return "PASS";
  };

  const summary = {
    status: issues.some((i) => i.level === "FAIL")
      ? "FAIL"
      : issues.some((i) => i.level === "WARN")
        ? "WARN"
        : "PASS",
    fail: issues.filter((i) => i.level === "FAIL").length,
    warn: issues.filter((i) => i.level === "WARN").length,
  };

  const report = {
    video: path.relative(ROOT, video),
    captions: path.relative(ROOT, captionsFile),
    videoWidth: info.width,
    videoHeight: info.height,
    videoDuration,
    sampleFps,
    frameCount: metrics.length,
    analysisWidth: targetWidth,
    analysisHeight: targetHeight,
    preview: markedPreview,
    autoPreview,
    generatedAt: new Date().toISOString(),
    summary,
    thresholds: THRESHOLDS,
    checks: {
      blackFrames: {
        status: statusOf("black-frames"),
        blackFrames,
        longestSeconds: longestBlack,
        runs: blackRuns,
      },
      emptyShots: {
        status: statusOf("empty-shots"),
        emptyFrames,
        longestSeconds: longestEmpty,
        runs: emptyRuns,
      },
      subjectSize: {
        status: statusOf("subject-size"),
        samples: subjectValues.length,
        min: subjectMin,
        median: subjectMedian,
        max: subjectMax,
        expected: [THRESHOLDS.subjectMin, THRESHOLDS.subjectMax],
      },
      subtitleSafe: {
        status: statusOf("subtitle-safe"),
        checked: subtitleRows.filter((r) => r.status !== "SKIP").length,
        skipped: subtitleRows.filter((r) => r.status === "SKIP").length,
        minLeft: subtitleRows.length
          ? Math.min(...subtitleRows.map((r) => r.left ?? 1))
          : null,
        minRight: subtitleRows.length
          ? Math.min(...subtitleRows.map((r) => r.right ?? 1))
          : null,
        minBottom: subtitleRows.length
          ? Math.min(...subtitleRows.map((r) => r.bottom ?? 1))
          : null,
        maxTop: subtitleRows.length
          ? Math.max(...subtitleRows.map((r) => r.topPosition ?? 0))
          : null,
        rows: subtitleRows,
      },
      captionTiming: {
        status: statusOf("caption-timing"),
        count: captionRows.length,
        minDuration: captionRows.length
          ? Math.min(...captionRows.map((r) => r.duration))
          : null,
        maxDuration: captionRows.length
          ? Math.max(...captionRows.map((r) => r.duration))
          : null,
        rows: captionRows,
      },
      duration: {
        status: statusOf("duration"),
        videoDuration,
        lastCaptionEnd,
        delta: durationDelta,
        preview,
        autoPreview,
        tolerance: THRESHOLDS.durationTolerance,
      },
    },
    issues,
  };

  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "qc-report.json");
  const mdPath = path.join(outDir, "qc-report.md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(mdPath, buildMarkdown(report), "utf8");

  log(`总体：${summary.status}（FAIL ${summary.fail} / WARN ${summary.warn}）`);
  log(`报告：${path.relative(ROOT, jsonPath)}`);
  log(`报告：${path.relative(ROOT, mdPath)}`);
  for (const issue of issues) {
    log(`${issue.level} [${issue.check}] ${issue.message}`);
  }

  process.exitCode = summary.status === "FAIL" ? 1 : 0;
};

main().catch((err) => {
  console.error("[qc] 失败：", err.stack ?? err.message);
  process.exit(1);
});
