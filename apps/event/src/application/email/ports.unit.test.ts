import { describe, expect, test } from 'bun:test';

import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../lib/core/email/kinds/email-delivery-smoke.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
import type { EmailProviderOutcome } from '../../../lib/core/email/provider-outcome.ts';
import {
  type EmailIncident,
  type EmailProvider,
  EmailRenderError,
  type EmailRenderer,
  type EmailRuntimeConfig,
  type OutgoingEmail,
  type RenderedEmail,
} from './ports.ts';

const OUTGOING_EMAIL: OutgoingEmail = {
  from: { address: 'noreply@mail.example', name: 'Launch Stadium' },
  to: 'user@mail.example',
  subject: 'メール送信の確認',
  html: '<p>本文</p>',
  text: '本文',
  headers: {},
};

describe('EmailRenderError', () => {
  test('Errorとして見分けられ、名前で描画の失敗と分かる', () => {
    const error = new EmailRenderError('テンプレートがありません');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EmailRenderError);
    expect(error.name).toBe('EmailRenderError');
    expect(error.message).toBe('テンプレートがありません');
  });

  test('描画中の例外を原因として保持できる', () => {
    const cause = new TypeError('描画に失敗しました');

    const error = new EmailRenderError('描画に失敗しました', { cause });

    expect(error.cause).toBe(cause);
  });
});

describe('EmailProvider', () => {
  test('送信の失敗を例外ではなく共通の送信結果として返せる', async () => {
    const outcome: EmailProviderOutcome = {
      kind: 'temporary',
      code: 'timeout',
    };
    const provider: EmailProvider = {
      send: () => Promise.resolve(outcome),
    };

    expect(await provider.send(OUTGOING_EMAIL)).toEqual(outcome);
  });
});

describe('EmailRenderer', () => {
  test('種別・未検証の入力・送信者情報の有無を受け取り、件名と両パートを返す', async () => {
    const senderInfo: SenderInfo = {
      businessName: '運営者',
      contactEmail: 'support@mail.example',
      postalAddress: '東京都',
    };
    const rendered: RenderedEmail = {
      subject: 'メール送信の確認',
      html: '<p>本文</p>',
      text: '本文',
    };
    const calls: [string, SenderInfo | undefined][] = [];
    const renderer: EmailRenderer = {
      render: (kind, _input, info) => {
        calls.push([kind.name, info]);
        return Promise.resolve(rendered);
      },
    };

    await renderer.render(EMAIL_DELIVERY_SMOKE_KIND, {}, senderInfo);
    await renderer.render(EMAIL_DELIVERY_SMOKE_KIND, {}, undefined);

    expect(calls).toEqual([
      ['email-delivery.smoke', senderInfo],
      ['email-delivery.smoke', undefined],
    ]);
  });
});

describe('EmailRuntimeConfig', () => {
  test('表示名はLaunch Stadiumに固定され、他の表示名は型検査で拒否される', () => {
    const config: EmailRuntimeConfig = {
      fromAddress: 'noreply@mail.example',
      fromName: 'Launch Stadium',
    };
    const invalid: EmailRuntimeConfig = {
      fromAddress: 'noreply@mail.example',
      // @ts-expect-error 表示名は環境ごとに変えられない
      fromName: 'Other',
    };

    expect(config.fromName).toBe('Launch Stadium');
    expect<string>(invalid.fromName).toBe('Other');
  });
});

describe('EmailIncident', () => {
  test('送信不能は種別・分類・送信要求の識別子・コードを持ち、宛先を持てない', () => {
    const incident: EmailIncident = {
      kind: 'undeliverable',
      emailKind: 'email-delivery.smoke',
      category: 'transactional',
      requestId: '01JAAAAAAAAAAAAAAAAAAAAAAA',
      code: 'render-failed',
      // @ts-expect-error 通知に宛先を含めない
      to: 'user@mail.example',
    };

    expect(incident.kind).toBe('undeliverable');
  });

  test('未登録の種別の送信不能は分類を持たずに表せる', () => {
    const incident: EmailIncident = {
      kind: 'undeliverable',
      emailKind: 'unknown.kind',
      category: undefined,
      requestId: '01JAAAAAAAAAAAAAAAAAAAAAAA',
      code: 'unknown-kind',
    };

    expect(incident.category).toBeUndefined();
  });

  test('日次上限・送信側の拒否・配送失敗・不正な配信不能イベントを表せる', () => {
    const incidents: EmailIncident[] = [
      { kind: 'daily-limit' },
      { kind: 'sender-side-rejection', reason: 'policy' },
      { kind: 'delivery-failed', reason: 'unknown' },
      { kind: 'invalid-delivery-event', type: undefined },
      { kind: 'invalid-delivery-event', type: 'cf.email.sending.message.x' },
    ];

    expect(incidents.map((incident) => incident.kind)).toEqual([
      'daily-limit',
      'sender-side-rejection',
      'delivery-failed',
      'invalid-delivery-event',
      'invalid-delivery-event',
    ]);
  });
});
