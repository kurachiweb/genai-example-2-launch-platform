import type {
  EmailProvider,
  OutgoingEmail,
} from '../../../application/email/ports.ts';
import type { ExtraHeaders } from '../../../../lib/core/email/email-headers.ts';
import {
  classifyCloudflareSendError,
  type EmailProviderOutcome,
} from '../../../../lib/core/email/provider-outcome.ts';

export interface SendEmailBindingLike {
  send(message: {
    readonly from: { readonly email: string; readonly name: string };
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
    readonly headers?: Readonly<Record<string, string>>;
  }): Promise<{ readonly messageId: string }>;
}

export const PROVIDER_TIMEOUT_MILLISECONDS = 30_000;

const TIMEOUT_OUTCOME: EmailProviderOutcome = Object.freeze({
  kind: 'temporary',
  code: 'timeout',
});

function headersField(headers: ExtraHeaders): { headers?: ExtraHeaders } {
  return Object.keys(headers).length === 0 ? {} : { headers };
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

async function sendWithClassification(
  binding: SendEmailBindingLike,
  email: OutgoingEmail,
): Promise<EmailProviderOutcome> {
  try {
    // 返信先は受信者からの返信を受け付けない方針のため渡さない
    const { messageId } = await binding.send({
      from: { email: email.from.address, name: email.from.name },
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...headersField(email.headers),
    });
    return { kind: 'sent', providerMessageId: messageId };
  } catch (error: unknown) {
    return classifyCloudflareSendError(errorCodeOf(error));
  }
}

export function createCloudflareEmailProvider(
  binding: SendEmailBindingLike,
  timeoutMilliseconds: number = PROVIDER_TIMEOUT_MILLISECONDS,
): EmailProvider {
  return {
    async send(email) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<EmailProviderOutcome>((resolve) => {
        timer = setTimeout(() => {
          resolve(TIMEOUT_OUTCOME);
        }, timeoutMilliseconds);
      });
      try {
        return await Promise.race([
          sendWithClassification(binding, email),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
