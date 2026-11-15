import { useSyncExternalStore } from 'react';

import {
  readThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../../utilities/theme/theme-preference.ts';

export interface ThemeController {
  readonly theme: ThemePreference;
  readonly setTheme: (theme: ThemePreference) => void;
}

// 配色は初回描画前のスクリプトや他の部品の切り替えでも変わるため、html要素のclassの変化を見張って全ての利用箇所を追従させる
const subscribe = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => {
    observer.disconnect();
  };
};

const getSnapshot = (): ThemePreference =>
  readThemePreference(document.documentElement);

// サーバーは保存値もOSの設定も知らないため、ハイドレーションまではライトとして描画し、その後にhtml要素の配色へ切り替える
const getServerSnapshot = (): ThemePreference => 'light';

// Cookieやサイトデータを禁止した設定では参照するだけで例外になるため、保存先が無いものとして扱う
const localStorageOrUndefined = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const setTheme = (theme: ThemePreference): void => {
  setThemePreference(
    document.documentElement,
    localStorageOrUndefined(),
    theme,
  );
};

export function useTheme(): ThemeController {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { theme, setTheme };
}
