import { createContext, use } from 'react';

import type { TurnstileTokenSource } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';

export const UpvoteTurnstileContext =
  createContext<TurnstileTokenSource | null>(null);

// 1ページに並ぶ全ての対戦カードのUpvoteが、ページに1つ置いたbot判定のウィジェットのトークンを順に使う
export function useUpvoteTurnstile(): TurnstileTokenSource {
  const turnstile = use(UpvoteTurnstileContext);
  if (turnstile === null) {
    throw new Error(
      'useUpvoteはUpvoteBotProtectionの内側で呼び出してください。',
    );
  }
  return turnstile;
}
