import type { Caption, Script, Shot } from "./types";

export type SceneTiming = {
  shot: Shot;
  /** 帧 */
  from: number;
  durationInFrames: number;
  start: number;
  end: number;
};

export type VideoMetadata = {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  scenes: SceneTiming[];
  captions: Caption[];
  audioDuration: number;
  totalDuration: number;
  script: Script;
};

/**
 * 镜头时间轴规则（voice-led，先旁白后分镜）：
 * 1. 若 captions.length === shots.length（且 > 0）：一镜一句，
 *    镜头区间直接取对应 caption 的 start/end。
 * 2. 否则若全部 shots 都显式给了 duration，按 duration 排。
 * 3. 否则把 captions 按顺序平均切成 shots.length 组，
 *    每个镜头的区间 = 该组第一条 caption 的开始 → 最后一条的结束。
 * 4. 既无 duration 也无 captions：在旁白总时长内均分；再没有就默认 3 秒一镜。
 *
 * 首镜 start 钳到 0，末镜 end 钳到 max(旁白时长, 末句结束)。
 */
const splitEvenly = <T,>(items: T[], groups: number): T[][] => {
  if (groups <= 0) return [];
  const out: T[][] = Array.from({ length: groups }, () => []);
  items.forEach((item, i) => {
    const idx = Math.min(groups - 1, Math.floor((i * groups) / items.length));
    out[idx].push(item);
  });
  return out;
};

export const buildScenes = (script: Script): SceneTiming[] => {
  const fps = script.fps || 30;
  const captions = script.captions ?? [];
  const audioDuration =
    captions.length > 0 ? Math.max(...captions.map((c) => c.end)) : 0;

  if (script.shots.length === 0) {
    const fallback = Math.max(3, audioDuration || 3);
    return [
      {
        shot: { heading: script.title, bullets: [], pose: "idle", caption: script.narration[0] },
        from: 0,
        durationInFrames: Math.round(fallback * fps),
        start: 0,
        end: fallback,
      },
    ];
  }

  const allExplicit = script.shots.every((s) => typeof s.duration === "number");
  const captionPerShot =
    captions.length > 0 && captions.length === script.shots.length;
  const ranges: Array<{ start: number; end: number }> = [];

  if (captionPerShot) {
    // voice-led：1 句 1 镜，镜头跟着旁白走
    for (const caption of captions) {
      ranges.push({ start: caption.start, end: caption.end });
    }
    ranges[0].start = 0;
    const tail = Math.max(audioDuration, ranges[ranges.length - 1].end);
    ranges[ranges.length - 1].end = tail;
  } else if (allExplicit) {
    let cursor = 0;
    for (const shot of script.shots) {
      const d = Math.max(0.5, shot.duration as number);
      ranges.push({ start: cursor, end: cursor + d });
      cursor += d;
    }
  } else if (captions.length > 0) {
    const groups = splitEvenly(captions, script.shots.length);
    for (const group of groups) {
      if (group.length === 0) {
        const last = ranges[ranges.length - 1];
        const cursor = last ? last.end : 0;
        ranges.push({ start: cursor, end: cursor + 2 });
      } else {
        ranges.push({ start: group[0].start, end: group[group.length - 1].end });
      }
    }
    // 首镜从 0 开始，末镜延到旁白结束，避免画面前后有空档
    if (ranges.length > 0) {
      ranges[0].start = 0;
      const tail = Math.max(audioDuration, ranges[ranges.length - 1].end);
      ranges[ranges.length - 1].end = tail;
    }
  } else {
    const total = audioDuration || script.shots.length * 3;
    const each = total / script.shots.length;
    script.shots.forEach((_, i) => {
      ranges.push({ start: i * each, end: (i + 1) * each });
    });
  }

  let frameCursor = 0;
  return script.shots.map((shot, i) => {
    const { start, end } = ranges[i];
    const durationInFrames = Math.max(1, Math.round((end - start) * fps));
    const from = frameCursor;
    frameCursor += durationInFrames;
    return { shot, from, durationInFrames, start, end };
  });
};

export const computeMetadata = (script: Script) => {
  const fps = script.fps || 30;
  const scenes = buildScenes(script);
  const totalFrames = scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
  const audioDuration =
    scenes.length > 0 ? scenes[scenes.length - 1].end : 0;

  return {
    durationInFrames: Math.max(1, totalFrames),
    fps,
    width: script.width,
    height: script.height,
    props: {
      ...script,
      captions: script.captions ?? [],
      audio: script.audio ?? null,
    },
  };
};
