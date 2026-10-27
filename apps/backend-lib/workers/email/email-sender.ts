import { z } from 'zod';

import { isValidEmailAddress } from '../../core/email/email-address.ts';
import { validateExtraHeaders } from '../../core/email/email-headers.ts';
import type { EmailKindRegistry } from '../../core/email/email-kind.ts';
import {
  type EmailSender,
  EmailSendError,
  type EmailSendRequest,
} from '../../core/email/ports.ts';
import {
  EMAIL_SEND_MESSAGE,
  type EmailSendBody,
  isWithinEmailSendBodyLimit,
} from '../../core/email/send-message.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

const deadlineSchema = z.iso.datetime();

// 受信側の検証規則は4桁の年のISO 8601形式だけを受け付けるため、それで表せない日時も無効として扱う
function toDeadlineString(deadline: unknown): string | undefined {
  if (!(deadline instanceof Date) || Number.isNaN(deadline.getTime())) {
    return undefined;
  }
  const iso = deadline.toISOString();
  return deadlineSchema.safeParse(iso).success ? iso : undefined;
}

function buildBody<TInput>(
  registry: EmailKindRegistry,
  request: EmailSendRequest<TInput>,
): EmailSendBody {
  const { kind, to, input, deadline, headers } = request;
  // 送信処理は登録された種別の検証規則で入力を検証し直すため、受付も同じ名前で引いた登録の規則で検証する
  const registered = registry.get(kind.name);
  if (registered === undefined) {
    throw new EmailSendError('unknown-kind');
  }
  const parsedInput = registered.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new EmailSendError('invalid-input');
  }
  if (!isValidEmailAddress(to)) {
    throw new EmailSendError('invalid-address');
  }
  if (headers !== undefined && !validateExtraHeaders(headers).ok) {
    throw new EmailSendError('invalid-headers');
  }
  const deadlineString =
    deadline === undefined ? undefined : toDeadlineString(deadline);
  if (deadline !== undefined && deadlineString === undefined) {
    throw new EmailSendError('invalid-deadline');
  }

  const body: EmailSendBody = {
    kind: registered.name,
    to,
    input: parsedInput.data,
    ...(deadlineString === undefined ? {} : { deadline: deadlineString }),
    ...(headers === undefined ? {} : { headers }),
  };
  if (!isWithinEmailSendBodyLimit(body)) {
    throw new EmailSendError('too-large');
  }
  return body;
}

export function createEmailSender(
  publisher: MessagePublisher,
  registry: EmailKindRegistry,
): EmailSender {
  return {
    async send(request) {
      const body = buildBody(registry, request);
      // Queueの障害は呼び出し側の不具合ではないため、EmailSendErrorに包まずにそのまま伝える
      return publisher.publish(EMAIL_SEND_MESSAGE, body);
    },
  };
}
