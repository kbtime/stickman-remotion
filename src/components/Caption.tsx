import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
  text: string;
  palette: {
    ink: string;
    bg: string;
    accent: string;
    muted: string;
  };
};

/**
 * 底部字幕条：两行上限，淡入 + 轻微上移。
 * 字号 / 内边距 / 底距按画布短边缩放：横屏 1280×720 与竖屏 720×1280 观感一致。
 */
export const Caption: React.FC<Props> = ({ text, palette }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const scale = Math.min(width, height) / 720;
  const opacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(frame, [0, 8], [8, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: Math.round(36 * scale),
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: height > width ? "88%" : "76%",
          padding: `${Math.round(14 * scale)}px ${Math.round(28 * scale)}px`,
          borderRadius: Math.round(14 * scale),
          backgroundColor: "rgba(29, 29, 27, 0.86)",
          borderBottom: `${Math.max(2, Math.round(4 * scale))}px solid ${palette.accent}`,
          color: "#FFFFFF",
          fontSize: Math.round(34 * scale),
          lineHeight: 1.35,
          fontWeight: 600,
          letterSpacing: 0.5,
          textAlign: "center",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        {text}
      </div>
    </div>
  );
};
