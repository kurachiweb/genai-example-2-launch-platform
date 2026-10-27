import { createContext, use } from 'react';

import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';

export const DisplayPreferencesContext =
  createContext<DisplayPreferences | null>(null);

export function useDisplayPreferences(): DisplayPreferences {
  const preferences = use(DisplayPreferencesContext);
  if (preferences === null) {
    throw new Error(
      '日時と数値の部品はDisplayPreferencesProviderの内側で使ってください。',
    );
  }
  return preferences;
}
