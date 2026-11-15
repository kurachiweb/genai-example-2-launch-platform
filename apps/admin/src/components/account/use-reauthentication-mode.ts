import { useState } from 'react';

import type { ReauthenticationMode } from './account-form-schemas.ts';

export interface ReauthenticationModeState {
  readonly mode: ReauthenticationMode;
  readonly toggleSecondFactor: () => void;
}

// 本人確認で認証コードとリカバリコードのどちらの欄を描くかを切り替える
export function useReauthenticationMode(): ReauthenticationModeState {
  const [mode, setMode] = useState<ReauthenticationMode>('totp');
  return {
    mode,
    toggleSecondFactor: () => {
      setMode((current) => (current === 'totp' ? 'recovery' : 'totp'));
    },
  };
}
