import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { ModerationUserSuspendedInput } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { ModerationActedAtText } from './moderation-acted-at-text.tsx';
import { ModerationMultilineText } from './moderation-multiline-text.tsx';
import {
  USER_SUSPENDED_LEAD,
  USER_SUSPENDED_SPONSORSHIP_PARAGRAPH,
} from './moderation-notice-copy.ts';

interface UserSuspendedEmailBodyProps {
  readonly input: ModerationUserSuspendedInput;
}

export function UserSuspendedEmailBody({
  input,
}: UserSuspendedEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{USER_SUSPENDED_LEAD}</Text>
      <ModerationActedAtText label="停止日時" at={input.suspendedAt} />
      <ModerationMultilineText label="理由" value={input.reason} />
      <Text>
        停止中は、あなたのプロフィール・プロダクト・コメントは他のユーザーに表示されません。まだ始まっていないマッチの予定は取り消され、停止が解除されても元に戻りません。
      </Text>
      <Text>
        Ultrasに加入している場合は、課金期間の末日で解約されます。支払い済みの料金は返金されません。
      </Text>
      <Text>{USER_SUSPENDED_SPONSORSHIP_PARAGRAPH}</Text>
      <Text>
        トーナメントの組み合わせ決定の時点で停止中の場合、支払ったトーナメントの参加費は自動で全額返金されます。
      </Text>
      <Text>
        停止中でも、お問い合わせから退会を依頼できます。停止についてのご質問も、下のボタンからお問い合わせください。
      </Text>
    </>
  );
}
