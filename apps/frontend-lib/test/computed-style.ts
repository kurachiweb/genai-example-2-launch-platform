export type ColorScheme = 'light' | 'dark';

export const COLOR_SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

export interface OutlineStyle {
  readonly style: string;
  readonly width: number;
  readonly color: string;
}

export function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle('dark', scheme === 'dark');
}

// 計算値の色の表記はブラウザが正規化するため、比べる値も同じ経路で計算値にする
export function computedColorOf(value: string): string {
  const probe = document.createElement('div');
  probe.style.color = value;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
}

export function tokenColorOf(token: string): string {
  return computedColorOf(`var(--${token})`);
}

export function outlineOf(element: Element): OutlineStyle {
  const { outlineStyle, outlineWidth, outlineColor } =
    getComputedStyle(element);
  return {
    style: outlineStyle,
    width: Number.parseFloat(outlineWidth),
    color: outlineColor,
  };
}

export function ringOutline(): OutlineStyle {
  return { style: 'solid', width: 2, color: tokenColorOf('ring') };
}

export function isContentClipped(element: Element): boolean {
  return (
    element.scrollWidth > element.clientWidth ||
    element.scrollHeight > element.clientHeight
  );
}
