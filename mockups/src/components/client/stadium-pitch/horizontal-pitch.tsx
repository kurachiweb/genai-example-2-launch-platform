import { cn } from '#/lib/utils';
import { crowdCells, dotDelay, SIDE_STAND_DOTS, sideStandCells } from './model';
import type { CrowdProps, GoalProps, OrientedPitchProps } from './model';

/* ---------- 横向きの鳥瞰図(PC) ---------- */

// topはピッチ中央ではなく、フラッグの先端から手前スタンドの奥端までの全体がviewBoxの上下中央に来るよう決めている。
// sliceで上下が切り取られる際に、フラッグか手前スタンドのどちらかだけが先に欠けないようにするため
const H = {
  cx: 600,
  top: 128,
  height: 230,
  wFar: 600,
  wGrow: 220,
};

// サイドスタンドの座席列(v座標)。ピッチに近い列から順に埋める
const H_SIDE_STAND_ROWS = [
  [-0.14, -0.2, -0.26, -0.32],
  [1.12, 1.18, 1.24, 1.3],
] as const;
// サイドスタンドの奥端(v座標)。遠いスタンドの奥端にはフラッグを立てるため、跳ねる最後列の観客とポールが被らないよう1列分より広く取る
const H_FAR_STAND_BACK = -0.4;
const H_NEAR_STAND_BACK = 1.36;

function px(u: number, v: number): [number, number] {
  const w = H.wFar + H.wGrow * v;
  return [H.cx + (u - 0.5) * w, H.top + v * H.height];
}

// ピッチ中央(v=0.5)を基準にした遠近の拡大率。ピッチ幅の広がりと同じ比率にする
function perspectiveScale(v: number) {
  return (H.wFar + H.wGrow * v) / (H.wFar + H.wGrow * 0.5);
}

function hline(u0: number, u1: number, v: number) {
  return `${px(u0, v).join(',')} ${px(u1, v).join(',')}`;
}

function quad(u0: number, v0: number, u1: number, v1: number) {
  const a = px(u0, v0);
  const b = px(u1, v0);
  const c = px(u1, v1);
  const d = px(u0, v1);
  return `${a.join(',')} ${b.join(',')} ${c.join(',')} ${d.join(',')}`;
}

export function HorizontalPitch(props: OrientedPitchProps) {
  const {
    leftVotes,
    rightVotes,
    leftColors,
    rightColors,
    excited,
    finishedWinner,
    deserted,
    className,
  } = props;

  const stripes = Array.from({ length: 10 }, (_, i) => i);

  return (
    <svg
      viewBox="0 0 1200 450"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={cn('block h-full w-full', className)}
    >
      <rect width="1200" height="450" fill="url(#sky-fade)" />

      {/* スタンド */}
      <polygon
        points={quad(-0.12, H_FAR_STAND_BACK, 1.12, -0.06)}
        fill="var(--stand-base)"
      />
      <polygon
        points={quad(-0.12, 1.06, 1.12, H_NEAR_STAND_BACK)}
        fill="var(--stand-base)"
      />
      <polygon
        points={quad(-0.2, -0.06, -0.04, 1.06)}
        fill="var(--stand-base)"
      />
      <polygon points={quad(1.04, -0.06, 1.2, 1.06)} fill="var(--stand-base)" />
      {H_SIDE_STAND_ROWS.flat().map((v) => (
        <polyline
          key={v}
          points={hline(-0.12, 1.12, v)}
          fill="none"
          stroke="var(--stand-step)"
          strokeWidth="2"
        />
      ))}
      <polygon
        points={quad(-0.12, -0.06, 1.12, -0.03)}
        fill="var(--stand-rim)"
      />
      <polygon points={quad(-0.12, 1.03, 1.12, 1.06)} fill="var(--stand-rim)" />

      {/* ピッチ */}
      {stripes.map((i) => (
        <polygon
          key={i}
          points={quad(i / 10, 0, (i + 1) / 10, 1)}
          fill={i % 2 === 0 ? 'var(--pitch-a)' : 'var(--pitch-b)'}
        />
      ))}
      <g
        fill="none"
        stroke="var(--pitch-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      >
        <polygon points={quad(0, 0, 1, 1)} />
        <line
          x1={px(0.5, 0)[0]}
          y1={px(0.5, 0)[1]}
          x2={px(0.5, 1)[0]}
          y2={px(0.5, 1)[1]}
        />
        <ellipse cx={px(0.5, 0.5)[0]} cy={px(0.5, 0.5)[1]} rx="62" ry="31" />
        <polygon points={quad(0, 0.2, 0.157, 0.8)} />
        <polygon points={quad(0.843, 0.2, 1, 0.8)} />
        <polygon points={quad(0, 0.36, 0.052, 0.64)} />
        <polygon points={quad(0.948, 0.36, 1, 0.64)} />
      </g>
      <circle
        cx={px(0.5, 0.5)[0]}
        cy={px(0.5, 0.5)[1]}
        r="3"
        fill="var(--pitch-line)"
      />

      {/* フラッグ(遠いスタンドの奥端) */}
      {Array.from({ length: 12 }, (_, i) => {
        const u = 0.02 + i * 0.087;
        const colors = u < 0.5 ? leftColors : rightColors;
        if (deserted) return null;
        const [x, y] = px(u, H_FAR_STAND_BACK);
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-26"
              stroke="var(--stand-rim)"
              strokeWidth="2"
            />
            <path
              className="flag"
              style={
                { '--flag-delay': `${(i % 4) * 0.35}s` } as React.CSSProperties
              }
              d="M0 -26 h22 l-5 7 l5 7 h-22z"
              fill={colors[i % 2]}
            />
          </g>
        );
      })}

      {/* ナイター照明 */}
      {[
        [-0.18, -0.24],
        [1.18, -0.24],
        [-0.22, 1.3],
        [1.22, 1.3],
      ].map(([u, v], i) => {
        const [x, y] = px(u, v);
        return (
          <g key={i}>
            <line
              x1={x}
              y1={y + 40}
              x2={x}
              y2={y - 40}
              stroke="var(--stand-rim)"
              strokeWidth="4"
            />
            <rect
              x={x - 12}
              y={y - 52}
              width="24"
              height="14"
              rx="3"
              fill="var(--stand-rim)"
            />
            <circle
              className="floodlight"
              style={{ '--flood-delay': `${i * 0.9}s` } as React.CSSProperties}
              cx={x}
              cy={y - 45}
              r="120"
              fill="url(#flood-glow)"
            />
          </g>
        );
      })}

      {/* 観客 */}
      <HorizontalCrowd
        side="left"
        count={deserted ? 0 : leftVotes + 1}
        color={leftColors[0]}
        excited={excited === 'left'}
        still={finishedWinner != null && finishedWinner !== 'left'}
      />
      <HorizontalCrowd
        side="right"
        count={deserted ? 0 : rightVotes + 1}
        color={rightColors[0]}
        excited={excited === 'right'}
        still={finishedWinner != null && finishedWinner !== 'right'}
      />

      {/* ゴール */}
      <HorizontalGoal side="left" />
      <HorizontalGoal side="right" />
    </svg>
  );
}

// 片側チームが使えるサイドスタンドの長さ(u座標)。ハーフウェイライン手前で相手側と分け合う
const H_SIDE_STAND_LENGTH = 0.58;
// ピッチ中央と同じ奥行きにいる観客の半径。遠近に応じて奥側は小さく、手前側は大きく描く
const H_CROWD_DOT_RADIUS = 4;

function HorizontalCrowd({ side, count, color, excited, still }: CrowdProps) {
  const rows = count > 60 ? 6 : count > 20 ? 4 : 3;
  const { cells, cols } = crowdCells(count, rows);
  const uStart = side === 'left' ? -0.055 : 1.055;
  const uDir = side === 'left' ? -1 : 1;
  const uStep = 0.026;
  const vStep = 1 / Math.max(cols, 8);
  const vStart = 0.5 - (cols * vStep) / 2 + vStep / 2;

  const sideStands = sideStandCells(count, H_SIDE_STAND_ROWS[0].length);
  const sideUStart = side === 'left' ? -0.1 : 1.1;
  const sideUStep =
    H_SIDE_STAND_LENGTH /
    Math.ceil(SIDE_STAND_DOTS / H_SIDE_STAND_ROWS[0].length);

  const dot = (index: number, u: number, v: number) => {
    const [x, y] = px(u, v);
    return (
      <circle
        key={index}
        className={cn(!still && 'crowd-dot')}
        style={{ '--jump-delay': dotDelay(index) } as React.CSSProperties}
        cx={x}
        cy={y}
        r={H_CROWD_DOT_RADIUS * perspectiveScale(v)}
        fill={color}
        opacity={0.9}
      />
    );
  };

  return (
    <g
      className="crowd-side"
      data-excited={excited ? 'true' : 'false'}
      data-still={still ? 'true' : 'false'}
    >
      {cells.map(({ row, col, index }) =>
        dot(index, uStart + uDir * row * uStep, vStart + col * vStep),
      )}
      {sideStands.map((standCells, stand) =>
        standCells.map(({ row, col, index }) =>
          dot(
            index,
            sideUStart - uDir * col * sideUStep,
            H_SIDE_STAND_ROWS[stand][row],
          ),
        ),
      )}
    </g>
  );
}

function HorizontalGoal({ side }: GoalProps) {
  const u0 = side === 'left' ? -0.035 : 1;
  const u1 = side === 'left' ? 0 : 1.035;
  const [ax, ay] = px(u0, 0.4);
  const [bx, by] = px(u1, 0.4);
  const [cx, cy] = px(u1, 0.6);
  const [dx, dy] = px(u0, 0.6);
  return (
    <g>
      <polygon
        points={`${ax},${ay} ${bx},${by} ${cx},${cy} ${dx},${dy}`}
        fill="var(--net)"
        opacity="0.5"
      />
      <g stroke="var(--net)" strokeWidth="1" opacity="0.8">
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={ax + (dx - ax) * t}
            y1={ay + (dy - ay) * t}
            x2={bx + (cx - bx) * t}
            y2={by + (cy - by) * t}
          />
        ))}
        {[0.33, 0.66].map((t) => (
          <line
            key={t}
            x1={ax + (bx - ax) * t}
            y1={ay + (by - ay) * t}
            x2={dx + (cx - dx) * t}
            y2={dy + (cy - dy) * t}
          />
        ))}
      </g>
      <polyline
        points={`${side === 'left' ? bx : ax},${side === 'left' ? by : ay} ${ax},${ay} ${dx},${dy} ${side === 'left' ? cx : dx},${side === 'left' ? cy : dy}`}
        fill="none"
        stroke="var(--pitch-line)"
        strokeWidth="3"
      />
    </g>
  );
}
