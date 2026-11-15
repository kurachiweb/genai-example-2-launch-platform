import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  defineMessageContract,
  type MessageHandler,
  type MessageHandlerRegistration,
  type MessageHandlingResult,
  type MessageMeta,
} from './message-contract.ts';

const sendEmailBody = z.object({ templateId: z.string().min(1) });

describe('defineMessageContract', () => {
  test('種別と本文の検証規則を組にした凍結済みの契約を返す', () => {
    const contract = defineMessageContract('email.send', sendEmailBody);

    expect(contract).toEqual({ type: 'email.send', schema: sendEmailBody });
    expect(Object.isFrozen(contract)).toBe(true);
  });

  test('契約の検証規則で本文を検証できる', () => {
    const contract = defineMessageContract('email.send', sendEmailBody);

    expect(contract.schema.safeParse({ templateId: 'welcome' }).success).toBe(
      true,
    );
    expect(contract.schema.safeParse({ templateId: '' }).success).toBe(false);
  });

  test.each(['email.send', 'media.purge-image-cache', 'identity.email-v2'])(
    '<ドメイン>.<動詞句>の種別名%pを受け付ける',
    (type) => {
      expect(defineMessageContract(type, sendEmailBody).type).toBe(type);
    },
  );

  test.each([
    '',
    'email',
    'email.',
    '.send',
    'Email.send',
    'email.Send',
    'email.sendNow',
    'email_send',
    'email.send_now',
    'email.send.now',
    'email.-send',
    'email.send-',
    'email..send',
    ' email.send',
  ])('<ドメイン>.<動詞句>の形でない種別名%pはRangeErrorになる', (type) => {
    expect(() => defineMessageContract(type, sendEmailBody)).toThrow(
      RangeError,
    );
  });
});

describe('MessageHandler', () => {
  test('処理は完了、または試行回数を数えない遅延再送を返せる', async () => {
    const results: MessageHandlingResult[] = [];
    const handler: MessageHandler<{ readonly templateId: string }> = {
      handle: (body, meta) => {
        const result: MessageHandlingResult =
          body.templateId === 'later'
            ? { kind: 'defer', delaySeconds: meta.attempts * 60 }
            : { kind: 'done' };
        return Promise.resolve(result);
      },
    };
    const meta: MessageMeta = {
      id: '01JBZ8Q4N6V2W3X5Y7Z9A0B1C2',
      type: 'email.send',
      attempts: 2,
      sentAt: new Date('2026-10-25T08:00:00.000Z'),
    };

    results.push(await handler.handle({ templateId: 'welcome' }, meta));
    results.push(await handler.handle({ templateId: 'later' }, meta));

    expect(results).toEqual([
      { kind: 'done' },
      { kind: 'defer', delaySeconds: 120 },
    ]);
  });

  test('登録は契約と処理の識別子と再試行の方針の上書きを組にする', () => {
    const contract = defineMessageContract('email.send', sendEmailBody);
    const handlerId = Symbol.for('test.SendEmailHandler');

    const registration: MessageHandlerRegistration<
      z.infer<typeof sendEmailBody>
    > = { contract, handler: handlerId, retry: { maxAttempts: 3 } };

    expect(registration.contract.type).toBe('email.send');
    expect(registration.handler).toBe(handlerId);
    expect(registration.retry).toEqual({ maxAttempts: 3 });
  });
});
