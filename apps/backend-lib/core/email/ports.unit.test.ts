import { describe, expect, test } from 'bun:test';

import { validateExtraHeaders } from './email-headers.ts';
import {
  EMAIL_DELIVERY_SMOKE_KIND,
  type EmailDeliverySmokeInput,
} from './kinds/email-delivery-smoke.ts';
import {
  EmailSendError,
  type EmailSendErrorReason,
  type EmailSendRequest,
  type SuppressionStatus,
  type UserAddressLookup,
} from './ports.ts';
import { decideSuppressionEffect } from './suppression-policy.ts';

describe('EmailSendRequest', () => {
  test('種別の入力の型で入力を受け取り、検証済みの追加ヘッダーを渡せる', () => {
    const headers = { 'List-Unsubscribe': '<https://launch.example/u/1>' };

    const request: EmailSendRequest<EmailDeliverySmokeInput> = {
      kind: EMAIL_DELIVERY_SMOKE_KIND,
      to: 'user@mail.example',
      input: { requestedAt: '2026-10-27T07:40:00.000Z' },
      headers,
    };

    expect(validateExtraHeaders(headers)).toEqual({ ok: true });
    expect(request.kind.inputSchema.safeParse(request.input).success).toBe(
      true,
    );
  });

  test('種別の入力と異なる型の入力は型検査で拒否される', () => {
    const request: EmailSendRequest<EmailDeliverySmokeInput> = {
      kind: EMAIL_DELIVERY_SMOKE_KIND,
      to: 'user@mail.example',
      // @ts-expect-error 疎通確認の種別の入力に無い項目は渡せない
      input: { sentAt: '2026-10-27T07:40:00.000Z' },
    };

    expect(request.kind.inputSchema.safeParse(request.input).success).toBe(
      false,
    );
  });
});

const EMAIL_SEND_ERROR_REASONS = [
  'unknown-kind',
  'invalid-input',
  'invalid-address',
  'invalid-headers',
  'invalid-deadline',
  'too-large',
] as const satisfies readonly EmailSendErrorReason[];

describe('EmailSendError', () => {
  test.each(EMAIL_SEND_ERROR_REASONS)(
    '理由%sを保持し、Errorとしても見分けられる',
    (reason) => {
      const error = new EmailSendError(reason);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.name).toBe('EmailSendError');
      expect(error.reason).toBe(reason);
    },
  );

  test.each(EMAIL_SEND_ERROR_REASONS)(
    '理由%sのメッセージは理由ごとに異なる空でない説明である',
    (reason) => {
      const message = new EmailSendError(reason).message;

      expect(message.length).toBeGreaterThan(0);
      expect(
        EMAIL_SEND_ERROR_REASONS.filter(
          (other) => new EmailSendError(other).message === message,
        ),
      ).toEqual([reason]);
    },
  );

  test('メッセージは理由だけから組み立て、宛先や入力の値を含めない', () => {
    const error = new EmailSendError('invalid-address');

    expect(error.message).not.toContain('@');
    expect(error.message).toBe(new EmailSendError('invalid-address').message);
    expect(Object.keys(error).toSorted()).toEqual(['name', 'reason']);
  });
});

describe('SuppressionStatus', () => {
  test('抑止中の状態は抑止の効果が決めた最後の契機と期限を持つ', () => {
    const effect = decideSuppressionEffect({
      eventId: 'event-1',
      kind: 'complaint',
      recipient: 'user@mail.example',
      occurredAt: new Date('2026-10-27T07:40:00.000Z'),
    });
    if (effect.kind !== 'suppress') {
      throw new Error('苦情は抑止の効果になる');
    }

    const status: SuppressionStatus = { suppressed: true, ...effect.state };

    expect(status).toEqual({
      suppressed: true,
      lastReason: 'complaint',
      lastEventAt: new Date('2026-10-27T07:40:00.000Z'),
      expiresAt: null,
    });
  });

  test('抑止中でない状態は契機と期限を持たない', () => {
    const status: SuppressionStatus = {
      suppressed: false,
      // @ts-expect-error 抑止中でない状態に最後の契機は無い
      lastReason: 'complaint',
    };

    expect(status.suppressed).toBe(false);
  });
});

describe('UserAddressLookup', () => {
  test('照会口が使えない場合は登録済みの集合を持たない', () => {
    const lookup: UserAddressLookup = { kind: 'unavailable' };

    expect('registered' in lookup).toBe(false);
  });
});
