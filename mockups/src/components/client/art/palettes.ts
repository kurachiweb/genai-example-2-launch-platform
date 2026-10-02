// 各パレットは3色以上。アップロード画像の代替として多彩さを出す
export const PALETTES: [string, string, string, string][] = [
  ['#1d4ed8', '#f59e0b', '#fef3c7', '#0f172a'],
  ['#0f766e', '#fb7185', '#fde68a', '#134e4a'],
  ['#7c3aed', '#22d3ee', '#f5f3ff', '#312e81'],
  ['#be123c', '#fbbf24', '#fff1f2', '#4c0519'],
  ['#0369a1', '#a3e635', '#ecfeff', '#082f49'],
  ['#c2410c', '#0ea5e9', '#fff7ed', '#431407'],
  ['#4d7c0f', '#f472b6', '#f7fee7', '#1a2e05'],
  ['#0e7490', '#f97316', '#fefce8', '#164e63'],
  ['#9333ea', '#facc15', '#faf5ff', '#3b0764'],
  ['#b45309', '#2dd4bf', '#fffbeb', '#451a03'],
  ['#1e3a8a', '#f43f5e', '#dbeafe', '#172554'],
  ['#065f46', '#fb923c', '#ecfdf5', '#022c22'],
];

export function paletteOf(palette: number): [string, string, string, string] {
  return PALETTES[palette % PALETTES.length];
}

export function paletteColors(palette: number): [string, string] {
  const [a, b] = paletteOf(palette);
  return [a, b];
}
