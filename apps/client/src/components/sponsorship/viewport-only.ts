// 画面幅で表示を切り替える広告の要素の印。ページは区画の目印と合わせてこの印を読み、表示されない幅では枠・列・一覧の項目を畳む。
// wideは画面幅1024px(64rem)以上だけ、narrowは未満だけで表示する
export const VIEWPORT_ONLY_ATTRIBUTES = Object.freeze({
  wide: Object.freeze({ 'data-wide-only': '' }),
  narrow: Object.freeze({ 'data-narrow-only': '' }),
});
