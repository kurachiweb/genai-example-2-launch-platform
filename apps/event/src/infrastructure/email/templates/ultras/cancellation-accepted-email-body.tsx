import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';
import type { CancellationAcceptedInput } from '../../../../../lib/core/email/kinds/ultras.ts';

interface CancellationAcceptedEmailBodyProps {
  readonly input: CancellationAcceptedInput;
}

export function CancellationAcceptedEmailBody({
  input,
}: CancellationAcceptedEmailBodyProps): ReactNode {
  const acceptedAt = new Date(input.acceptedAt);
  const benefitEndsAt = new Date(input.benefitEndsAt);
  return (
    <>
      <Text>
        <time dateTime={acceptedAt.toISOString()}>
          {formatUtcDateTime(acceptedAt, { withYear: true })}
        </time>
        に、Ultrasの解約を受け付けました。
      </Text>
      <Text>
        特典は
        <time dateTime={benefitEndsAt.toISOString()}>
          {formatUtcDateTime(benefitEndsAt, { withYear: true })}
        </time>
        まで続き、その後は更新されません。
      </Text>
      <Text>
        解約を取り消す場合は、下のボタンからプラン管理画面を開き、「解約・支払い方法の管理」から解約を取り消してください。特典の終了日時を過ぎると取り消せません。
      </Text>
    </>
  );
}
