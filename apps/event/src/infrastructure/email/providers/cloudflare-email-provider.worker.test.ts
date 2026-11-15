import { describe, expect, test, vi } from 'vitest';

import type { OutgoingEmail } from '../../../application/email/ports.ts';
import type { EmailProviderOutcome } from '../../../../lib/core/email/provider-outcome.ts';
import {
  createCloudflareEmailProvider,
  PROVIDER_TIMEOUT_MILLISECONDS,
  type SendEmailBindingLike,
} from './cloudflare-email-provider.ts';

const OUTGOING: OutgoingEmail = {
  from: { address: 'noreply@sender.example', name: 'Launch Stadium' },
  to: 'user@recipient.example',
  subject: '疎通確認',
  html: '<p>疎通確認です。</p>',
  text: '疎通確認です。',
  headers: {
    'List-Unsubscribe': '<https://unsubscribe.example/u/token>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

type SendMessage = Parameters<SendEmailBindingLike['send']>[0];

function createBinding(
  send: (message: SendMessage) => Promise<{ readonly messageId: string }>,
) {
  const spy = vi.fn(send);
  const binding: SendEmailBindingLike = { send: spy };
  return { binding, spy };
}

function codedError(code: string): Error {
  return Object.assign(new Error('送信に失敗しました'), { code });
}

describe('Email Sendingの送信プロバイダ', () => {
  test('表示名付きの送信元・宛先・件名・両パート・追加ヘッダーを構造化された送信で渡し、返信先を設定しない', async () => {
    const { binding, spy } = createBinding(() =>
      Promise.resolve({ messageId: 'provider-message-1' }),
    );

    const outcome = await createCloudflareEmailProvider(binding).send(OUTGOING);

    expect(outcome).toEqual({
      kind: 'sent',
      providerMessageId: 'provider-message-1',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0]?.[0];
    expect(message).toEqual({
      from: { email: 'noreply@sender.example', name: 'Launch Stadium' },
      to: 'user@recipient.example',
      subject: '疎通確認',
      html: '<p>疎通確認です。</p>',
      text: '疎通確認です。',
      headers: {
        'List-Unsubscribe': '<https://unsubscribe.example/u/token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    expect(message).not.toHaveProperty('replyTo');
  });

  test('追加ヘッダーが無ければheadersを渡さない', async () => {
    const { binding, spy } = createBinding(() =>
      Promise.resolve({ messageId: 'provider-message-2' }),
    );

    await createCloudflareEmailProvider(binding).send({
      ...OUTGOING,
      headers: {},
    });

    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('headers');
  });

  test.each<[string, EmailProviderOutcome]>([
    ['E_RATE_LIMIT_EXCEEDED', { kind: 'rate-limited' }],
    ['E_DAILY_LIMIT_EXCEEDED', { kind: 'daily-limit' }],
    ['E_RECIPIENT_SUPPRESSED', { kind: 'recipient-suppressed' }],
    [
      'E_SENDER_NOT_VERIFIED',
      { kind: 'permanent', code: 'E_SENDER_NOT_VERIFIED' },
    ],
    [
      'E_RECIPIENT_NOT_ALLOWED',
      { kind: 'permanent', code: 'E_RECIPIENT_NOT_ALLOWED' },
    ],
    [
      'E_INTERNAL_SERVER_ERROR',
      { kind: 'temporary', code: 'E_INTERNAL_SERVER_ERROR' },
    ],
    ['E_NEW_UNKNOWN_CODE', { kind: 'temporary', code: 'E_NEW_UNKNOWN_CODE' }],
  ])('例外のコード%sを分類して返す', async (code, expected) => {
    const { binding } = createBinding(() => Promise.reject(codedError(code)));

    const outcome = await createCloudflareEmailProvider(binding).send(OUTGOING);

    expect(outcome).toEqual(expected);
  });

  test.each<[string, unknown]>([
    ['コードの無いError', new Error('送信に失敗しました')],
    ['文字列でないコード', Object.assign(new Error('失敗'), { code: 500 })],
    ['Errorでない値', '送信に失敗しました'],
  ])(
    '%sで失敗したら一時的な障害(コード不明)として返す',
    async (_label, thrown) => {
      // 送信バインディングがErrorでない値で失敗する場合も分類できることを確かめる
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const { binding } = createBinding(() => Promise.reject(thrown));

      const outcome =
        await createCloudflareEmailProvider(binding).send(OUTGOING);

      expect(outcome).toEqual({ kind: 'temporary', code: 'unknown' });
    },
  );

  test('時間切れまでに応答が無ければ一時的な障害(timeout)として返す', async () => {
    const { binding } = createBinding(() => new Promise(() => {}));

    const outcome = await createCloudflareEmailProvider(binding, 10).send(
      OUTGOING,
    );

    expect(outcome).toEqual({ kind: 'temporary', code: 'timeout' });
  });

  test('時間切れの後に送信が失敗しても、時間切れの結果を返す', async () => {
    const { binding } = createBinding(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(codedError('E_INTERNAL_SERVER_ERROR'));
          }, 30);
        }),
    );

    const outcome = await createCloudflareEmailProvider(binding, 10).send(
      OUTGOING,
    );

    expect(outcome).toEqual({ kind: 'temporary', code: 'timeout' });
  });

  test('既定の時間切れは30秒である', () => {
    expect(PROVIDER_TIMEOUT_MILLISECONDS).toBe(30_000);
  });
});
