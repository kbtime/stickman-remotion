import React from "react";
import type { PropId } from "../types";
import type { StoryPalette } from "./Backgrounds";

/** 道具设计尺寸（宽 = 1 单位，高不同），StoryStage 用 x/y 按画面比例定位 */
export type PropMetrics = { w: number; h: number };

export const PROP_METRICS: Record<PropId, PropMetrics> = {
  monitor: { w: 300, h: 240 },
  cloud: { w: 280, h: 160 },
  laptop: { w: 260, h: 170 },
  clapper: { w: 230, h: 180 },
  progress: { w: 360, h: 70 },
  board: { w: 280, h: 200 },
  spreadsheet: { w: 340, h: 224 },
  checklist: { w: 218, h: 300 },
  customer: { w: 280, h: 348 },
  "label-speed": { w: 200, h: 132 },
  "label-effect": { w: 200, h: 132 },
  "goal-card": { w: 360, h: 240 },
};

type Props = {
  id: PropId;
  palette: StoryPalette;
  /** 镜内秒，供 progress 自转；其它道具忽略 */
  elapsed?: number;
  opacity?: number;
  /** 道具上的文字（board 用），默认「成效」 */
  label?: string;
};

const Monitor: React.FC<{ p: StoryPalette }> = ({ p }) => (
  <g>
    <rect x={10} y={0} width={280} height={170} rx={12} fill={p.soft} stroke={p.deep} strokeWidth={6} />
    <rect x={26} y={16} width={248} height={138} rx={6} fill={p.bg} stroke={p.deep} strokeWidth={3} />
    {/* 屏幕里的两行代码 */}
    <line x1={46} y1={56} x2={200} y2={56} stroke={p.accent} strokeWidth={7} strokeLinecap="round" />
    <line x1={46} y1={84} x2={240} y2={84} stroke={p.muted} strokeWidth={7} strokeLinecap="round" />
    <line x1={46} y1={112} x2={160} y2={112} stroke={p.muted} strokeWidth={7} strokeLinecap="round" />
    <rect x={130} y={170} width={40} height={40} fill={p.deep} />
    <rect x={80} y={206} width={140} height={16} rx={8} fill={p.deep} />
  </g>
);

const Cloud: React.FC<{ p: StoryPalette }> = ({ p }) => (
  <g>
    <path
      d="M 70 120 a 38 38 0 0 1 10 -74 a 52 52 0 0 1 98 -12 a 44 44 0 0 1 34 86 Z"
      fill={p.bg}
      stroke={p.deep}
      strokeWidth={6}
      strokeLinejoin="round"
    />
    <path d="M 100 136 v 22" stroke={p.deep} strokeWidth={6} strokeLinecap="round" />
    <path d="M 150 20 v 0" stroke={p.deep} strokeWidth={6} strokeLinecap="round" />
    <path
      d="M 140 140 v 0"
      stroke={p.accent}
      strokeWidth={7}
      strokeLinecap="round"
    />
    {/* 箭头：上行上传 / 下行下载的示意 */}
    <path d="M 118 196 V 146 m -14 16 l 14 -16 l 14 16" stroke={p.accent} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M 176 146 V 196 m -14 -16 l 14 16 l 14 -16" stroke={p.muted} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

const Laptop: React.FC<{ p: StoryPalette }> = ({ p }) => (
  <g>
    <rect x={36} y={0} width={188} height={122} rx={10} fill={p.soft} stroke={p.deep} strokeWidth={6} />
    <rect x={50} y={14} width={160} height={94} rx={4} fill={p.bg} stroke={p.deep} strokeWidth={3} />
    {/* 进度小条 */}
    <rect x={64} y={40} width={132} height={12} rx={6} fill={p.soft} />
    <rect x={64} y={40} width={92} height={12} rx={6} fill={p.accent} />
    <rect x={64} y={68} width={90} height={8} rx={4} fill={p.muted} opacity={0.6} />
    {/* 键盘底座 */}
    <path d="M 10 122 h 240 l 14 40 H -4 Z" fill={p.soft} stroke={p.deep} strokeWidth={6} strokeLinejoin="round" />
    <rect x={96} y={134} width={68} height={10} rx={5} fill={p.deep} opacity={0.5} />
  </g>
);

const Clapper: React.FC<{ p: StoryPalette }> = ({ p }) => (
  <g>
    {/* 场记板上盖 */}
    <g transform="rotate(-12 20 40)">
      <rect x={10} y={16} width={210} height={34} rx={5} fill={p.ink} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={22 + i * 52} y={16} width={26} height={34} fill={p.bg} />
      ))}
    </g>
    {/* 板身 */}
    <rect x={10} y={54} width={210} height={120} rx={8} fill={p.soft} stroke={p.deep} strokeWidth={6} />
    <line x1={10} y1={96} x2={220} y2={96} stroke={p.deep} strokeWidth={3} />
    <line x1={10} y1={132} x2={220} y2={132} stroke={p.deep} strokeWidth={3} />
    <line x1={110} y1={96} x2={110} y2={174} stroke={p.deep} strokeWidth={3} />
    <text x={40} y={86} fontSize={26} fontWeight={800} fill={p.accent} fontFamily="ui-monospace, Menlo, monospace">
      TAKE 1
    </text>
  </g>
);

const Progress: React.FC<{ p: StoryPalette; elapsed: number }> = ({ p, elapsed }) => {
  const ratio = 0.25 + (Math.sin(elapsed * 1.2) + 1) * 0.05;
  const w = 360 * ratio;
  return (
    <g>
      <rect x={0} y={10} width={360} height={44} rx={22} fill={p.soft} stroke={p.deep} strokeWidth={5} />
      <rect x={8} y={18} width={Math.max(30, w)} height={28} rx={14} fill={p.accent} />
      {/* 三段小方块，循环点亮 */}
      {[0, 1, 2].map((i) => {
        const on = Math.floor(elapsed * 2.5) % 3 === i;
        return (
          <rect
            key={i}
            x={296 + i * 20}
            y={24}
            width={10}
            height={10}
            rx={3}
            fill={on ? p.deep : p.muted}
            opacity={on ? 1 : 0.45}
          />
        );
      })}
    </g>
  );
};

const Board: React.FC<{ p: StoryPalette; label: string }> = ({ p, label }) => {
  const text = label || "成效";
  // 字数多时缩字号，避免溢出白板
  const fontSize = text.length <= 2 ? 84 : text.length === 3 ? 68 : 54;
  return (
    <g>
      {/* 白板框 + 板面 */}
      <rect x={4} y={4} width={272} height={192} rx={10} fill={p.bg} stroke={p.deep} strokeWidth={8} />
      <rect x={16} y={16} width={248} height={168} rx={5} fill={p.soft} opacity={0.55} />
      {/* 粗标题 */}
      <text
        x={140}
        y={104}
        textAnchor="middle"
        fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
        fontWeight={900}
        fontSize={fontSize}
        letterSpacing={2}
        fill={p.ink}
      >
        {text}
      </text>
      {/* 底部强调下划线 */}
      <line
        x1={140 - Math.min(96, text.length * fontSize * 0.5)}
        y1={130}
        x2={140 + Math.min(96, text.length * fontSize * 0.5)}
        y2={130}
        stroke={p.accent}
        strokeWidth={10}
        strokeLinecap="round"
      />
    </g>
  );
};

/* ─────────────────────────────
 * 德鲁克样片道具：spreadsheet / checklist / customer / label-speed / label-effect / goal-card
 * ───────────────────────────── */

/** 表格格子 + 满勾 */
const Spreadsheet: React.FC<{ p: StoryPalette }> = ({ p }) => {
  const cols = 6;
  const rows = 5;
  const cw = 52;
  const rh = 40;
  const x0 = 4;
  const y0 = 4;
  return (
    <g>
      <rect x={0} y={0} width={340} height={224} rx={8} fill={p.bg} stroke={p.deep} strokeWidth={6} />
      {/* 表头 */}
      <rect x={4} y={4} width={332} height={34} fill={p.deep} opacity={0.85} />
      <rect x={16} y={14} width={86} height={14} rx={4} fill={p.bg} opacity={0.85} />
      <rect x={230} y={14} width={90} height={14} rx={4} fill={p.bg} opacity={0.5} />
      {/* 网格 */}
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const x = x0 + c * cw;
          const y = 38 + r * rh;
          const filled = (r + c) % 7 !== 3;
          return (
            <g key={`${r}-${c}`}>
              <rect x={x} y={y} width={cw} height={rh} fill={p.bg} stroke={p.muted} strokeWidth={1.5} opacity={0.7} />
              {filled ? (
                <path
                  d={`M ${x + 14} ${y + rh * 0.52} l 8 9 l 15 -18`}
                  stroke={p.accent}
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          );
        })
      )}
      {/* 满格：底部整行被填实的高亮条 */}
      <rect x={4} y={38 + rows * rh} width={332} height={10} rx={5} fill={p.accent} />
    </g>
  );
};

/** 清单勾选：便笺纸 + 竖排勾选框 */
const Checklist: React.FC<{ p: StoryPalette }> = ({ p }) => {
  const items = [true, true, true, true, false];
  return (
    <g>
      {/* 便笺纸 */}
      <rect x={6} y={6} width={206} height={284} rx={8} fill={p.bg} stroke={p.deep} strokeWidth={5} />
      {/* 顶部夹子 */}
      <rect x={68} y={-8} width={82} height={26} rx={8} fill={p.deep} />
      {items.map((done, i) => {
        const y = 44 + i * 48;
        return (
          <g key={i}>
            <rect
              x={26}
              y={y}
              width={28}
              height={28}
              rx={4}
              fill={done ? p.ink : p.bg}
              stroke={p.ink}
              strokeWidth={3.5}
            />
            {done ? (
              <path
                d={`M ${32} ${y + 15} l 7 8 l 13 -16`}
                stroke={p.bg}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            <line
              x1={68}
              y1={y + 15}
              x2={68 + (150 - i * 14)}
              y2={y + 15}
              stroke={p.muted}
              strokeWidth={7}
              strokeLinecap="round"
              opacity={done ? 0.5 : 0.9}
            />
            {done ? (
              <line
                x1={68}
                y1={y + 15}
                x2={68 + (150 - i * 14)}
                y2={y + 15}
                stroke={p.accent}
                strokeWidth={3}
                strokeLinecap="round"
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
};

/** 客户：剪影人偶 + 头顶问号气泡 */
const Customer: React.FC<{ p: StoryPalette }> = ({ p }) => (
  <g>
    {/* 气泡 */}
    <g>
      <path
        d="M 92 10 h 96 a 30 30 0 0 1 30 30 v 50 a 30 30 0 0 1 -30 30 h -58 l -26 30 l 2 -30 h -14 a 30 30 0 0 1 -30 -30 v -50 a 30 30 0 0 1 30 -30 z"
        fill={p.bg}
        stroke={p.deep}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <text
        x={140}
        y={100}
        textAnchor="middle"
        fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
        fontWeight={900}
        fontSize={62}
        fill={p.accent}
      >
        ?
      </text>
    </g>
    {/* 客户剪影：灰调，明确「另有其人」 */}
    <g fill={p.muted} opacity={0.85}>
      <circle cx={140} cy={196} r={40} />
      <path d="M 62 340 q 0 -84 78 -84 q 78 0 78 84 z" />
    </g>
    {/* 剪影上的描边，避免糊成色块 */}
    <circle cx={140} cy={196} r={40} fill="none" stroke={p.deep} strokeWidth={4} />
    <path d="M 62 340 q 0 -84 78 -84 q 78 0 78 84" fill="none" stroke={p.deep} strokeWidth={4} />
  </g>
);

/** 竖/横牌：效率·做快 */
const LabelSpeed: React.FC<{ p: StoryPalette; text: string }> = ({ p, text }) => (
  <g>
    <rect x={0} y={0} width={200} height={132} rx={10} fill={p.bg} stroke={p.deep} strokeWidth={6} />
    {/* 左侧速度条：三道加速斜线 */}
    <g stroke={p.muted} strokeWidth={7} strokeLinecap="round" opacity={0.7}>
      <line x1={20} y1={96} x2={44} y2={36} />
      <line x1={40} y1={96} x2={64} y2={36} />
      <line x1={60} y1={96} x2={84} y2={36} />
    </g>
    <text
      x={166}
      y={78}
      textAnchor="middle"
      fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
      fontWeight={900}
      fontSize={text.length > 6 ? 26 : 30}
      fill={p.ink}
    >
      {text}
    </text>
    <rect x={102} y={96} width={88} height={10} rx={5} fill={p.muted} />
  </g>
);

/** 牌：成效·做成 */
const LabelEffect: React.FC<{ p: StoryPalette; text: string }> = ({ p, text }) => (
  <g>
    <rect x={0} y={0} width={200} height={132} rx={10} fill={p.bg} stroke={p.deep} strokeWidth={6} />
    {/* 左侧靶心图标 */}
    <g>
      <circle cx={52} cy={66} r={30} fill="none" stroke={p.accent} strokeWidth={6} />
      <circle cx={52} cy={66} r={12} fill={p.accent} />
    </g>
    <text
      x={142}
      y={78}
      textAnchor="middle"
      fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
      fontWeight={900}
      fontSize={text.length > 6 ? 26 : 30}
      fill={p.ink}
    >
      {text}
    </text>
    <rect x={96} y={96} width={94} height={10} rx={5} fill={p.accent} />
  </g>
);

/** 目标卡：可 label，带一条「已选定」标记 */
const GoalCard: React.FC<{ p: StoryPalette; label: string }> = ({ p, label }) => {
  const text = label || "做对的事";
  const fontSize = text.length <= 3 ? 64 : text.length <= 5 ? 48 : 38;
  return (
    <g>
      {/* 卡片 */}
      <rect x={4} y={4} width={352} height={232} rx={14} fill={p.bg} stroke={p.deep} strokeWidth={7} />
      {/* 顶部色条 */}
      <rect x={4} y={4} width={352} height={22} rx={14} fill={p.accent} opacity={0.9} />
      <rect x={4} y={16} width={352} height={10} fill={p.accent} opacity={0.9} />
      {/* 标题 */}
      <text
        x={180}
        y={128}
        textAnchor="middle"
        fontFamily="'PingFang SC', 'Noto Sans SC', ui-sans-serif, sans-serif"
        fontWeight={900}
        fontSize={fontSize}
        letterSpacing={2}
        fill={p.ink}
      >
        {text}
      </text>
      {/* 底部：三个进度点，全实心（目标已定） */}
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={126 + i * 54} cy={188} r={11} fill={p.deep} opacity={0.85} />
      ))}
    </g>
  );
};

/** 单个道具：纯 SVG，尺寸固定按 PROP_METRICS，由父层缩放定位 */
export const Prop: React.FC<Props> = ({ id, palette, elapsed = 0, opacity = 1, label }) => {
  const m = PROP_METRICS[id];
  let body: React.ReactNode = null;
  switch (id) {
    case "monitor":
      body = <Monitor p={palette} />;
      break;
    case "cloud":
      body = <Cloud p={palette} />;
      break;
    case "laptop":
      body = <Laptop p={palette} />;
      break;
    case "clapper":
      body = <Clapper p={palette} />;
      break;
    case "progress":
      body = <Progress p={palette} elapsed={elapsed} />;
      break;
    case "board":
      body = <Board p={palette} label={label ?? "成效"} />;
      break;
    case "spreadsheet":
      body = <Spreadsheet p={palette} />;
      break;
    case "checklist":
      body = <Checklist p={palette} />;
      break;
    case "customer":
      body = <Customer p={palette} />;
      break;
    case "label-speed":
      body = <LabelSpeed p={palette} text={label || "效率·做快"} />;
      break;
    case "label-effect":
      body = <LabelEffect p={palette} text={label || "成效·做成"} />;
      break;
    case "goal-card":
      body = <GoalCard p={palette} label={label ?? "做对的事"} />;
      break;
  }
  return (
    <svg
      viewBox={`0 0 ${m.w} ${m.h}`}
      width={m.w}
      height={m.h}
      style={{ overflow: "visible", opacity }}
    >
      {body}
    </svg>
  );
};
