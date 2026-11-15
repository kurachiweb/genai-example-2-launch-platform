import { type ReactNode, useSyncExternalStore } from 'react';

import {
  type DisplayPreferences,
  resolveBrowserDisplayPreferences,
} from '../../utilities/datetime/display-preferences.ts';
import { DisplayPreferencesContext } from './use-display-preferences.ts';

export interface DisplayPreferencesProviderProps {
  readonly initial: DisplayPreferences;
  readonly children: ReactNode;
}

const subscribeNothing = (): (() => void) => () => undefined;

const isSamePreferences = (
  left: DisplayPreferences,
  right: DisplayPreferences,
): boolean => left.timeZone === right.timeZone && left.locale === right.locale;

// ブラウザのタイムゾーンとロケールは表示中に変わらないものとしてサーバーの値ごとに1度だけ読み、サーバーの値と同じならサーバーの値のオブジェクトを返して切り替えの再描画を起こさない。描画をやり直しても同じオブジェクトを返すよう、サーバーの値のオブジェクトをキーにして保持する
const browserSnapshots = new WeakMap<DisplayPreferences, DisplayPreferences>();

const browserSnapshotOf = (initial: DisplayPreferences): DisplayPreferences => {
  const cached = browserSnapshots.get(initial);
  if (cached !== undefined) {
    return cached;
  }
  const browser = resolveBrowserDisplayPreferences();
  const snapshot = isSamePreferences(browser, initial) ? initial : browser;
  browserSnapshots.set(initial, snapshot);
  return snapshot;
};

// サーバー側の描画とハイドレーションではサーバーの値で整形し、ハイドレーションの後にブラウザの値へ切り替えることで、テキストの不一致を起こさない
export function DisplayPreferencesProvider({
  initial,
  children,
}: DisplayPreferencesProviderProps) {
  const preferences = useSyncExternalStore(
    subscribeNothing,
    () => browserSnapshotOf(initial),
    () => initial,
  );
  return (
    <DisplayPreferencesContext value={preferences}>
      {children}
    </DisplayPreferencesContext>
  );
}
