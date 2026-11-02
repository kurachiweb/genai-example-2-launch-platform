import { useState } from 'react';

import type { ReauthenticationMode } from '../auth/account-form-schemas.ts';

type SecondFactorKind = Exclude<ReauthenticationMode, 'password'>;

export interface ReauthenticationModeState {
  readonly mode: ReauthenticationMode;
  readonly toggleSecondFactor: () => void;
}

// 多要素認証が有効な間だけ、認証コードとリカバリコードのどちらを描くかを切り替える
export function useReauthenticationMode(
  totpEnabled: boolean,
): ReauthenticationModeState {
  const [secondFactor, setSecondFactor] = useState<SecondFactorKind>('totp');
  return {
    mode: totpEnabled ? secondFactor : 'password',
    toggleSecondFactor: () => {
      setSecondFactor((current) => (current === 'totp' ? 'recovery' : 'totp'));
    },
  };
}
