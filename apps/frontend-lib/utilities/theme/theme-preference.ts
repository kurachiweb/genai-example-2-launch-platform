export type ThemePreference = 'light' | 'dark';

export interface ThemeRoot {
  readonly classList: Pick<DOMTokenList, 'contains' | 'toggle'>;
  readonly style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

export const THEME_STORAGE_KEY = 'ls-theme';

const DARK_CLASS = 'dark';

// headのインラインスクリプトとして最初の描画より前に実行し、保存値またはOSの配色の設定を反映して別の配色の一瞬の表示を防ぐ。保存先やmatchMediaを使えない環境でも例外で描画を止めないよう、読み取りごとに例外を捕まえる
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){try{t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){t='light'}}d.classList.toggle('${DARK_CLASS}',t==='dark');d.style.colorScheme=t})()`;

export const readThemePreference = (root: ThemeRoot): ThemePreference =>
  root.classList.contains(DARK_CLASS) ? 'dark' : 'light';

export const setThemePreference = (
  root: ThemeRoot,
  storage: Pick<Storage, 'setItem'> | undefined,
  theme: ThemePreference,
): void => {
  root.classList.toggle(DARK_CLASS, theme === 'dark');
  root.style.colorScheme = theme;
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // プライベートモードや容量の上限で保存できなくても、その表示の間は切り替えを反映してエラーを表示しない
  }
};
