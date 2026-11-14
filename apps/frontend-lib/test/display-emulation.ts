import { cdp } from 'vitest/browser';

import type { DisplayPreferences } from '../utilities/datetime/display-preferences.ts';

// 空の値を送ると上書きをやめ、実行環境のタイムゾーンとロケールに戻る
export async function emulateBrowserDisplay(
  preferences: DisplayPreferences | null,
): Promise<void> {
  await cdp().send('Emulation.setTimezoneOverride', {
    timezoneId: preferences?.timeZone ?? '',
  });
  await cdp().send(
    'Emulation.setLocaleOverride',
    preferences === null ? {} : { locale: preferences.locale },
  );
}
