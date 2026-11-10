import type { ReactNode } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { MATCH_BOT_ACTIONS } from './bot-actions.ts';
import { UpvoteTurnstileContext } from './upvote-turnstile.ts';

export interface UpvoteBotProtectionProps {
  readonly children: ReactNode;
}

// 対戦カードを並べるページに1つだけ置き、内側の全てのuseUpvoteへ同じウィジェットのトークンを渡す。カードごとにウィジェットを置くと、カードの数だけ判定が走るため
export function UpvoteBotProtection({ children }: UpvoteBotProtectionProps) {
  const turnstile = useTurnstileToken();
  return (
    <UpvoteTurnstileContext value={turnstile}>
      {children}
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={MATCH_BOT_ACTIONS.upvote}
      />
    </UpvoteTurnstileContext>
  );
}
