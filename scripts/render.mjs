#!/usr/bin/env node
/**
 * 一键渲染：script.json -> (必要时 TTS) -> Remotion render -> out/*.mp4
 *
 * 用法：
 *   node scripts/render.mjs --project examples/sample
 *   node scripts/render.mjs --project examples/sample --audio ./my-voice.mp3
 *   node scripts/render.mjs --project examples/sample --out out/demo.mp4 --force-tts
 *   node scripts/render.mjs --project examples/sample --aspect 9:16
 *
 * 画幅优先级：--aspect > script.aspect > script.width/height > 默认 16:9
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** 子进程输出直接透传到终端，方便看 TTS / Remotion 进度 */
const run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))
    );
    p.on("error", reject);
  });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

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

const log = (...m) => console.log("[render]", ...m);

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

/** 与 src/types.ts 的 ASPECT_SIZE / resolveAspect 保持一致 */
const ASPECT_SIZE = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

const resolveAspect = ({ aspect, width, height }) => {
  if (aspect === "9:16" || aspect === "16:9") return aspect;
  if (width && height) return height > width ? "9:16" : "16:9";
  return "16:9";
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const projectRel = typeof args.project === "string" ? args.project : "examples/sample";
  const projectDir = path.resolve(ROOT, projectRel);
  const scriptPath = path.join(projectDir, "script.json");
  const name = path.basename(projectDir);

  const script = await readJson(scriptPath);
  const captionsFile = path.join(PUBLIC_DIR, `${name}-captions.json`);
  const audioFile = path.join(PUBLIC_DIR, `${name}-narration.mp3`);
  const captionsRel = `${name}-captions.json`;
  const audioRel = `${name}-narration.mp3`;

  const needTts =
    args["force-tts"] ||
    typeof args.audio === "string" ||
    !(await exists(captionsFile)) ||
    !(await exists(audioFile));

  if (needTts) {
    log(`准备旁白（${projectRel}）`);
    const ttsArgs = ["scripts/tts.mjs", "--project", projectRel];
    if (typeof args.audio === "string") ttsArgs.push("--audio", args.audio);
    if (typeof args.voice === "string") ttsArgs.push("--voice", args.voice);
    if (typeof args.rate === "string") ttsArgs.push("--rate", args.rate);
    await run(process.execPath, ttsArgs, { cwd: ROOT });
  } else {
    log("已有旁白与字幕，跳过 TTS（要强制重出加 --force-tts）");
  }

  const captionsPayload = await readJson(captionsFile);
  const captions = captionsPayload.captions ?? [];
  const fps = Number(script.fps) || 30;

  // 画幅：CLI --aspect > script.aspect（覆盖宽高）> script.width/height > 默认 16:9
  const cliAspect = typeof args.aspect === "string" ? args.aspect : undefined;
  if (cliAspect && !(cliAspect in ASPECT_SIZE)) {
    throw new Error(`--aspect 只支持 ${Object.keys(ASPECT_SIZE).join(" / ")}，收到 "${cliAspect}"`);
  }
  const scriptAspect = script.aspect;
  let aspect;
  let videoSize;
  if (cliAspect) {
    aspect = resolveAspect({ aspect: cliAspect });
    videoSize = ASPECT_SIZE[aspect];
  } else if (scriptAspect) {
    aspect = resolveAspect({ aspect: scriptAspect });
    videoSize = ASPECT_SIZE[aspect];
  } else {
    aspect = resolveAspect({ width: script.width, height: script.height });
    const fallback = ASPECT_SIZE[aspect];
    videoSize = {
      width: Number(script.width) || fallback.width,
      height: Number(script.height) || fallback.height,
    };
  }

  // 与 src/metadata.ts 的规则保持一致：captions 1:1 优先，其次镜头 duration，再按 captions 分组
  const { scenes, durationInFrames } = buildTimeline(script, captions, fps);

  const props = {
    ...script,
    fps,
    aspect,
    width: videoSize.width,
    height: videoSize.height,
    captions,
    audio: audioRel,
    scenesMeta: scenes,
  };

  // 默认输出：竖屏项目（script.aspect/宽高是竖屏）用自己的名字；CLI 切换成竖屏时加 -9x16 后缀
  const projectPortrait =
    !cliAspect &&
    resolveAspect({ aspect: scriptAspect, width: script.width, height: script.height }) ===
      "9:16";
  const defaultOut = projectPortrait
    ? `out/${name}.mp4`
    : aspect === "9:16"
      ? `out/${name}-9x16.mp4`
      : `out/${name}.mp4`;
  const outRel = typeof args.out === "string" ? args.out : defaultOut;
  const outAbs = path.resolve(ROOT, outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  log(
    `画幅 ${aspect} → ${videoSize.width}×${videoSize.height}（${
      cliAspect ? "CLI --aspect" : scriptAspect ? "script.aspect" : "script.width/height 或默认"
    }）`
  );
  log(`时长 ${durationInFrames} 帧 / ${(durationInFrames / fps).toFixed(2)}s @ ${fps}fps`);
  log(`输出 ${outRel}`);

  await run(
    process.execPath,
    [
      path.join(ROOT, "node_modules", ".bin", "remotion"),
      "render",
      "src/index.ts",
      "StickmanVideo",
      outAbs,
      `--props=${JSON.stringify(props)}`,
      `--fps=${fps}`,
      `--width=${videoSize.width}`,
      `--height=${videoSize.height}`,
    ],
    { cwd: ROOT }
  );

  log(`完成：${outAbs}`);
};

const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/** 与 src/metadata.ts 同步的简化版时间轴计算 */
const buildTimeline = (script, captions, fps) => {
  const shots = Array.isArray(script.shots) ? script.shots : [];
  if (shots.length === 0) {
    const audioDur = captions.length ? captions[captions.length - 1].end : 3;
    return {
      scenes: [],
      durationInFrames: Math.max(1, Math.round(audioDur * fps)),
    };
  }

  const ranges = [];
  const allExplicit = shots.every((s) => typeof s.duration === "number");
  const audioDur = captions.length ? Math.max(...captions.map((c) => c.end)) : 0;
  const captionPerShot = captions.length > 0 && captions.length === shots.length;

  if (captionPerShot) {
    // voice-led：1 句 1 镜，镜头区间 = 对应 caption 的 start/end
    captions.forEach((c) => ranges.push({ start: c.start, end: c.end }));
    ranges[0].start = 0;
    ranges[ranges.length - 1].end = Math.max(audioDur, ranges[ranges.length - 1].end);
  } else if (allExplicit) {
    let cursor = 0;
    for (const s of shots) {
      const d = Math.max(0.5, s.duration);
      ranges.push({ start: cursor, end: cursor + d });
      cursor += d;
    }
  } else if (captions.length > 0) {
    const groups = Array.from({ length: shots.length }, () => []);
    captions.forEach((c, i) => {
      const idx = Math.min(shots.length - 1, Math.floor((i * shots.length) / captions.length));
      groups[idx].push(c);
    });
    groups.forEach((g) => {
      if (g.length === 0) {
        const prev = ranges[ranges.length - 1];
        const cur = prev ? prev.end : 0;
        ranges.push({ start: cur, end: cur + 2 });
      } else {
        ranges.push({ start: g[0].start, end: g[g.length - 1].end });
      }
    });
    ranges[0].start = 0;
    ranges[ranges.length - 1].end = Math.max(audioDur, ranges[ranges.length - 1].end);
  } else {
    const total = audioDur || shots.length * 3;
    const each = total / shots.length;
    shots.forEach((_, i) => ranges.push({ start: i * each, end: (i + 1) * each }));
  }

  let frameCursor = 0;
  const scenes = shots.map((shot, i) => {
    const { start, end } = ranges[i];
    const durationInFrames = Math.max(1, Math.round((end - start) * fps));
    const from = frameCursor;
    frameCursor += durationInFrames;
    // 故事片的镜没有 heading，用 scene/framing 给个可读名字
    const label =
      shot.scene && Array.isArray(shot.cast) && shot.cast.length > 0
        ? `${shot.scene}/${shot.framing ?? "wide"}`
        : shot.heading ?? "";
    return {
      heading: shot.heading ?? "",
      label,
      from,
      durationInFrames,
      start,
      end,
    };
  });

  return { scenes, durationInFrames: Math.max(1, frameCursor) };
};

main().catch((err) => {
  console.error("[render] 失败：", err.message);
  process.exit(1);
});
