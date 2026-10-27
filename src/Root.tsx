import React from "react";
import { Composition } from "remotion";
import { StickmanVideo } from "./StickmanVideo";
import { computeMetadata } from "./metadata";
import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  normalizeScript,
  type Script,
} from "./types";

const defaultProps: Script = normalizeScript({
  title: "为什么本地渲染火柴人视频",
  narration: [
    "先说结论，本地渲染不是怀旧，而是可控。",
    "云端生成要先排队，本地渲染按下回车就开始。",
    "第二个好处是成本，渲染一小时只花电费。",
    "第三个好处是修改，改一句话十秒就能重出。",
    "所以别等模型，先把手上的稿子渲出来。",
  ],
  shots: [
    { heading: "本地渲染", bullets: ["不是怀旧，是可控"], pose: "point" },
    { heading: "不等排队", bullets: ["按回车就开跑", "零云端依赖"], pose: "idle" },
    { heading: "成本更低", bullets: ["只花电费", "失败可重跑"], pose: "think" },
    { heading: "改一句话", bullets: ["十秒重出", "版本可回溯"], pose: "wave" },
    { heading: "现在就渲", bullets: ["先出样片", "再谈打磨"], pose: "point" },
  ],
  fps: DEFAULT_FPS,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  captions: [],
  audio: null,
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StickmanVideo"
      component={StickmanVideo}
      durationInFrames={300}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const script = normalizeScript(props);
        return computeMetadata(script);
      }}
    />
  );
};
