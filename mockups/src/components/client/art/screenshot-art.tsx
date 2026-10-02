import { cn } from '#/lib/utils';

import { paletteOf } from './palettes';

export type ScreenshotArtVariant =
  'dashboard' | 'mobile' | 'editor' | 'chart' | 'landing';

type Props = {
  palette: number;
  variant: ScreenshotArtVariant;
  width: number;
  height: number;
  title: string;
  className?: string;
};

type Colors = { a: string; b: string; c: string; d: string };
type Box = { w: number; h: number; u: number };

// アップロードされたスクリーンショットの代替。原本の縦横比を保ったまま、アプリ画面風の図形を描く
export function ScreenshotArt({
  palette,
  variant,
  width,
  height,
  title,
  className,
}: Props) {
  const [a, b, c, d] = paletteOf(palette);
  const colors = { a, b, c, d };
  const box = { w: width, h: height, u: Math.min(width, height) / 100 };
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
      className={cn('block h-full w-auto', className)}
    >
      <rect width={width} height={height} fill={c} />
      {variant === 'dashboard' && <Dashboard colors={colors} box={box} />}
      {variant === 'mobile' && <Mobile colors={colors} box={box} />}
      {variant === 'editor' && <Editor colors={colors} box={box} />}
      {variant === 'chart' && <Chart colors={colors} box={box} />}
      {variant === 'landing' && <Landing colors={colors} box={box} />}
    </svg>
  );
}

type PartProps = { colors: Colors; box: Box };

function Dashboard({ colors: { a, b, d }, box: { w, h, u } }: PartProps) {
  const bar = 8 * u;
  const side = w * 0.18;
  const cardW = (w - side - 5 * 3 * u) / 3;
  return (
    <>
      <rect width={w} height={bar} fill={d} />
      <circle cx={4 * u} cy={bar / 2} r={1.6 * u} fill={b} />
      <rect width={side} y={bar} height={h - bar} fill={a} opacity="0.9" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={2 * u}
          y={bar + 4 * u + i * 6 * u}
          width={side - 4 * u}
          height={3 * u}
          rx={u}
          fill="#ffffff"
          opacity={i === 1 ? 0.9 : 0.35}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect
            x={side + 3 * u + i * (cardW + 3 * u)}
            y={bar + 4 * u}
            width={cardW}
            height={14 * u}
            rx={2 * u}
            fill="#ffffff"
          />
          <rect
            x={side + 6 * u + i * (cardW + 3 * u)}
            y={bar + 8 * u}
            width={cardW * 0.5}
            height={4 * u}
            rx={u}
            fill={i === 1 ? b : a}
          />
        </g>
      ))}
      <rect
        x={side + 3 * u}
        y={bar + 22 * u}
        width={w - side - 6 * u}
        height={h - bar - 26 * u}
        rx={2 * u}
        fill="#ffffff"
      />
      <polyline
        fill="none"
        stroke={b}
        strokeWidth={1.4 * u}
        strokeLinejoin="round"
        points={Array.from({ length: 8 }, (_, i) => {
          const x = side + 7 * u + (i * (w - side - 14 * u)) / 7;
          const y = h - 10 * u - ((i * 37) % 23) * u - i * 1.5 * u;
          return `${x},${Math.max(bar + 28 * u, y)}`;
        }).join(' ')}
      />
    </>
  );
}

function Mobile({ colors: { a, b, d }, box: { w, h, u } }: PartProps) {
  const header = h * 0.14;
  const rows = Math.max(3, Math.floor((h - header - 30 * u) / (18 * u)));
  return (
    <>
      <rect width={w} height={header} fill={a} />
      <rect
        x={6 * u}
        y={header * 0.55}
        width={w * 0.5}
        height={5 * u}
        rx={u}
        fill="#ffffff"
      />
      <circle cx={w - 10 * u} cy={header * 0.62} r={4 * u} fill={b} />
      {Array.from({ length: rows }, (_, i) => (
        <g key={i}>
          <rect
            x={5 * u}
            y={header + 6 * u + i * 18 * u}
            width={w - 10 * u}
            height={14 * u}
            rx={3 * u}
            fill="#ffffff"
          />
          <circle
            cx={13 * u}
            cy={header + 13 * u + i * 18 * u}
            r={4.5 * u}
            fill={i % 2 === 0 ? b : a}
          />
          <rect
            x={22 * u}
            y={header + 10 * u + i * 18 * u}
            width={(w - 34 * u) * (0.9 - (i % 3) * 0.2)}
            height={2.5 * u}
            rx={u}
            fill={d}
            opacity="0.7"
          />
          <rect
            x={22 * u}
            y={header + 14.5 * u + i * 18 * u}
            width={(w - 34 * u) * 0.45}
            height={2 * u}
            rx={u}
            fill={d}
            opacity="0.3"
          />
        </g>
      ))}
      <rect y={h - 14 * u} width={w} height={14 * u} fill={d} />
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx={(w / 4) * (i + 0.5)}
          cy={h - 7 * u}
          r={2.5 * u}
          fill={i === 0 ? b : '#ffffff'}
          opacity={i === 0 ? 1 : 0.5}
        />
      ))}
    </>
  );
}

function Editor({ colors: { a, b, d }, box: { w, h, u } }: PartProps) {
  const split = w > h ? w * 0.42 : w;
  const lines = Math.floor((h - 16 * u) / (6 * u));
  return (
    <>
      <rect width={w} height={8 * u} fill={a} />
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={(4 + i * 4) * u}
          cy={4 * u}
          r={1.3 * u}
          fill="#ffffff"
          opacity="0.8"
        />
      ))}
      <rect y={8 * u} width={split} height={h - 8 * u} fill={d} />
      {Array.from({ length: lines }, (_, i) => (
        <g key={i}>
          <rect
            x={(4 + (i % 4 === 0 ? 0 : 4)) * u}
            y={14 * u + i * 6 * u}
            width={split * (0.25 + ((i * 17) % 50) / 100)}
            height={2.4 * u}
            rx={u}
            fill={i % 3 === 0 ? b : '#ffffff'}
            opacity={i % 3 === 0 ? 0.95 : 0.45}
          />
        </g>
      ))}
      {w > h && (
        <>
          <rect
            x={split + 5 * u}
            y={14 * u}
            width={w - split - 10 * u}
            height={10 * u}
            rx={2 * u}
            fill={a}
          />
          {Array.from({ length: Math.max(2, lines - 4) }, (_, i) => (
            <rect
              key={i}
              x={split + 5 * u}
              y={30 * u + i * 6 * u}
              width={(w - split - 10 * u) * (0.6 + ((i * 13) % 40) / 100)}
              height={2.4 * u}
              rx={u}
              fill={d}
              opacity="0.35"
            />
          ))}
        </>
      )}
    </>
  );
}

function Chart({ colors: { a, b, d }, box: { w, h, u } }: PartProps) {
  const base = h - 12 * u;
  const bars = 7;
  const area = w * (w > h ? 0.62 : 0.86);
  const barW = area / bars / 1.6;
  return (
    <>
      <rect
        x={6 * u}
        y={6 * u}
        width={w * 0.4}
        height={5 * u}
        rx={u}
        fill={d}
      />
      <line
        x1={6 * u}
        x2={6 * u + area}
        y1={base}
        y2={base}
        stroke={d}
        strokeWidth={0.6 * u}
        opacity="0.5"
      />
      {Array.from({ length: bars }, (_, i) => {
        const barH = (h * 0.55 * (((i * 29) % 60) + 40)) / 100;
        return (
          <rect
            key={i}
            x={6 * u + (i * area) / bars + barW * 0.3}
            y={base - barH}
            width={barW}
            height={barH}
            rx={u}
            fill={i % 3 === 2 ? b : a}
          />
        );
      })}
      {w > h ? (
        <g transform={`translate(${w * 0.83} ${h * 0.5})`}>
          <circle r={w * 0.11} fill="none" stroke={a} strokeWidth={w * 0.05} />
          <circle
            r={w * 0.11}
            fill="none"
            stroke={b}
            strokeWidth={w * 0.05}
            strokeDasharray={`${w * 0.25} ${w}`}
          />
        </g>
      ) : (
        <circle cx={w - 14 * u} cy={14 * u} r={6 * u} fill={b} />
      )}
    </>
  );
}

function Landing({ colors: { a, b, d }, box: { w, h, u } }: PartProps) {
  const hero = h * 0.48;
  const cols = w > h ? 3 : 2;
  const gap = 4 * u;
  const cardW = (w - gap * (cols + 1)) / cols;
  return (
    <>
      <rect width={w} height={hero} fill={a} />
      <rect
        x={w * 0.1}
        y={hero * 0.25}
        width={w * 0.6}
        height={7 * u}
        rx={u}
        fill="#ffffff"
      />
      <rect
        x={w * 0.1}
        y={hero * 0.25 + 11 * u}
        width={w * 0.45}
        height={4 * u}
        rx={u}
        fill="#ffffff"
        opacity="0.6"
      />
      <rect
        x={w * 0.1}
        y={hero * 0.25 + 20 * u}
        width={w * 0.2}
        height={8 * u}
        rx={4 * u}
        fill={b}
      />
      <circle
        cx={w * 0.85}
        cy={hero * 0.55}
        r={Math.min(w, hero) * 0.2}
        fill={b}
        opacity="0.85"
      />
      {Array.from({ length: cols }, (_, i) => (
        <g key={i}>
          <rect
            x={gap + i * (cardW + gap)}
            y={hero + 6 * u}
            width={cardW}
            height={h - hero - 12 * u}
            rx={3 * u}
            fill="#ffffff"
          />
          <circle
            cx={gap + i * (cardW + gap) + 7 * u}
            cy={hero + 14 * u}
            r={3 * u}
            fill={i === 1 ? b : a}
          />
          <rect
            x={gap + i * (cardW + gap) + 4 * u}
            y={hero + 21 * u}
            width={cardW - 8 * u}
            height={2.5 * u}
            rx={u}
            fill={d}
            opacity="0.4"
          />
        </g>
      ))}
    </>
  );
}
