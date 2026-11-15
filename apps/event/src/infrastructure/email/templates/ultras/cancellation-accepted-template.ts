import { ULTRAS_CANCELLATION_ACCEPTED_KIND } from '../../../../../lib/core/email/kinds/ultras.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { CancellationAcceptedEmailBody } from './cancellation-accepted-email-body.tsx';

export const CANCELLATION_ACCEPTED_TEMPLATE = defineEmailTemplate({
  kind: ULTRAS_CANCELLATION_ACCEPTED_KIND,
  subject: () => 'Ultrasの解約を受け付けました',
  preview: () =>
    'Ultrasの解約を受け付けました。特典は課金期間の末日まで続きます。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'プランを見る', url: input.planUrl }),
  Body: CancellationAcceptedEmailBody,
});
