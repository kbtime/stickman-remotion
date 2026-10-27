export type Pose =
  | "idle"
  | "walk"
  | "point"
  | "think"
  | "wave"
  | "shrug"
  | "celebrate"
  | "busy";

export const POSES: Pose[] = [
  "idle",
  "walk",
  "point",
  "think",
  "wave",
  "shrug",
  "celebrate",
  "busy",
];

export type Caption = {
  /** 秒 */
  start: number;
  /** 秒 */
  end: number;
  text: string;
};

/** 景别：全景走位 / 中景角色+道具 / 近景表情手势 */
export type Framing = "wide" | "medium" | "close";

/** 故事场景背景 */
export type SceneId =
  | "office"
  | "queue"
  | "desk"
  | "stage"
  | "meeting"
  // 德鲁克「成效 vs 效率」专用场景
  | "busy-desk"
  | "customer-gap"
  | "split-board"
  | "priority-room";

export const SCENE_IDS: SceneId[] = [
  "office",
  "queue",
  "desk",
  "stage",
  "meeting",
  "busy-desk",
  "customer-gap",
  "split-board",
  "priority-room",
];
export const FRAMINGS: Framing[] = ["wide", "medium", "close"];

/** 可摆在场景里的道具 */
export type PropId =
  | "monitor"
  | "cloud"
  | "laptop"
  | "clapper"
  | "progress"
  | "board"
  // 德鲁克样片专用道具
  | "spreadsheet"
  | "checklist"
  | "customer"
  | "label-speed"
  | "label-effect"
  | "goal-card";

export const PROP_IDS: PropId[] = [
  "monitor",
  "cloud",
  "laptop",
  "clapper",
  "progress",
  "board",
  "spreadsheet",
  "checklist",
  "customer",
  "label-speed",
  "label-effect",
  "goal-card",
];

/** 分屏背景的强调侧：left / right 单侧重，both 两侧都清晰 */
export type SplitFocus = "left" | "right" | "both";

export const SPLIT_FOCUSES: SplitFocus[] = ["left", "right", "both"];

/** 整片调色板：warm = 原暖灰纸感；slate = 商业冷静灰蓝 */
export type Theme = "warm" | "slate";

export const THEMES: Theme[] = ["warm", "slate"];

/** 角色走位动作 */
export type CastAction =
  | "enter-left"
  | "enter-right"
  | "exit-left"
  | "exit-right"
  | "walk-to"
  | "none";

export const CAST_ACTIONS: CastAction[] = [
  "enter-left",
  "enter-right",
  "exit-left",
  "exit-right",
  "walk-to",
  "none",
];

export type CastMember = {
  /** "hero" | "npc" 等 */
  id: string;
  /** 0–1 设计坐标（相对画面宽） */
  x: number;
  /** 0–1，默认脚底约 0.78 */
  y?: number;
  /** 默认 1 */
  scale?: number;
  pose: Pose;
  action?: CastAction;
  /** 水平翻转 */
  facing?: "left" | "right";
  /** 描边色，双人区分 */
  color?: string;
  /** 角色所在侧，split-board 分屏时用来跟随 splitFocus 淡化 */
  side?: "left" | "right";
};

export type ShotProp = {
  id: PropId;
  x: number;
  y: number;
  scale?: number;
  /** 镜内秒，默认 0 */
  appearAt?: number;
  /** 道具上的文字（board / goal-card / label-* 等） */
  label?: string;
  /** 道具所在侧，split-board 分屏时用来跟随 splitFocus 淡化 */
  side?: "left" | "right";
  /** 手动压暗（次要元素） */
  dim?: boolean;
};

// Shot 变为联合/扩展：旧字段保留可选；故事片用新字段
export type Shot = {
  // 旧 PPT 模式（sample / sample-short）仍可用：
  heading?: string;
  bullets?: string[];
  pose?: Pose;
  // 故事片：
  scene?: SceneId;
  framing?: Framing;
  cast?: CastMember[];
  props?: ShotProp[];
  /** 仅 split-board 使用：强调左/右/两侧 */
  splitFocus?: SplitFocus;
  /** 本镜字幕优先；否则用 narration[i] */
  caption?: string;
  // 共用：
  duration?: number;
  beat?: string;
  motion?: string;
};

export type Script = {
  title: string;
  /** card = 左标题右小人；story = 场景 + 走位。缺省自动推断 */
  mode?: "card" | "story";
  /** 整片调色：warm（默认暖灰）| slate（商业冷静灰蓝） */
  theme?: Theme;
  narration: string[];
  shots: Shot[];
  fps: number;
  width: number;
  height: number;
  /** 画幅；给了就覆盖 width/height。缺省按 width/height 推断，再缺省 16:9 */
  aspect?: Aspect;
  /** 由 scripts/tts.mjs 写入，供渲染层使用 */
  captions?: Caption[];
  /** public/ 下的相对路径，例如 narration.mp3 */
  audio?: string | null;
  /** edge-tts 语速，例如 "-8%" */
  ttsRate?: string;
};

export const DEFAULT_FPS = 30;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;

/* ─────────────────────────────
 * 画幅：16:9 横屏 / 9:16 竖屏
 * 全部坐标（角色 x/y、道具 x/y）都是相对**实际画布**的 0–1 比例，
 * 换画幅不需要改分镜，站位会自动跟着画布走。
 * ───────────────────────────── */

export type Aspect = "16:9" | "9:16";

export const ASPECTS = ["16:9", "9:16"] as const;

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

/** 从 { aspect, width, height } 里定画幅：显式 aspect > 宽高比 > 默认 16:9 */
export const resolveAspect = (input: {
  aspect?: string;
  width?: number;
  height?: number;
}): Aspect => {
  if (input.aspect === "9:16" || input.aspect === "16:9") return input.aspect;
  if (input.width && input.height) return input.height > input.width ? "9:16" : "16:9";
  return "16:9";
};

export const sizeForAspect = (aspect: Aspect) => ASPECT_SIZE[aspect];

/** 该镜是否走故事片渲染：有场景 + 至少一个角色 */
export const isStoryShot = (shot: Shot): boolean =>
  Boolean(shot.scene && shot.cast && shot.cast.length > 0);

/**
 * 推断整片模式：
 * 1. 显式 mode 优先；
 * 2. 否则只要有任一镜是故事镜，就按 story 处理（card 镜会退化成空标题卡）；
 * 3. 都没有就是 card。
 */
export const resolveMode = (script: Pick<Script, "mode" | "shots">): "card" | "story" =>
  script.mode ?? (script.shots.some(isStoryShot) ? "story" : "card");

const normalizeCast = (cast: CastMember[] | undefined): CastMember[] =>
  (cast ?? []).map((member, i) => ({
    id: member.id || `cast-${i}`,
    x: typeof member.x === "number" ? member.x : 0.5,
    y: member.y,
    scale: member.scale,
    pose: POSES.includes(member.pose) ? member.pose : "idle",
    action: member.action ?? "none",
    facing: member.facing ?? "right",
    color: member.color,
    side: member.side === "left" || member.side === "right" ? member.side : undefined,
  }));

const normalizeProp = (prop: ShotProp): ShotProp => ({
  id: prop.id,
  x: typeof prop.x === "number" ? prop.x : 0.5,
  y: typeof prop.y === "number" ? prop.y : 0.5,
  scale: prop.scale,
  appearAt: prop.appearAt,
  label: prop.label,
  side: prop.side === "left" || prop.side === "right" ? prop.side : undefined,
  dim: prop.dim,
});

const normalizeShot = (shot: Shot): Shot => ({
  heading: shot.heading ?? "",
  bullets: shot.bullets ?? [],
  pose: shot.pose,
  scene: shot.scene && SCENE_IDS.includes(shot.scene) ? shot.scene : undefined,
  framing: shot.framing && FRAMINGS.includes(shot.framing) ? shot.framing : undefined,
  cast: shot.cast ? normalizeCast(shot.cast) : undefined,
  props: shot.props ? shot.props.map(normalizeProp) : undefined,
  splitFocus:
    shot.splitFocus && SPLIT_FOCUSES.includes(shot.splitFocus)
      ? shot.splitFocus
      : undefined,
  caption: shot.caption,
  duration: shot.duration,
  beat: shot.beat,
  motion: shot.motion,
});

export const normalizeScript = (input: Partial<Script>): Script => {
  const shots = (input.shots ?? []).map(normalizeShot);
  // 画幅：aspect 优先（同时给出时会被覆盖），否则显式 width/height 保留，最后默认 16:9
  const aspect = resolveAspect(input);
  const size =
    input.aspect !== undefined
      ? sizeForAspect(aspect)
      : {
          width: input.width ?? sizeForAspect(aspect).width,
          height: input.height ?? sizeForAspect(aspect).height,
        };
  return {
    title: input.title ?? "未命名",
    mode: input.mode,
    theme: input.theme && THEMES.includes(input.theme) ? input.theme : undefined,
    narration: input.narration ?? [],
    shots,
    fps: input.fps ?? DEFAULT_FPS,
    width: size.width,
    height: size.height,
    aspect,
    captions: input.captions ?? [],
    audio: input.audio ?? null,
    ttsRate: input.ttsRate,
  };
};
