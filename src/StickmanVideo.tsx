import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SceneCard } from "./components/SceneCard";
import { StoryStage } from "./components/StoryStage";
import { Caption } from "./components/Caption";
import type { StoryPalette } from "./components/Backgrounds";
import { buildScenes } from "./metadata";
import { isStoryShot, normalizeScript, resolveMode, type Script } from "./types";

const PALETTE = {
  bg: "#FDFDFC",
  grid: "#E8E6E1",
  ink: "#1D1D1B",
  accent: "#E8543F",
  muted: "#8A857D",
};

/** 故事片背景色板：同一套暖灰纸感 + 砖红强调，场景靠形状区分 */
const STORY_PALETTE: StoryPalette = {
  ink: "#1D1D1B",
  bg: "#FBF9F5",
  accent: "#E8543F",
  muted: "#8A857D",
  soft: "#EDE8DF",
  ground: "#D9D2C5",
  deep: "#3B3833",
};

/**
 * slate 调色板：商业冷静灰蓝。
 * 强调色用钢蓝 / 墨青，禁止出现暖调 #E8543F 砖红。
 */
const STORY_PALETTE_SLATE: StoryPalette = {
  ink: "#16202B",
  bg: "#EEF2F6",
  accent: "#3F6E8C",
  muted: "#7C8B99",
  soft: "#DDE5EC",
  ground: "#C3D0DA",
  deep: "#27343F",
};

/** slate 下字幕条也是冷灰蓝（不沿用砖红） */
const CAPTION_PALETTE_SLATE = {
  bg: "#EEF2F6",
  grid: "#DDE5EC",
  ink: "#16202B",
  accent: "#3F6E8C",
  muted: "#7C8B99",
};

const Grid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage: `linear-gradient(${PALETTE.grid} 1px, transparent 1px), linear-gradient(90deg, ${PALETTE.grid} 1px, transparent 1px)`,
      backgroundSize: "64px 64px",
      opacity: 0.55,
    }}
  />
);

/** 本镜字幕：优先 shot.caption，其次 narration[i]（仅在 captions 时间轴缺失时用） */
const shotCaptionText = (script: Script, i: number): string | null => {
  const shot = script.shots[i];
  const text = shot?.caption?.trim() || script.narration[i]?.trim();
  return text ? text : null;
};

export const StickmanVideo: React.FC<Partial<Script>> = (rawProps) => {
  const script = normalizeScript(rawProps);
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const now = frame / fps;

  const scenes = buildScenes(script);
  const mode = resolveMode(script);
  const isStory = mode === "story";

  const storyPalette = script.theme === "slate" ? STORY_PALETTE_SLATE : STORY_PALETTE;
  const captionPalette = script.theme === "slate" ? CAPTION_PALETTE_SLATE : PALETTE;

  // 有 TTS 时间轴就按时间取；没有时退回「按镜取 caption/narration」
  const globalCaptions = script.captions ?? [];
  const activeScene = scenes.find(
    (s) => frame >= s.from && frame < s.from + s.durationInFrames
  );
  const activeIndex = activeScene ? scenes.indexOf(activeScene) : -1;

  let currentText: string | null = null;
  if (globalCaptions.length > 0) {
    const c = globalCaptions.find((cap) => now >= cap.start && now < cap.end);
    if (c) {
      currentText = c.text;
    }
  }
  if (!currentText && activeIndex >= 0) {
    currentText = shotCaptionText(script, activeIndex);
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: isStory ? storyPalette.bg : PALETTE.bg,
        fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
      }}
    >
      {/* 网格只用于 card 模式；故事模式由背景层负责画面 */}
      {isStory ? null : <Grid />}

      {scenes.map((scene, i) => {
        const story = isStoryShot(scene.shot);
        const name = story
          ? `shot-${i + 1} ${scene.shot.scene} ${scene.shot.framing ?? "wide"}`
          : `shot-${i + 1} ${scene.shot.heading ?? ""}`;
        return (
          <Sequence
            key={`${i}-${name}`}
            from={scene.from}
            durationInFrames={scene.durationInFrames}
            name={name.trim()}
          >
            {story ? (
              <StoryStage
                shot={scene.shot}
                durationInFrames={scene.durationInFrames}
                index={i + 1}
                palette={storyPalette}
              />
            ) : (
              <SceneCard
                heading={scene.shot.heading ?? ""}
                bullets={scene.shot.bullets ?? []}
                pose={scene.shot.pose ?? "idle"}
                prevPose={i > 0 ? scenes[i - 1].shot.pose ?? "idle" : null}
                durationInFrames={scene.durationInFrames}
                index={i + 1}
                total={scenes.length}
                palette={PALETTE}
              />
            )}
          </Sequence>
        );
      })}

      {currentText ? <Caption text={currentText} palette={isStory ? captionPalette : PALETTE} /> : null}

      {script.audio ? <Audio src={staticFile(script.audio)} /> : null}
    </AbsoluteFill>
  );
};
