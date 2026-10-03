import { cn } from '#/lib/utils';

// 背景色はIDのハッシュから決定論的に選ぶ。文字色は背景とのコントラスト比が高い方(白/黒)を都度算出する
const BACKGROUNDS = [
  '#0f766e',
  '#1d4ed8',
  '#7c3aed',
  '#be123c',
  '#c2410c',
  '#4d7c0f',
  '#0e7490',
  '#a16207',
  '#fda4af',
  '#a5f3fc',
  '#d9f99d',
  '#fde68a',
];

function hashOf(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

function textColorFor(background: string): string {
  const luminance = relativeLuminance(background);
  return contrastRatio(luminance, 1) >= contrastRatio(luminance, 0)
    ? '#ffffff'
    : '#111111';
}

// 絵文字や結合文字を分断しないよう書記素単位で先頭1文字を取り出す
function firstGrapheme(text: string): string {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const first = segmenter.segment(text.trim())[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toUpperCase();
}

type Props = {
  seed: string;
  name: string;
  size: number;
  shape: 'rounded' | 'circle';
  label: string;
  className?: string;
};

export function InitialPlaceholder({
  seed,
  name,
  size,
  shape,
  label,
  className,
}: Props) {
  const background = BACKGROUNDS[hashOf(seed) % BACKGROUNDS.length];
  // 大きさはclassNameのsize-*で上書きできるようCSS変数で渡し、文字は自身の大きさに比例させる
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        '@container-[size] inline-flex size-(--placeholder-size) shrink-0 items-center justify-center font-extrabold select-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={
        {
          '--placeholder-size': `${size}px`,
          backgroundColor: background,
          color: textColorFor(background),
        } as React.CSSProperties
      }
    >
      <span aria-hidden="true" className="text-[46cqmin] leading-none">
        {firstGrapheme(name)}
      </span>
    </span>
  );
}
