import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { StickFigure } from "./StickFigure";
import type { Pose } from "../types";

type Palette = {
  ink: string;
  bg: string;
  accent: string;
  muted: string;
  grid?: string;
};

type Props = {
  heading: string;
  bullets: string[];
  pose: Pose;
  /** 上一镜姿态，用于换 pose 插值过渡；首镜传 null */
  prevPose?: Pose | null;
  /** 本镜总帧数，用于计算末 10 帧离场 */
  durationInFrames: number;
  index: number;
  total: number;
  palette: Palette;
};

const ENTER_FRAMES = 10;
const EXIT_FRAMES = 10;
const STAGGER = 5; // 要点之间的间隔帧

/** 横屏设计基准宽度 */
const WIDE_BASE = 1280;
/** 竖屏设计基准宽度（720 宽画布下的字号/间距都在这个基准上写） */
const TALL_BASE = 720;

/**
 * 单个镜头。
 * - 横屏（16:9）：左标题 + 右火柴人
 * - 竖屏（9:16）：上标题区 + 下火柴人，纵向堆叠，底部留字幕带
 */
export const SceneCard: React.FC<Props> = ({
  heading,
  bullets,
  pose,
  prevPose = null,
  durationInFrames,
  index,
  total,
  palette,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const isTall = height > width;

  // 字号 / 间距按画布宽度等比缩放
  const scale = isTall ? width / TALL_BASE : width / WIDE_BASE;
  // 竖屏：人物占下半区，同时不超过画布宽
  const figureSize = isTall
    ? Math.min(height * 0.3, width * 0.62)
    : Math.min(height * 0.62, 460) * (width / WIDE_BASE);

  // 入场：内容 translateY + opacity
  const enter = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 离场：末 10 帧 opacity↓ + 轻微左移
  const exitStart = Math.max(ENTER_FRAMES, durationInFrames - EXIT_FRAMES);
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = enter * (1 - exit);
  const contentY = (1 - enter) * 26;
  const contentX = -exit * 40;

  // 火柴人：从右（横屏）/ 从下（竖屏）滑入
  const figureIn = interpolate(frame, [0, ENTER_FRAMES + 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const figureX = isTall ? 0 : (1 - figureIn) * 140 - exit * 60;
  const figureY = isTall ? (1 - figureIn) * 90 + exit * 60 : 0;

  const titleIn = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headingSize = (isTall ? 52 : 66) * scale;
  const bulletSize = (isTall ? 30 : 32) * scale;

  const titleBlock = (
    <div
      style={{
        maxWidth: (isTall ? 600 : 640) * scale,
        transform: isTall
          ? `translate(${contentX}px, ${contentY}px)`
          : `translate(${contentX}px, ${contentY}px)`,
        textAlign: isTall ? "center" : "left",
      }}
    >
      <div
        style={{
          display: "inline-block",
          fontSize: 18 * scale,
          fontWeight: 700,
          letterSpacing: 3,
          color: palette.accent,
          marginBottom: 14 * scale,
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </div>
      <div
        style={{
          fontSize: headingSize,
          fontWeight: 800,
          lineHeight: 1.12,
          color: palette.ink,
          marginBottom: (isTall ? 20 : 28) * scale,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 18}px)`,
        }}
      >
        {heading}
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "inline-block",
        }}
      >
        {bullets.map((b, i) => {
          // 标题先出现，要点每条错开 STAGGER 帧
          const d = ENTER_FRAMES * 0.6 + i * STAGGER;
          const o = interpolate(frame, [d, d + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isTall ? "center" : "flex-start",
                gap: 16 * scale,
                fontSize: bulletSize,
                color: palette.ink,
                marginBottom: 16 * scale,
                opacity: o,
                transform: `translateY(${(1 - o) * 14}px)`,
              }}
            >
              <span
                style={{
                  width: 12 * scale,
                  height: 12 * scale,
                  borderRadius: 3,
                  backgroundColor: palette.accent,
                  flex: "none",
                }}
              />
              {b}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const figureBlock = (
    <div
      style={{
        flex: "none",
        paddingRight: isTall ? 0 : 20 * scale,
        transform: `translate(${figureX}px, ${figureY}px)`,
      }}
    >
      <StickFigure
        pose={pose}
        prevPose={prevPose}
        transitionFrames={10}
        size={figureSize}
        color={palette.ink}
      />
    </div>
  );

  // 竖屏：上下堆叠，标题在上、火柴人在下，底部留给字幕
  if (isTall) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 48 * scale,
          paddingRight: 48 * scale,
          paddingTop: 120 * scale,
          paddingBottom: 260 * scale,
          boxSizing: "border-box",
          opacity,
        }}
      >
        {titleBlock}
        {figureBlock}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 100 * scale,
        paddingRight: 100 * scale,
        paddingBottom: 130 * scale,
        boxSizing: "border-box",
        opacity,
      }}
    >
      {titleBlock}
      {figureBlock}
    </div>
  );
};
