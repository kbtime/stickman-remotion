import React from "react";
import type { SceneId } from "../types";

export type StoryPalette = {
  ink: string;
  bg: string;
  accent: string;
  muted: string;
  /** 背景专用浅色块 */
  soft: string;
  /** 背景专用地面/阴影 */
  ground: string;
  /** 背景专用深色（窗、机器等） */
  deep: string;
};

type BackgroundProps = {
  scene: SceneId;
  palette: StoryPalette;
  /** 实际画布宽（像素），SVG viewBox 与之同尺寸 */
  stageW: number;
  /** 实际画布高（像素） */
  stageH: number;
};

/** 默认设计基准（16:9）。仅作兜底默认值，StoryStage 不再用它做布局 */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * 每个场景都用「画布宽高比例」重画：
 * 每套背景是一个函数 (w, h, p) => JSX，坐标全部由 w/h 推导，
 * 因此 1280×720 与 720×1280 都能铺满，不会出现拉伸错位。
 */
type BgFn = (w: number, h: number, p: StoryPalette) => React.ReactNode;

const OfficeBg: BgFn = (w, h, p) => {
  const floorY = 0.78 * h;
  const winW = 0.234 * w;
  const winH = 0.32 * h;
  const winX = 0.688 * w;
  const winY = 0.1 * h;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 后墙墙板线 */}
      {[0.17, 0.35, 0.52].map((t) => (
        <line key={t} x1={0} y1={t * h} x2={w} y2={t * h} stroke={p.soft} strokeWidth={0.003 * h} />
      ))}
      {/* 窗户 */}
      <rect
        x={winX}
        y={winY}
        width={winW}
        height={winH}
        rx={0.014 * w}
        fill={p.soft}
        stroke={p.deep}
        strokeWidth={0.009 * w}
      />
      <line x1={winX + winW / 2} y1={winY} x2={winX + winW / 2} y2={winY + winH} stroke={p.deep} strokeWidth={0.007 * w} />
      <line x1={winX} y1={winY + winH / 2} x2={winX + winW} y2={winY + winH / 2} stroke={p.deep} strokeWidth={0.007 * w} />
      {/* 窗外远处的云 */}
      <g fill={p.bg} opacity={0.9}>
        <ellipse cx={winX + winW * 0.27} cy={winY + winH * 0.26} rx={winW * 0.14} ry={winH * 0.08} />
        <ellipse cx={winX + winW * 0.73} cy={winY + winH * 0.3} rx={winW * 0.11} ry={winH * 0.06} />
      </g>
      {/* 地板 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.007 * w} />
      {/* 桌子（左下角，宽度按画布窄边收敛，竖屏不横贯） */}
      <rect x={0.0625 * w} y={0.6 * h} width={0.33 * w} height={0.03 * h} rx={0.005 * w} fill={p.deep} />
      <rect x={0.094 * w} y={0.63 * h} width={0.014 * w} height={0.15 * h} fill={p.deep} />
      <rect x={0.344 * w} y={0.63 * h} width={0.014 * w} height={0.15 * h} fill={p.deep} />
      {/* 桌上杯子 */}
      <rect
        x={0.297 * w}
        y={0.545 * h}
        width={0.028 * w}
        height={0.055 * h}
        rx={0.005 * w}
        fill={p.soft}
        stroke={p.ink}
        strokeWidth={0.005 * w}
      />
      {/* 墙上小挂钟 */}
      <circle cx={0.53 * w} cy={0.21 * h} r={0.05 * Math.min(w, h)} fill={p.bg} stroke={p.deep} strokeWidth={0.008 * w} />
      <line
        x1={0.53 * w}
        y1={0.21 * h}
        x2={0.53 * w}
        y2={0.21 * h - 0.035 * Math.min(w, h)}
        stroke={p.deep}
        strokeWidth={0.006 * w}
        strokeLinecap="round"
      />
      <line
        x1={0.53 * w}
        y1={0.21 * h}
        x2={0.553 * w}
        y2={0.223 * h}
        stroke={p.accent}
        strokeWidth={0.006 * w}
        strokeLinecap="round"
      />
    </g>
  );
};

const QueueBg: BgFn = (w, h, p) => {
  // 竖条排队墙：一排立柱，越往后越暗，营造「墙」
  const floorY = 0.78 * h;
  const count = w > h ? 13 : 7;
  const gap = w / count;
  const barW = gap * 0.56;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {Array.from({ length: count }, (_, i) => (
        <rect
          key={i}
          x={gap * 0.42 + i * gap}
          y={0.083 * h}
          width={barW}
          height={floorY - 0.083 * h - 0.07 * h}
          rx={0.006 * w}
          fill={i % 2 === 0 ? p.soft : p.ground}
          stroke={p.deep}
          strokeWidth={0.0024 * w}
          opacity={0.55 + (i % 3) * 0.12}
        />
      ))}
      {/* WAIT 挂牌 */}
      <g transform={`translate(${0.789 * w} ${0.133 * h}) rotate(4)`}>
        <rect x={0} y={0} width={0.153 * w} height={0.128 * h} rx={0.008 * w} fill={p.accent} />
        <text
          x={0.077 * w}
          y={0.086 * h}
          textAnchor="middle"
          fontFamily="ui-monospace, Menlo, monospace"
          fontWeight={800}
          fontSize={0.04 * w}
          letterSpacing={0.004 * w}
          fill={p.bg}
        >
          WAIT
        </text>
      </g>
      {/* 吊线 */}
      <line x1={0.866 * w} y1={0} x2={0.866 * w} y2={0.133 * h} stroke={p.deep} strokeWidth={0.004 * w} />
      {/* 排队地线 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} />
      <line
        x1={0}
        y1={floorY}
        x2={w}
        y2={floorY}
        stroke={p.deep}
        strokeWidth={0.007 * w}
        strokeDasharray={`${0.014 * w} ${0.011 * w}`}
      />
      {/* 地面前进箭头，暗示队伍 */}
      {[0.16, 0.5, 0.84].map((t) => {
        const y = 0.9 * h;
        const len = 0.047 * w;
        const tip = 0.013 * w;
        return (
          <path
            key={t}
            d={`M ${t * w - len / 2} ${y} h ${len} m ${-tip * 1.2} ${-tip} l ${tip * 1.2} ${tip} l ${-tip * 1.2} ${tip}`}
            stroke={p.muted}
            strokeWidth={0.004 * w}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
};

const DeskBg: BgFn = (w, h, p) => {
  const deskY = 0.667 * h;
  const floorY = 0.814 * h;
  const monX = 0.547 * w;
  const monY = 0.125 * h;
  const monW = 0.328 * w;
  const monH = 0.361 * h;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 显示器轮廓（背景层大轮廓，前景道具另画） */}
      <rect x={monX} y={monY} width={monW} height={monH} rx={0.011 * w} fill={p.soft} stroke={p.deep} strokeWidth={0.008 * w} />
      <rect
        x={monX + 0.016 * w}
        y={monY + 0.028 * h}
        width={monW - 0.032 * w}
        height={monH - 0.056 * h}
        rx={0.006 * w}
        fill={p.ground}
        opacity={0.7}
      />
      <rect x={0.688 * w} y={monY + monH} width={0.047 * w} height={0.056 * h} fill={p.deep} />
      <rect x={0.625 * w} y={monY + monH + 0.056 * h} width={0.172 * w} height={0.022 * h} rx={0.011 * w} fill={p.deep} />
      {/* 键盘提示 */}
      <rect
        x={0.594 * w}
        y={0.611 * h}
        width={0.234 * w}
        height={0.036 * h}
        rx={0.011 * w}
        fill={p.soft}
        stroke={p.deep}
        strokeWidth={0.005 * w}
        opacity={0.9}
      />
      {/* 桌面 */}
      <rect x={0} y={deskY} width={w} height={0.036 * h} fill={p.deep} />
      <rect x={0} y={deskY + 0.036 * h} width={w} height={floorY - deskY - 0.036 * h} fill={p.soft} opacity={0.55} />
      {/* 地板 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.007 * w} />
      {/* 桌腿 */}
      <rect x={0.07 * w} y={deskY + 0.036 * h} width={0.016 * w} height={floorY - deskY - 0.036 * h} fill={p.deep} />
      <rect x={0.914 * w} y={deskY + 0.036 * h} width={0.016 * w} height={floorY - deskY - 0.036 * h} fill={p.deep} />
      {/* 墙上插座 / 线缆小细节 */}
      <rect x={0.094 * w} y={0.306 * h} width={0.042 * w} height={0.097 * h} rx={0.006 * w} fill={p.bg} stroke={p.deep} strokeWidth={0.005 * w} />
      <path
        d={`M ${0.115 * w} ${0.403 * h} q ${0.031 * w} ${0.083 * h} ${-0.008 * w} ${0.167 * h}`}
        stroke={p.deep}
        strokeWidth={0.005 * w}
        fill="none"
      />
    </g>
  );
};

const MeetingBg: BgFn = (w, h, p) => {
  const floorY = 0.861 * h;
  const tableY = 0.653 * h;
  const boardW = 0.328 * w;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 后墙墙板线（比 office 更疏，留白给白板） */}
      {[0.28, 0.53, 0.75].map((t) => (
        <line key={t} x1={0} y1={t * h} x2={w} y2={t * h} stroke={p.soft} strokeWidth={0.002 * Math.min(w, h)} />
      ))}
      {/* 后方白板框：板面留空，文字由 board 道具叠在上面 */}
      <rect
        x={0.5 * w - boardW / 2}
        y={0.133 * h}
        width={boardW}
        height={0.389 * h}
        rx={0.008 * w}
        fill={p.bg}
        stroke={p.deep}
        strokeWidth={0.011 * w}
      />
      <rect
        x={0.5 * w - boardW / 2 + 0.005 * w}
        y={0.142 * h}
        width={boardW - 0.01 * w}
        height={0.372 * h}
        rx={0.005 * w}
        fill={p.soft}
        opacity={0.45}
      />
      {/* 白板下方的笔槽 */}
      <rect x={0.367 * w} y={0.528 * h} width={0.266 * w} height={0.017 * h} rx={0.008 * w} fill={p.deep} opacity={0.55} />
      <rect x={0.4375 * w} y={0.508 * h} width={0.042 * w} height={0.017 * h} rx={0.006 * w} fill={p.accent} opacity={0.7} />
      {/* 两把椅子轮廓（后排左右各一） */}
      {[
        { x: 0.195 * w, flip: 1 },
        { x: 0.805 * w, flip: -1 },
      ].map(({ x, flip }) => {
        const cw = 0.09 * w;
        const top = 0.417 * h;
        const mid = 0.625 * h;
        const bottom = 0.722 * h;
        return (
          <g key={x} transform={`translate(${x} 0)`} stroke={p.deep} strokeWidth={0.007 * w} fill="none" opacity={0.6}>
            <path d={`M ${-cw * flip} ${top} h ${cw * 2 * flip} v ${mid - top} h ${-cw * 2 * flip} Z`} fill={p.soft} />
            <line x1={0} y1={mid} x2={0} y2={bottom} />
            <line x1={-0.04 * w} y1={bottom} x2={0.04 * w} y2={bottom} />
          </g>
        );
      })}
      {/* 长会议桌：透视梯形桌面 + 桌脚 */}
      <path
        d={`M ${0.164 * w} ${tableY} H ${0.836 * w} L ${0.953 * w} ${floorY} H ${0.047 * w} Z`}
        fill={p.soft}
        stroke={p.deep}
        strokeWidth={0.008 * w}
        strokeLinejoin="round"
      />
      <path
        d={`M ${0.164 * w} ${tableY} H ${0.836 * w} L ${0.852 * w} ${0.694 * h} H ${0.148 * w} Z`}
        fill={p.deep}
        opacity={0.35}
      />
      <rect x={0.094 * w} y={floorY} width={0.019 * w} height={0.058 * h} fill={p.deep} />
      <rect x={0.8875 * w} y={floorY} width={0.019 * w} height={0.058 * h} fill={p.deep} />
      {/* 地板 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.007 * w} />
      {/* 桌上两叠纸（渲染忽略，纯氛围） */}
      <rect x={0.297 * w} y={0.675 * h} width={0.067 * w} height={0.014 * h} rx={0.004 * w} fill={p.bg} stroke={p.ink} strokeWidth={0.004 * w} opacity={0.85} />
      <rect x={0.641 * w} y={0.694 * h} width={0.055 * w} height={0.0125 * h} rx={0.004 * w} fill={p.bg} stroke={p.ink} strokeWidth={0.004 * w} opacity={0.7} />
    </g>
  );
};

const StageBg: BgFn = (w, h, p) => {
  const floorY = 0.778 * h;
  const star = (x: number, y: number, r: number) =>
    `M ${x} ${y - r} L ${x + r * 0.31} ${y - r * 0.31} L ${x + r} ${y} L ${x + r * 0.31} ${y + r * 0.31} L ${x} ${y + r} L ${x - r * 0.31} ${y + r * 0.31} L ${x - r} ${y} L ${x - r * 0.31} ${y - r * 0.31} Z`;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 聚光：两道扇形光 */}
      <path d={`M ${0.39 * w} 0 L ${0.25 * w} ${floorY} H ${0.61 * w} L ${0.594 * w} 0 Z`} fill={p.soft} opacity={0.35} />
      <path d={`M ${0.5 * w} 0 L ${0.406 * w} ${floorY} H ${0.703 * w} L ${0.703 * w} 0 Z`} fill={p.accent} opacity={0.08} />
      {/* 幕布褶皱 */}
      {[
        [0, 0.125],
        [0.125, 0.25],
        [0.75, 0.875],
        [0.875, 1],
      ].map(([x0, x1]) => (
        <rect key={x0} x={x0 * w} y={0} width={(x1 - x0) * w} height={floorY} fill={p.ground} opacity={0.5} />
      ))}
      {/* 舞台地面 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.deep} opacity={0.12} />
      <rect x={0.109 * w} y={floorY - 0.006 * h} width={0.781 * w} height={0.031 * h} rx={0.014 * w} fill={p.deep} />
      {/* 星星点缀 */}
      {[
        [0.172, 0.167],
        [0.789, 0.222],
        [0.609, 0.111],
        [0.766, 0.417],
        [0.234, 0.444],
      ].map(([tx, ty], i) => (
        <path
          key={i}
          d={star(tx * w, ty * h, 0.014 * Math.min(w, h))}
          fill={i % 2 === 0 ? p.accent : p.muted}
          opacity={0.7}
        />
      ))}
    </g>
  );
};

/* ─────────────────────────────
 * 德鲁克专用背景（busy-desk / customer-gap / split-board / priority-room）
 * 形状与旧 5 套完全不同：满格表格墙、左右分区缺口、竖线分屏、深透视目标墙
 * ───────────────────────────── */

/** 满格清单墙里的一格：勾选格 / 空格 */
const GridCell: React.FC<{
  x: number;
  y: number;
  size: number;
  checked: boolean;
  p: StoryPalette;
}> = ({ x, y, size, checked, p }) => (
  <g>
    <rect
      x={x}
      y={y}
      width={size}
      height={size}
      rx={size * 0.07}
      fill={checked ? p.soft : p.bg}
      stroke={p.deep}
      strokeWidth={size * 0.046}
      opacity={checked ? 1 : 0.55}
    />
    {checked ? (
      <path
        d={`M ${x + size * 0.22} ${y + size * 0.52} l ${size * 0.2} ${size * 0.2} l ${size * 0.36} ${-size * 0.4}`}
        stroke={p.ink}
        strokeWidth={size * 0.065}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    ) : null}
  </g>
);

/** busy-desk：整面墙的清单/表格墙 + 办公桌 + 成堆纸 */
const BusyDeskBg: BgFn = (w, h, p) => {
  const cols = w > h ? 14 : 8;
  const rows = w > h ? 7 : 11;
  const cellWallW = 0.9 * w;
  const cellWallH = 0.72 * h;
  const cell = Math.min(
    (cellWallW - (cols - 1) * 0.009 * w) / cols,
    (cellWallH - (rows - 1) * 0.017 * h) / rows
  );
  const gapX = cell * 0.22;
  const gapY = cell * 0.22;
  const wallX = 0.5 * w - (cols * cell + (cols - 1) * gapX) / 2;
  const wallY = 0.08 * h;
  const floorY = 0.772 * h;
  const deskY = 0.628 * h;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 表格墙底板：一整块表单，不是墙板线 */}
      <rect
        x={wallX - 0.0125 * w}
        y={wallY - 0.022 * h}
        width={cols * (cell + gapX) - gapX + 0.025 * w}
        height={rows * (cell + gapY) - gapY + 0.044 * h}
        rx={0.006 * w}
        fill={p.bg}
        stroke={p.deep}
        strokeWidth={0.004 * w}
      />
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          // 大部分已勾，右下角留几格空的（活还没干完）
          const checked = !(r >= rows - 2 && c >= cols - 4);
          return (
            <GridCell
              key={`${r}-${c}`}
              x={wallX + c * (cell + gapX)}
              y={wallY + r * (cell + gapY)}
              size={cell}
              checked={checked}
              p={p}
            />
          );
        })
      )}
      {/* 表格行分隔线，强调是表格不是方块墙 */}
      {Array.from({ length: rows }, (_, r) => (
        <line
          key={`row-${r}`}
          x1={wallX - 0.006 * w}
          y1={wallY + r * (cell + gapY) + cell + gapY / 2}
          x2={wallX + cols * (cell + gapX) - gapX + 0.006 * w}
          y2={wallY + r * (cell + gapY) + cell + gapY / 2}
          stroke={p.muted}
          strokeWidth={0.0012 * w}
          opacity={0.35}
        />
      ))}
      {/* 地板 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.007 * w} />
      {/* 长办公桌：横贯画面下三分之一 */}
      <rect x={0} y={deskY} width={w} height={0.036 * h} fill={p.deep} />
      <rect x={0} y={deskY + 0.036 * h} width={w} height={floorY - deskY - 0.036 * h} fill={p.soft} opacity={0.6} />
      <rect x={0.109 * w} y={floorY - 0.036 * h} width={0.017 * w} height={0.125 * h} fill={p.deep} />
      <rect x={0.875 * w} y={floorY - 0.036 * h} width={0.017 * w} height={0.125 * h} fill={p.deep} />
      {/* 桌上的纸堆：三叠，越堆越高 */}
      {[
        { x: 0.075 * w, n: 7, w: 0.116 * w },
        { x: 0.227 * w, n: 4, w: 0.094 * w },
        { x: 0.852 * w, n: 9, w: 0.084 * w },
      ].map((pile, pi) => (
        <g key={pi}>
          {Array.from({ length: pile.n }, (_, i) => (
            <rect
              key={i}
              x={pile.x + (i % 2 === 0 ? 0 : 0.003 * w)}
              y={deskY - (i + 1) * 0.0125 * h}
              width={pile.w}
              height={0.0125 * h}
              rx={0.002 * w}
              fill={p.bg}
              stroke={p.ink}
              strokeWidth={0.0016 * w}
              opacity={0.9 - i * 0.06}
              transform={`rotate(${(i % 3) - 1} ${pile.x + pile.w / 2} ${deskY - (i + 1) * 0.0125 * h})`}
            />
          ))}
        </g>
      ))}
      {/* 贴墙的便利贴：散落的临时任务 */}
      {[
        [0.6875, 0.18],
        [0.781, 0.133],
        [0.703, 0.458],
        [0.821, 0.417],
      ].map(([tx, ty], i) => {
        const nx = tx * w;
        const ny = ty * h;
        const nw = 0.042 * w;
        const nh = 0.072 * h;
        return (
          <g key={i} transform={`rotate(${i % 2 === 0 ? -5 : 6} ${nx + nw / 2} ${ny + nh / 2})`}>
            <rect x={nx} y={ny} width={nw} height={nh} rx={0.003 * w} fill={p.accent} opacity={0.16} stroke={p.accent} strokeWidth={0.002 * w} />
            <line x1={nx + nw * 0.18} y1={ny + nh * 0.38} x2={nx + nw * 0.82} y2={ny + nh * 0.38} stroke={p.muted} strokeWidth={0.002 * w} opacity={0.6} />
            <line x1={nx + nw * 0.18} y1={ny + nh * 0.62} x2={nx + nw * 0.63} y2={ny + nh * 0.62} stroke={p.muted} strokeWidth={0.002 * w} opacity={0.6} />
          </g>
        );
      })}
    </g>
  );
};

/** customer-gap：左「表单已满」/ 右「客户未解」左右分区，中间一道高亮缺口 */
const CustomerGapBg: BgFn = (w, h, p) => {
  const splitX = 0.527 * w;
  const floorY = 0.856 * h;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 左区：满格表单面板 */}
      <rect x={0} y={0} width={splitX} height={h} fill={p.soft} opacity={0.55} />
      <rect x={0.0437 * w} y={0.1 * h} width={0.422 * w} height={0.556 * h} rx={0.008 * w} fill={p.bg} stroke={p.deep} strokeWidth={0.004 * w} />
      {/* 表单 header */}
      <rect x={0.0437 * w} y={0.1 * h} width={0.422 * w} height={0.075 * h} fill={p.deep} opacity={0.85} />
      <rect x={0.061 * w} y={0.125 * h} width={0.117 * w} height={0.025 * h} rx={0.004 * w} fill={p.bg} opacity={0.9} />
      <rect x={0.336 * w} y={0.125 * h} width={0.086 * w} height={0.025 * h} rx={0.004 * w} fill={p.bg} opacity={0.6} />
      {/* 表格行：每行左侧文字条 + 右侧满格勾 */}
      {Array.from({ length: 8 }, (_, r) => {
        const y = 0.194 * h + r * 0.055 * h;
        return (
          <g key={r}>
            <line x1={0.0437 * w} y1={y} x2={0.4657 * w} y2={y} stroke={p.muted} strokeWidth={0.0012 * w} opacity={0.4} />
            <rect x={0.061 * w} y={y + 0.018 * h} width={(0.156 + (r % 3) * 0.036) * w} height={0.017 * h} rx={0.008 * h} fill={p.muted} opacity={0.45} />
            <rect x={0.406 * w} y={y + 0.011 * h} width={0.042 * w} height={0.031 * h} rx={0.004 * w} fill={p.accent} opacity={0.85} />
            <path
              d={`M ${0.414 * w} ${y + 0.026 * h} l ${0.006 * w} ${0.011 * h} l ${0.0125 * w} ${-0.024 * h}`}
              stroke={p.bg}
              strokeWidth={0.003 * w}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {/* 左区「表单已满」满格小条 */}
      <g transform={`translate(${0.167 * w} ${0.692 * h})`}>
        <rect x={0} y={0} width={0.177 * w} height={0.056 * h} rx={0.028 * h} fill={p.bg} stroke={p.deep} strokeWidth={0.003 * w} />
        <rect x={0.006 * w} y={0.011 * h} width={0.164 * w} height={0.033 * h} rx={0.017 * h} fill={p.deep} opacity={0.75} />
        <text
          x={0.088 * w}
          y={0.04 * h}
          textAnchor="middle"
          fontSize={0.022 * w}
          fontWeight={800}
          fill={p.bg}
          letterSpacing={0.002 * w}
        >
          表单已满
        </text>
      </g>

      {/* 右区：客户问题未解，底部一块高亮缺口 */}
      <rect x={splitX} y={0} width={w - splitX} height={h} fill={p.bg} />
      {/* 缺口：从右侧墙破开的一道大裂口 */}
      <path
        d={`M ${0.703 * w} ${0.133 * h} L ${0.925 * w} ${0.106 * h} L ${0.906 * w} ${0.417 * h} L ${0.734 * w} ${0.458 * h} Z`}
        fill={p.accent}
        opacity={0.14}
      />
      <path
        d={`M ${0.703 * w} ${0.133 * h} L ${0.925 * w} ${0.106 * h} L ${0.906 * w} ${0.417 * h} L ${0.734 * w} ${0.458 * h} Z`}
        fill="none"
        stroke={p.accent}
        strokeWidth={0.005 * w}
        strokeDasharray={`${0.017 * w} ${0.011 * w}`}
        strokeLinejoin="round"
      />
      {/* 缺口里的大问号 */}
      <text
        x={0.817 * w}
        y={0.372 * h}
        textAnchor="middle"
        fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
        fontWeight={900}
        fontSize={0.117 * w}
        fill={p.accent}
        opacity={0.55}
      >
        ?
      </text>
      {/* 未解问题清单：空框 + 折线 */}
      {[0.556, 0.653, 0.75].map((ty, i) => {
        const y = ty * h;
        return (
          <g key={ty}>
            <line
              x1={0.594 * w}
              y1={y}
              x2={0.859 * w - i * 0.031 * w}
              y2={y}
              stroke={p.muted}
              strokeWidth={0.0024 * w}
              opacity={0.5}
              strokeDasharray={`${0.008 * w} ${0.008 * w}`}
            />
            <rect x={0.559 * w} y={y + 0.019 * h} width={0.022 * w} height={0.039 * h} rx={0.004 * w} fill={p.bg} stroke={p.deep} strokeWidth={0.0024 * w} opacity={0.7} />
          </g>
        );
      })}
      {/* 分区竖线：中间一条断口（缺口处断开，暗示没接上） */}
      <line x1={splitX} y1={0} x2={splitX} y2={0.5 * h} stroke={p.deep} strokeWidth={0.005 * w} />
      <line x1={splitX} y1={0.583 * h} x2={splitX} y2={h} stroke={p.deep} strokeWidth={0.005 * w} />
      <path
        d={`M ${splitX - 0.027 * w} ${0.508 * h} l ${0.027 * w} ${0.019 * h} l ${-0.027 * w} ${0.019 * h}`}
        stroke={p.accent}
        strokeWidth={0.005 * w}
        fill={p.accent}
        strokeLinejoin="round"
        opacity={0.9}
      />
      {/* 地板 */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} opacity={0.9} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.004 * w} />
    </g>
  );
};

/** split-board：左右分屏对比墙，中间竖分割线；左「效率」右「成效」 */
const SplitBoardBg: BgFn = (w, h, p) => {
  const mid = w / 2;
  const floorY = 0.8 * h;
  const titleSize = 0.072 * w;
  const cellW = (mid - 0.1 * w) / 9;
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 左区底色 */}
      <rect x={0} y={0} width={mid} height={h} fill={p.soft} opacity={0.6} />
      {/* 左区：密集小方格面（效率的节奏感） */}
      {Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 9 }, (_, c) => (
          <rect
            key={`l-${r}-${c}`}
            x={0.056 * w + c * cellW}
            y={0.178 * h + r * 0.075 * h}
            width={cellW * 0.74}
            height={0.055 * h}
            rx={0.003 * w}
            fill={p.bg}
            stroke={p.muted}
            strokeWidth={0.0016 * w}
            opacity={0.5}
          />
        ))
      )}
      {/* 左区标题位 */}
      <g>
        <text
          x={mid / 2}
          y={0.178 * h}
          textAnchor="middle"
          fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
          fontWeight={900}
          fontSize={titleSize}
          letterSpacing={0.005 * w}
          fill={p.ink}
        >
          效率
        </text>
        <line x1={mid / 2 - 0.084 * w} y1={0.211 * h} x2={mid / 2 + 0.084 * w} y2={0.211 * h} stroke={p.muted} strokeWidth={0.006 * w} strokeLinecap="round" />
      </g>

      {/* 右区底色 */}
      <rect x={mid} y={0} width={mid} height={h} fill={p.bg} />
      {/* 右区：一个大圆环靶心（成效是打法，不是忙碌） */}
      <g opacity={0.5}>
        <circle cx={mid + mid / 2} cy={0.417 * h} r={0.131 * w} fill="none" stroke={p.muted} strokeWidth={0.003 * w} />
        <circle cx={mid + mid / 2} cy={0.417 * h} r={0.0875 * w} fill="none" stroke={p.muted} strokeWidth={0.003 * w} />
        <circle cx={mid + mid / 2} cy={0.417 * h} r={0.042 * w} fill={p.bg} stroke={p.deep} strokeWidth={0.003 * w} />
        <circle cx={mid + mid / 2} cy={0.417 * h} r={0.0094 * w} fill={p.accent} />
      </g>
      {/* 右区标题位 */}
      <g>
        <text
          x={mid + mid / 2}
          y={0.178 * h}
          textAnchor="middle"
          fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
          fontWeight={900}
          fontSize={titleSize}
          letterSpacing={0.005 * w}
          fill={p.ink}
        >
          成效
        </text>
        <line
          x1={mid + mid / 2 - 0.084 * w}
          y1={0.211 * h}
          x2={mid + mid / 2 + 0.084 * w}
          y2={0.211 * h}
          stroke={p.accent}
          strokeWidth={0.008 * w}
          strokeLinecap="round"
        />
      </g>

      {/* 地板（两区共用，竖线压上） */}
      <rect x={0} y={floorY} width={w} height={h - floorY} fill={p.ground} opacity={0.75} />
      <line x1={0} y1={floorY} x2={w} y2={floorY} stroke={p.deep} strokeWidth={0.004 * w} />
      {/* 中央竖分割线：贯穿全高，画面上自带分区 */}
      <line x1={mid} y1={0} x2={mid} y2={h} stroke={p.deep} strokeWidth={0.008 * w} />
      <line x1={mid} y1={0} x2={mid} y2={h} stroke={p.bg} strokeWidth={0.0024 * w} strokeDasharray={`${0.011 * w} ${0.014 * w}`} opacity={0.7} />
    </g>
  );
};

/** priority-room：深透视目标墙，前景大卡片槽，后景小卡片淡出 */
const PriorityRoomBg: BgFn = (w, h, p) => {
  // 透视：越靠后（y 越小）越窄、越淡
  const rows = [
    { y: 0.167, w: 0.234, cardW: 0.1, cardH: 0.117, op: 0.16, n: 5 },
    { y: 0.333, w: 0.4375, cardW: 0.131, cardH: 0.156, op: 0.3, n: 4 },
    { y: 0.542, w: 0.672, cardW: 0.169, cardH: 0.206, op: 0.5, n: 3 },
  ];
  // 透视线：从画面中上方交汇点射向四角
  const vp = { x: 0.5 * w, y: 0.208 * h };
  const rays = [
    [0, h],
    [w, h],
    [0, 0],
    [w, 0],
  ];
  return (
    <g>
      <rect width={w} height={h} fill={p.bg} />
      {/* 透视地面 */}
      <path d={`M ${0.25 * w} ${h} L ${vp.x} ${vp.y} L ${0.75 * w} ${h} Z`} fill={p.ground} opacity={0.35} />
      <rect x={0} y={0.964 * h} width={w} height={0.036 * h} fill={p.ground} />
      {/* 透视线 */}
      {rays.map(([x, y], i) => (
        <line key={i} x1={vp.x} y1={vp.y} x2={x} y2={y} stroke={p.muted} strokeWidth={0.0016 * w} opacity={0.18} />
      ))}
      {/* 三层目标卡片槽：越远越小越淡 */}
      {rows.map((row, ri) => {
        const rowY = row.y * h;
        const rowW = row.w * w;
        const cardW = row.cardW * w;
        const cardH = row.cardH * h;
        const gap = 0.014 * w;
        const total = row.n * cardW + (row.n - 1) * gap;
        return (
          <g key={ri} opacity={row.op}>
            <line
              x1={vp.x - rowW / 2}
              y1={rowY}
              x2={vp.x + rowW / 2}
              y2={rowY}
              stroke={p.deep}
              strokeWidth={row.y > 0.5 ? 0.006 * w : 0.004 * w}
            />
            {Array.from({ length: row.n }, (_, i) => {
              const x = vp.x - total / 2 + i * (cardW + gap);
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={rowY}
                    width={cardW}
                    height={cardH}
                    rx={0.006 * w}
                    fill={p.bg}
                    stroke={p.deep}
                    strokeWidth={row.y > 0.5 ? 0.004 * w : 0.0024 * w}
                  />
                  <line
                    x1={x + cardW * 0.12}
                    y1={rowY + cardH * 0.42}
                    x2={x + cardW * 0.88}
                    y2={rowY + cardH * 0.42}
                    stroke={p.muted}
                    strokeWidth={0.003 * w}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x + cardW * 0.12}
                    y1={rowY + cardH * 0.66}
                    x2={x + cardW * 0.56}
                    y2={rowY + cardH * 0.66}
                    stroke={p.muted}
                    strokeWidth={0.0024 * w}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </g>
        );
      })}
      {/* 前景大卡片槽：地面上的大凹槽边框（真正的卡片由 goal-card 道具叠上） */}
      <g>
        <rect
          x={0.234 * w}
          y={0.653 * h}
          width={0.531 * w}
          height={0.297 * h}
          rx={0.011 * w}
          fill={p.soft}
          opacity={0.5}
          stroke={p.deep}
          strokeWidth={0.007 * w}
          strokeDasharray={`${0.022 * w} ${0.0125 * w}`}
        />
        {/* 槽底阴影 */}
        <rect x={0.247 * w} y={0.778 * h} width={0.506 * w} height={0.153 * h} rx={0.008 * w} fill={p.ground} opacity={0.35} />
        {/* 槽口定位角标 */}
        {[
          [0.234, 0.653, 1, 1],
          [0.766, 0.653, -1, 1],
          [0.234, 0.95, 1, -1],
          [0.766, 0.95, -1, -1],
        ].map(([x, y, sx, sy], i) => (
          <path
            key={i}
            d={`M ${x * w + 0.027 * w * sx} ${y * h} L ${x * w} ${y * h} L ${x * w} ${y * h + 0.047 * h * sy}`}
            stroke={p.accent}
            strokeWidth={0.006 * w}
            fill="none"
            strokeLinecap="round"
          />
        ))}
      </g>
      {/* 远墙中线 */}
      <line x1={vp.x} y1={0} x2={vp.x} y2={vp.y} stroke={p.deep} strokeWidth={0.003 * w} opacity={0.25} />
    </g>
  );
};

const BACKGROUNDS: Record<SceneId, BgFn> = {
  office: OfficeBg,
  queue: QueueBg,
  desk: DeskBg,
  stage: StageBg,
  meeting: MeetingBg,
  "busy-desk": BusyDeskBg,
  "customer-gap": CustomerGapBg,
  "split-board": SplitBoardBg,
  "priority-room": PriorityRoomBg,
};

/**
 * 故事片背景层：纯 SVG 图形，无网格底。
 * viewBox 与实际画布同尺寸，坐标按 w/h 比例推导，因此横竖屏都能铺满。
 */
export const Background: React.FC<BackgroundProps> = ({
  scene,
  palette,
  stageW,
  stageH,
}) => {
  const draw = BACKGROUNDS[scene] ?? OfficeBg;
  return (
    <svg
      viewBox={`0 0 ${stageW} ${stageH}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, display: "block" }}
    >
      {draw(stageW, stageH, palette)}
    </svg>
  );
};
