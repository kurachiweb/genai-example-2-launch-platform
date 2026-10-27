import type {
  EmailProvider,
  OutgoingEmail,
} from '../../../application/email/ports.ts';
import type { EmailProviderOutcome } from '../../../../lib/core/email/provider-outcome.ts';

const SEND_PATH = 'api/v1/send';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

function sendUrl(apiUrl: string): string {
  const base = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  return new URL(SEND_PATH, base).toString();
}

function toRequestBody(email: OutgoingEmail): Record<string, unknown> {
  return {
    From: { Email: email.from.address, Name: email.from.name },
    To: [{ Email: email.to }],
    Subject: email.subject,
    Text: email.text,
    HTML: email.html,
    ...(Object.keys(email.headers).length === 0
      ? {}
      : { Headers: email.headers }),
  };
}

async function messageIdOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('ID' in body)) {
      return undefined;
    }
    return typeof body.ID === 'string' ? body.ID : undefined;
  } catch {
    return undefined;
  }
}

// 送信プロバイダは失敗を例外ではなく結果として返すため、応答の本文を読み捨てられなくても分類を続ける
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    return;
  }
}

async function classifyResponse(
  response: Response,
): Promise<EmailProviderOutcome> {
  if (response.status === HTTP_OK) {
    const messageId = await messageIdOf(response);
    return messageId === undefined
      ? { kind: 'temporary', code: 'mailpit-invalid-response' }
      : { kind: 'sent', providerMessageId: messageId };
  }
  await discardBody(response);
  // 400はMailpitが送信内容を検証して拒否したもので、同じ内容を再送しても結果が変わらない
  return response.status === HTTP_BAD_REQUEST
    ? { kind: 'permanent', code: 'mailpit-rejected' }
    : { kind: 'temporary', code: `mailpit-status-${String(response.status)}` };
}

export function createMailpitEmailProvider(
  apiUrl: string,
  fetcher: typeof fetch,
): EmailProvider {
  const url = sendUrl(apiUrl);
  return {
    async send(email) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toRequestBody(email)),
        });
      } catch {
        return { kind: 'temporary', code: 'mailpit-unreachable' };
      }
      return classifyResponse(response);
    },
  };
}
