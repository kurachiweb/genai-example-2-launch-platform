import { env } from 'cloudflare:workers';
import { describe, expect, test, vi } from 'vitest';

import type { OutgoingEmail } from '../../../application/email/ports.ts';
import type { SendEmailBindingLike } from './cloudflare-email-provider.ts';
import {
  createEmailProvider,
  type EventEmailEnv,
} from './create-email-provider.ts';

const OUTGOING: OutgoingEmail = {
  from: { address: 'noreply@sender.example', name: 'Launch Stadium' },
  to: 'user@recipient.example',
  subject: '疎通確認',
  html: '<p>疎通確認です。</p>',
  text: '疎通確認です。',
  headers: {},
};

function createFetcher() {
  const spy = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() => Promise.resolve(Response.json({ ID: 'mailpit-message-1' })));
  return spy as typeof spy & typeof fetch;
}

function createBinding() {
  const spy = vi.fn<SendEmailBindingLike['send']>(() =>
    Promise.resolve({ messageId: 'provider-message-1' }),
  );
  const binding: SendEmailBindingLike = { send: spy };
  return { binding, spy };
}

function requestUrlOf(fetcher: ReturnType<typeof createFetcher>): string {
  const [input, init] = fetcher.mock.calls[0] ?? [];
  return new Request(input ?? '', init).url;
}

describe('環境の値による送信プロバイダの選択', () => {
  test('ローカルの設定ではMailpitの送信APIへ送る', async () => {
    const fetcher = createFetcher();

    const outcome = await createEmailProvider(env, fetcher).send(OUTGOING);

    expect(outcome).toEqual({
      kind: 'sent',
      providerMessageId: 'mailpit-message-1',
    });
    expect(requestUrlOf(fetcher)).toBe('http://mailpit.example/api/v1/send');
  });

  test('cloudflareなら送信バインディングで送り、fetchを使わない', async () => {
    const fetcher = createFetcher();
    const { binding, spy } = createBinding();
    const emailEnv: EventEmailEnv = {
      EMAIL_PROVIDER: 'cloudflare',
      EMAIL_RECIPIENT_POLICY: 'any',
      EMAIL: binding,
    };

    const outcome = await createEmailProvider(emailEnv, fetcher).send(OUTGOING);

    expect(outcome).toEqual({
      kind: 'sent',
      providerMessageId: 'provider-message-1',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('allowlistならカンマ区切りの許可を照合キーにして包み、許可外の宛先を送らない', async () => {
    const { binding, spy } = createBinding();
    const provider = createEmailProvider(
      {
        EMAIL_PROVIDER: 'cloudflare',
        EMAIL_RECIPIENT_POLICY: 'allowlist',
        EMAIL_ALLOWED_RECIPIENTS:
          ' Tester@Recipient.EXAMPLE ,,second@recipient.example, ',
        EMAIL: binding,
      },
      createFetcher(),
    );

    const allowed = await provider.send({
      ...OUTGOING,
      to: 'tester@recipient.example',
    });
    const second = await provider.send({
      ...OUTGOING,
      to: 'second@recipient.example',
    });
    const rejected = await provider.send(OUTGOING);

    expect(allowed).toEqual({
      kind: 'sent',
      providerMessageId: 'provider-message-1',
    });
    expect(second.kind).toBe('sent');
    expect(rejected).toEqual({ kind: 'recipient-not-allowed' });
    expect(spy.mock.calls.map(([message]) => message.to)).toEqual([
      'tester@recipient.example',
      'second@recipient.example',
    ]);
  });

  test('allowlistはMailpitも包む', async () => {
    const fetcher = createFetcher();
    const provider = createEmailProvider(
      {
        EMAIL_PROVIDER: 'mailpit',
        EMAIL_RECIPIENT_POLICY: 'allowlist',
        EMAIL_ALLOWED_RECIPIENTS: 'tester@recipient.example',
        MAILPIT_API_URL: 'http://mailpit.example',
      },
      fetcher,
    );

    const outcome = await provider.send(OUTGOING);

    expect(outcome).toEqual({ kind: 'recipient-not-allowed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('anyなら許可の値があっても宛先を制限しない', async () => {
    const { binding, spy } = createBinding();
    const provider = createEmailProvider(
      {
        EMAIL_PROVIDER: 'cloudflare',
        EMAIL_RECIPIENT_POLICY: 'any',
        EMAIL_ALLOWED_RECIPIENTS: 'tester@recipient.example',
        EMAIL: binding,
      },
      createFetcher(),
    );

    const outcome = await provider.send(OUTGOING);

    expect(outcome.kind).toBe('sent');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test.each<[string, EventEmailEnv, string]>([
    [
      'mailpitでMAILPIT_API_URLが無い',
      { EMAIL_PROVIDER: 'mailpit', EMAIL_RECIPIENT_POLICY: 'any' },
      'MAILPIT_API_URL',
    ],
    [
      'cloudflareでEMAILバインディングが無い',
      { EMAIL_PROVIDER: 'cloudflare', EMAIL_RECIPIENT_POLICY: 'any' },
      'EMAIL',
    ],
    [
      'allowlistでEMAIL_ALLOWED_RECIPIENTSが無い',
      {
        EMAIL_PROVIDER: 'mailpit',
        EMAIL_RECIPIENT_POLICY: 'allowlist',
        MAILPIT_API_URL: 'http://mailpit.example',
      },
      'EMAIL_ALLOWED_RECIPIENTS',
    ],
  ])('%s設定は欠けたキー名を示して作成を拒む', (_label, emailEnv, key) => {
    expect(() => createEmailProvider(emailEnv, createFetcher())).toThrow(key);
  });
});
