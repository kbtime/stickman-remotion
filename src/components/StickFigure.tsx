import React from "react";
import { interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Pose } from "../types";

type Props = {
  pose?: Pose;
  /** 上一镜的姿态；给了就在前 transitionFrames 帧内插值过渡 */
  prevPose?: Pose | null;
  /** pose 过渡帧数，默认 10 */
  transitionFrames?: number;
  /** 逻辑高度，宽度按 3:4 比例自动 */
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  /** 自行从右侧滑入 + 淡入；故事片由舞台接管走位时传 false */
  autoEnter?: boolean;
  /** 水平翻转（朝向左侧） */
  facing?: "left" | "right";
};

const LIMB = 14; // 线宽

/**
 * 一套姿态 = 静止目标角 + 镜内循环动作偏移。
 * 角度单位：度。手臂 0 = 自然下垂，90 = 水平外抬，180 = 举起过头。
 * 腿 0 = 竖直，正值 = 向外叉开。
 */
type Rig = {
  /** 上臂（左右） */
  upperL: number;
  upperR: number;
  /** 前臂（左右） */
  lowerL: number;
  lowerR: number;
  /** 左右腿整体摆动角 */
  legL: number;
  legR: number;
  /** 身体水平位移 px */
  shiftX: number;
  /** 髋部上下位移 px（跳跃） */
  hipY: number;
  /** 头部倾斜 */
  headTilt: number;
  /** 躯干倾斜 */
  torsoLean: number;
};

const BASE: Rig = {
  upperL: 18,
  upperR: 18,
  lowerL: 10,
  lowerR: 10,
  legL: 12,
  legR: -12,
  shiftX: 0,
  hipY: 0,
  headTilt: 0,
  torsoLean: 0,
};

/** 各 pose 的身体目标角（不含时间偏移） */
const TARGET: Record<Pose, Rig> = {
  idle: { ...BASE },
  walk: { ...BASE, upperL: 28, upperR: 28, lowerL: 42, lowerR: 42, torsoLean: 4 },
  point: {
    ...BASE,
    upperR: 88, // 上臂接近水平
    lowerR: 90, // 前臂顺延，整条手臂指向右侧
    upperL: 16,
    lowerL: 8,
    legL: 20,
    legR: -16,
    torsoLean: -3,
  },
  think: {
    ...BASE,
    upperR: 42,
    lowerR: 158, // 手托下巴
    upperL: 12,
    lowerL: 6,
    legL: 10,
    legR: -10,
    headTilt: -6,
  },
  wave: {
    ...BASE,
    upperR: 152, // 右手高举
    lowerR: 150,
    upperL: 20,
    lowerL: 12,
    legL: 16,
    legR: -14,
    headTilt: 3,
  },
  shrug: {
    ...BASE,
    upperL: 58, // 双手外翻
    lowerL: 96,
    upperR: 58,
    lowerR: 96,
    legL: 14,
    legR: -14,
  },
  celebrate: {
    ...BASE,
    upperL: 168, // 双手上举
    lowerL: 164,
    upperR: 168,
    lowerR: 164,
    legL: 16,
    legR: -16,
  },
  busy: {
    ...BASE,
    upperL: 46, // 上身前倾、双手落在桌前
    lowerL: 82,
    upperR: 46,
    lowerR: 82,
    legL: 14,
    legR: -14,
    headTilt: 8, // 头略低，看键盘
    torsoLean: 9,
  },
};

const lerpRig = (a: Rig, b: Rig, p: number): Rig => {
  const out = { ...a };
  (Object.keys(a) as Array<keyof Rig>).forEach((k) => {
    out[k] = a[k] + (b[k] - a[k]) * p;
  });
  return out;
};

/** 镜内可感知动作：每个 pose 都有自己的主动作，呼吸只作为背景 */
const motionOf = (pose: Pose, frame: number, fps: number, rig: Rig): Rig => {
  const t = frame / fps;
  const out = { ...rig };

  switch (pose) {
    case "walk": {
      // 0.8 秒一个来回：左右腿交替迈步 + 身体水平位移 50px
      const cycle = 0.8;
      const phase = ((frame / fps) % cycle) / cycle; // 0→1
      const swing = Math.sin(phase * Math.PI * 2);
      out.legL = rig.legL + swing * 22;
      out.legR = rig.legR + swing * 22;
      out.shiftX = rig.shiftX + Math.sin(phase * Math.PI * 2) * 25; // ±25px ≈ 50px 行程
      out.upperL = rig.upperL + swing * 10; // 反向摆臂
      out.upperR = rig.upperR - swing * 10;
      out.hipY = rig.hipY - Math.abs(Math.sin(phase * Math.PI * 2)) * 4;
      break;
    }
    case "point": {
      // 指尖弹跳 ≥12°
      const bounce = Math.sin(t * 5.2) * 14;
      out.lowerR = rig.lowerR + bounce;
      out.upperR = rig.upperR + bounce * 0.35;
      out.torsoLean = rig.torsoLean + Math.sin(t * 2.6) * 1.5;
      break;
    }
    case "wave": {
      // 高举挥动，幅度 ≥25°
      const w = Math.sin(t * 7.5);
      out.upperR = rig.upperR + w * 16;
      out.lowerR = rig.lowerR + Math.sin(t * 7.5 + 0.9) * 18;
      out.headTilt = rig.headTilt + w * 2;
      break;
    }
    case "think": {
      // 手托下巴 + 轻微点头
      out.headTilt = rig.headTilt + Math.sin(t * 2.4) * 5;
      out.lowerR = rig.lowerR + Math.sin(t * 2.4 + 0.6) * 3;
      out.upperL = rig.upperL + Math.sin(t * 1.6) * 2;
      break;
    }
    case "shrug": {
      // 双肩上抬（整体躯干上提 + 手臂外翻节奏）
      const s = (Math.sin(t * 3.4) + 1) / 2; // 0→1
      out.upperL = rig.upperL + s * 14;
      out.upperR = rig.upperR + s * 14;
      out.lowerL = rig.lowerL + s * 10;
      out.lowerR = rig.lowerR + s * 10;
      out.hipY = rig.hipY - s * 6; // 肩线上提的观感
      out.headTilt = rig.headTilt + (s - 0.5) * 4;
      break;
    }
    case "celebrate": {
      // 双手上举 + 跳跃感
      const jump = Math.abs(Math.sin(t * 3.1));
      out.hipY = rig.hipY - jump * 18;
      out.upperL = rig.upperL + Math.sin(t * 3.1 * 2) * 8;
      out.upperR = rig.upperR + Math.sin(t * 3.1 * 2 + 1) * 8;
      out.legL = rig.legL + jump * 6;
      out.legR = rig.legR - jump * 6;
      break;
    }
    case "busy": {
      // 埋头敲键盘：双手小幅交替上下（约 7 次/秒），头保持低，不上下跳
      const tap = Math.sin(t * 22);
      out.lowerR = rig.lowerR + tap * 7;
      out.lowerL = rig.lowerL - tap * 7;
      out.upperR = rig.upperR + tap * 2;
      out.upperL = rig.upperL - tap * 2;
      out.headTilt = rig.headTilt + Math.sin(t * 3.2) * 1.2;
      out.torsoLean = rig.torsoLean + Math.sin(t * 1.4) * 0.6;
      break;
    }
    case "idle":
    default: {
      // 主动作：明显摆臂（不是呼吸）
      out.upperL = rig.upperL + Math.sin(t * 2.6) * 12;
      out.upperR = rig.upperR + Math.sin(t * 2.6 + Math.PI * 0.8) * 12;
      out.lowerL = rig.lowerL + Math.sin(t * 2.6 + 0.4) * 8;
      out.lowerR = rig.lowerR + Math.sin(t * 2.6 + Math.PI * 0.8 + 0.4) * 8;
      break;
    }
  }

  return out;
};

/**
 * 纯 SVG 火柴人：圆头 + 躯干 + 四肢。
 * 所有姿态由关节角程序化生成；换 pose 时对关键关节角做插值过渡。
 */
export const StickFigure: React.FC<Props> = ({
  pose = "idle",
  prevPose = null,
  transitionFrames = 10,
  size = 420,
  color = "#1D1D1B",
  style,
  autoEnter = true,
  facing = "right",
}) => {
  const frame = useCurrentFrame();
  const { fps, width: canvasWidth } = useVideoConfig();

  // 呼吸只做背景，不作为主动作
  const breathe = Math.sin((frame / fps) * 2.1) * 2;

  const target = TARGET[pose] ?? TARGET.idle;
  const live = motionOf(pose, frame, fps, target);

  // pose 过渡：前 transitionFrames 帧从 prevPose 插值到当前 pose
  const p =
    prevPose && prevPose !== pose && transitionFrames > 0
      ? interpolate(frame, [0, transitionFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const prevLive = prevPose
    ? motionOf(prevPose, 0, fps, TARGET[prevPose] ?? TARGET.idle)
    : live;
  const rig = lerpRig(prevLive, live, p);

  // 入场：无 prevPose 时从右侧滑入 12 帧；有 prevPose 时原地过渡
  const slideIn =
    prevPose || !autoEnter
      ? 1
      : interpolate(frame, [0, 12], [0, 1], {
          extrapolateRight: "clamp",
        });
  const appear = autoEnter
    ? interpolate(frame, [0, Math.min(12, transitionFrames + 2)], [0, 1], {
        extrapolateRight: "clamp",
      })
    : 1;
  const enterX = (1 - slideIn) * (canvasWidth * 0.16 + 80);

  // 少量自然抖动，用 seed 保证确定性
  const jitter = (random(`stick-${Math.floor(frame / 6)}`) - 0.5) * 1.2;

  const H = size;
  const W = size * 0.75;
  const cx = W / 2 + rig.shiftX + jitter;
  const headR = H * 0.105;
  const headY = H * 0.155 + breathe;
  const neckY = headY + headR;
  const hipY = H * 0.6 + breathe + rig.hipY;
  const shoulderY = neckY + H * 0.02;

  const torsoShift = Math.tan((rig.torsoLean * Math.PI) / 180) * (hipY - shoulderY);

  const shoulderL = { x: cx - W * 0.1 + torsoShift, y: shoulderY };
  const shoulderR = { x: cx + W * 0.1 + torsoShift, y: shoulderY };
  const hipCx = cx;
  const hipL = { x: hipCx - W * 0.06, y: hipY };
  const hipR = { x: hipCx + W * 0.06, y: hipY };

  const armLen = H * 0.17;
  const forearmLen = H * 0.16;
  const legLen = H * 0.2;

  const deg = (d: number) => (d * Math.PI) / 180;

  const elbow = (
    shoulder: { x: number; y: number },
    angleDeg: number,
    sign: 1 | -1
  ) => ({
    x: shoulder.x + sign * Math.sin(deg(angleDeg)) * armLen,
    y: shoulder.y + Math.cos(deg(angleDeg)) * armLen,
  });

  const hand = (
    elbowPt: { x: number; y: number },
    angleDeg: number,
    sign: 1 | -1
  ) => ({
    x: elbowPt.x + sign * Math.sin(deg(angleDeg)) * forearmLen,
    y: elbowPt.y + Math.cos(deg(angleDeg)) * forearmLen,
  });

  const elbowL = elbow(shoulderL, rig.upperL, -1);
  const handL = hand(elbowL, rig.lowerL, -1);
  const elbowR = elbow(shoulderR, rig.upperR, 1);
  const handR = hand(elbowR, rig.lowerR, 1);

  const foot = (hip: { x: number; y: number }, legAngle: number) => {
    const knee = {
      x: hip.x + Math.sin(deg(legAngle)) * legLen * 0.6,
      y: hip.y + Math.cos(deg(legAngle)) * legLen * 0.55,
    };
    const f = {
      x: knee.x + Math.sin(deg(legAngle)) * legLen * 0.45,
      y: knee.y + Math.cos(deg(legAngle)) * legLen * 0.45,
    };
    return { knee, foot: f };
  };

  const legLPts = foot(hipL, -rig.legL);
  const legRPts = foot(hipR, -rig.legR);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ overflow: "visible", opacity: appear, ...style }}
    >
      <g
        transform={
          facing === "left"
            ? `translate(${enterX} 0) translate(${W} 0) scale(-1 1)`
            : `translate(${enterX} 0)`
        }
        stroke={color}
        strokeWidth={LIMB}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* 躯干 */}
        <line x1={cx + torsoShift} y1={neckY} x2={hipCx} y2={hipY} />
        {/* 头 */}
        <g transform={`rotate(${rig.headTilt} ${cx} ${headY})`}>
          <circle cx={cx} cy={headY} r={headR} fill="#FFFFFF" />
        </g>
        {/* 手臂 */}
        <polyline
          points={`${shoulderL.x},${shoulderL.y} ${elbowL.x},${elbowL.y} ${handL.x},${handL.y}`}
        />
        <polyline
          points={`${shoulderR.x},${shoulderR.y} ${elbowR.x},${elbowR.y} ${handR.x},${handR.y}`}
        />
        {/* 腿 */}
        <polyline
          points={`${hipL.x},${hipY} ${legLPts.knee.x},${legLPts.knee.y} ${legLPts.foot.x},${legLPts.foot.y}`}
        />
        <polyline
          points={`${hipR.x},${hipY} ${legRPts.knee.x},${legRPts.knee.y} ${legRPts.foot.x},${legRPts.foot.y}`}
        />
      </g>
    </svg>
  );
};
