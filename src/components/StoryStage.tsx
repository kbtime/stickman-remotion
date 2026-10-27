import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { StickFigure } from "./StickFigure";
import { Background, type StoryPalette } from "./Backgrounds";
import { PROP_METRICS, Prop } from "./Props";
import type { CastMember, CastAction, Framing, Shot } from "../types";

type Props = {
  shot: Shot;
  /** 本镜总帧数（用于整镜淡入淡出） */
  durationInFrames: number;
  index: number;
  palette: StoryPalette;
};

/** 整镜淡入 / 淡出帧数 */
const FADE_IN = 9;
const FADE_OUT = 9;
/** 走位动作持续时间 */
const ENTER_FRAMES = 12;
const EXIT_FRAMES = 10;
const WALK_TO_FRAMES = 14;
/** 道具淡入帧数 */
const PROP_FADE = 10;
/** 角色脚底默认 y（0–1）：横屏 0.78，竖屏 0.82（底边留给字幕） */
const DEFAULT_FEET_Y_WIDE = 0.78;
const DEFAULT_FEET_Y_TALL = 0.82;
/** 角色高度占画布高的比例（缩放前） */
const FIGURE_H_RATIO = 0.42;
/** 宽银幕时人物也不超过画布宽的 55% */
const FIGURE_W_LIMIT_RATIO = 0.55;
/** 道具尺寸基准：以 720px 短边为 1 */
const PROP_BASE = 720;

/** 景别：整层缩放 + 焦点 */
const FRAMING: Record<Framing, { zoom: number; focusX: number; focusY: number }> = {
  wide: { zoom: 1, focusX: 0.5, focusY: 0.5 },
  medium: { zoom: 1.25, focusX: 0.5, focusY: 0.62 },
  close: { zoom: 1.55, focusX: 0.44, focusY: 0.58 },
};

/** 竖屏景别：画布近方形偏长，close 焦点略上移，避免切到脸/脚 */
const FRAMING_TALL: Record<Framing, { zoom: number; focusX: number; focusY: number }> = {
  wide: { zoom: 1, focusX: 0.5, focusY: 0.5 },
  medium: { zoom: 1.16, focusX: 0.5, focusY: 0.56 },
  close: { zoom: 1.38, focusX: 0.5, focusY: 0.55 },
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 分屏聚焦：非焦点侧压暗到多少（0–1） */
const SPLIT_DIM = 0.32;

/** 某侧是否被 splitFocus 淡化 */
const sideDimmed = (
  side: "left" | "right" | undefined,
  focus: Shot["splitFocus"]
): boolean => {
  if (!side || !focus || focus === "both") return false;
  return side !== focus;
};

/**
 * 角色在镜内的水平位置（当前画布像素中心点）。
 * - enter-left / enter-right：前 ENTER_FRAMES 帧从画外滑到目标 x
 * - walk-to：从旁侧走进目标 x（默认从左边进）
 * - exit-left / exit-right：末 EXIT_FRAMES 帧滑出画外
 */
const castX = (
  member: CastMember,
  frame: number,
  durationInFrames: number,
  stageW: number,
  figureH: number
): { x: number; walking: boolean } => {
  const target = member.x * stageW;
  const action: CastAction = member.action ?? "none";
  const reach = 0.35 * figureH;
  const offLeft = -reach;
  const offRight = stageW + reach;

  switch (action) {
    case "enter-left":
    case "enter-right": {
      const p = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
        ...clamp,
        easing: Easing.out(Easing.cubic),
      });
      const from = action === "enter-left" ? offLeft : offRight;
      return { x: from + (target - from) * p, walking: p < 1 };
    }
    case "walk-to": {
      const p = interpolate(frame, [0, WALK_TO_FRAMES], [0, 1], {
        ...clamp,
        easing: Easing.inOut(Easing.cubic),
      });
      const from = member.facing === "left" ? offRight : offLeft;
      return { x: from + (target - from) * p, walking: true };
    }
    case "exit-left":
    case "exit-right": {
      const start = Math.max(0, durationInFrames - EXIT_FRAMES);
      const p = interpolate(frame, [start, durationInFrames], [0, 1], {
        ...clamp,
        easing: Easing.in(Easing.cubic),
      });
      const to = action === "exit-left" ? offLeft : offRight;
      return { x: target + (to - target) * p, walking: true };
    }
    case "none":
    default:
      return { x: target, walking: false };
  }
};

/** 角色高度：约 0.42 画布高，宽屏时不超过 0.55 画布宽 */
const figureHeight = (stageW: number, stageH: number, memberScale: number) => {
  const byHeight = FIGURE_H_RATIO * stageH;
  const byWidth = FIGURE_W_LIMIT_RATIO * stageW * 0.75; // StickFigure 宽 = 0.75 高
  return Math.min(byHeight, byWidth) * memberScale;
};

const CastFigure: React.FC<{
  member: CastMember;
  /** splitFocus 淡化（0–1） */
  opacity?: number;
  frame: number;
  durationInFrames: number;
  stageW: number;
  stageH: number;
  defaultFeetY: number;
  palette: StoryPalette;
}> = ({
  member,
  frame,
  durationInFrames,
  stageW,
  stageH,
  defaultFeetY,
  palette,
  opacity = 1,
}) => {
  const memberScale = member.scale ?? 1;
  const figureH = figureHeight(stageW, stageH, memberScale);
  const { x, walking } = castX(member, frame, durationInFrames, stageW, figureH);
  const feetY = (member.y ?? defaultFeetY) * stageH;
  const facing = member.facing ?? "right";
  // 走位时不管 pose 写的是啥，腿都要动
  const pose = walking ? "walk" : member.pose ?? "idle";

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: feetY,
        width: 0,
        height: 0,
        opacity,
        transition: "opacity 240ms linear",
      }}
    >
      <div
        style={{
          position: "absolute",
          // StickFigure 的脚底约在 SVG 高度的 0.96 处，这里对齐到 y
          left: -(figureH * 0.75) / 2,
          top: -figureH * 0.96,
        }}
      >
        <StickFigure
          pose={pose}
          prevPose={null}
          transitionFrames={0}
          size={figureH}
          color={member.color ?? palette.ink}
          facing={facing}
          autoEnter={false}
        />
      </div>
    </div>
  );
};

/**
 * 故事片单镜：背景 + 道具 + 角色走位，无左侧标题/要点。
 * 所有 0–1 坐标都相对**实际画布**（useVideoConfig 的 width/height），
 * 横屏 16:9 与竖屏 9:16 共用同一份分镜，不再经过固定 1280×720 设计层缩放。
 */
export const StoryStage: React.FC<Props> = ({ shot, durationInFrames, index, palette }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const stageW = width;
  const stageH = height;
  const isTall = stageH > stageW;

  const framing = (isTall ? FRAMING_TALL : FRAMING)[shot.framing ?? "wide"];
  const defaultFeetY = isTall ? DEFAULT_FEET_Y_TALL : DEFAULT_FEET_Y_WIDE;
  // 道具：以短边 720 为基准等比缩放，竖屏不会过大/过小
  const propScale = Math.min(stageW, stageH) / PROP_BASE;

  // 整镜淡入 / 淡出
  const fadedIn = interpolate(frame, [0, FADE_IN], [0, 1], clamp);
  const fadeOutStart = Math.max(FADE_IN, durationInFrames - FADE_OUT);
  const fadedOut = interpolate(frame, [fadeOutStart, durationInFrames], [0, 1], clamp);
  const opacity = fadedIn * (1 - fadedOut);
  // 镜头轻微推近，避免整镜死板（宽景更明显，近景更少）
  const drift = shot.framing === "wide" ? 0.03 : 0.015;
  const zoom =
    framing.zoom *
    interpolate(frame, [0, durationInFrames], [1, 1 + drift], clamp);

  // 焦点：把 focus 点拉到画面中心（1:1 缩放时画布铺满，无需 cover 缩放）
  const focusPx = { x: framing.focusX * stageW, y: framing.focusY * stageH };
  const translateX = -(focusPx.x - stageW / 2);
  const translateY = -(focusPx.y - stageH / 2);

  const elapsed = frame / fps;
  const cast = shot.cast ?? [];
  const props = shot.props ?? [];

  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden", backgroundColor: palette.bg }}>
      <AbsoluteFill
        style={{
          transformOrigin: "50% 50%",
          transform: `scale(${zoom}) translate(${translateX}px, ${translateY}px)`,
        }}
      >
        <Background scene={shot.scene ?? "office"} palette={palette} stageW={stageW} stageH={stageH} />

        {/* split-board 并置对比：非焦点侧盖一层底色 + 焦点侧轻描边 */}
        {shot.scene === "split-board" && shot.splitFocus && shot.splitFocus !== "both" ? (
          <>
            <div
              style={{
                position: "absolute",
                left: shot.splitFocus === "left" ? stageW / 2 : 0,
                top: 0,
                width: stageW / 2,
                height: stageH,
                background: palette.bg,
                opacity: 0.55,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: shot.splitFocus === "left" ? 0 : stageW / 2,
                top: 0,
                width: stageW / 2,
                height: stageH,
                boxShadow: `inset 0 0 0 ${Math.round(6 * propScale)}px ${palette.accent}`,
                opacity: 0.28,
              }}
            />
          </>
        ) : null}

        {props.map((prop, i) => {
          const appearAt = prop.appearAt ?? 0;
          const appearFrames = Math.max(1, appearAt * fps);
          const inP = interpolate(frame, [appearFrames, appearFrames + PROP_FADE], [0, 1], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          const metrics = PROP_METRICS[prop.id];
          // 显示尺寸 = 设计尺寸 × 短边适配 × 道具自身 scale
          const sizeScale = propScale * (prop.scale ?? 1);
          const propW = metrics.w * sizeScale;
          const propH = metrics.h * sizeScale;
          // 分屏聚焦 / 手动次要：压暗非焦点侧
          const dimmed = prop.dim || sideDimmed(prop.side, shot.splitFocus);
          const focusOpacity = dimmed ? SPLIT_DIM : 1;
          return (
            <div
              key={`${prop.id}-${i}`}
              style={{
                position: "absolute",
                left: prop.x * stageW - propW / 2,
                top: prop.y * stageH - propH,
                width: propW,
                height: propH,
                opacity: inP * focusOpacity,
                transform: `translateY(${(1 - inP) * 14 * propScale}px)`,
                transition: "opacity 240ms linear",
              }}
            >
              <Prop id={prop.id} palette={palette} elapsed={elapsed} label={prop.label} />
            </div>
          );
        })}

        {cast.map((member) => (
          <CastFigure
            key={member.id}
            member={member}
            frame={frame}
            durationInFrames={durationInFrames}
            stageW={stageW}
            stageH={stageH}
            defaultFeetY={defaultFeetY}
            palette={palette}
            opacity={sideDimmed(member.side, shot.splitFocus) ? SPLIT_DIM : 1}
          />
        ))}
      </AbsoluteFill>

      {/* 角落镜号：极小、低对比，不抢画面 */}
      <div
        style={{
          position: "absolute",
          right: Math.round(28 * propScale),
          top: Math.round(24 * propScale),
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: Math.round(18 * propScale),
          fontWeight: 700,
          letterSpacing: 2,
          color: palette.muted,
          opacity: 0.55 * opacity,
        }}
      >
        {String(index).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

export type { StoryPalette };
