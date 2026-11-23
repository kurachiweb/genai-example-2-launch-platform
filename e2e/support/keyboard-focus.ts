export interface FocusIndicatorStyle {
  readonly description: string;
  readonly focusVisible: boolean;
  readonly outlineStyle: string;
  readonly outlineWidthPx: number;
  readonly outlineColor: string;
  readonly boxShadow: string;
}

// 上流の基底のスタイル(apps/frontend-lib/styles/base.css)の`:focus-visible`の輪郭と同じ太さ。上流のブラウザテストの`ringOutline()`は2pxの実線を期待し、リングの影や背景の変化だけでは代えられない
export const MIN_OUTLINE_WIDTH_PX = 2;

const TRANSPARENT_PATTERNS: readonly RegExp[] = [
  /^transparent$/u,
  /^rgba\(.*,\s*0\)$/u,
  /\/\s*0(?:\.0+)?\s*\)$/u,
];

export function isTransparentColor(color: string): boolean {
  const normalized = color.trim();
  return TRANSPARENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasVisibleFocusIndicator({
  focusVisible,
  outlineStyle,
  outlineWidthPx,
  outlineColor,
}: FocusIndicatorStyle): boolean {
  return (
    focusVisible &&
    outlineStyle === 'solid' &&
    outlineWidthPx >= MIN_OUTLINE_WIDTH_PX &&
    !isTransparentColor(outlineColor)
  );
}

export function describeFocusProblem(style: FocusIndicatorStyle): string {
  return `${style.description}にフォーカスが見えません(:focus-visible: ${String(style.focusVisible)}、outline: ${style.outlineStyle} ${String(style.outlineWidthPx)}px ${style.outlineColor}、box-shadow: ${style.boxShadow})`;
}
