import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  type PaymentReflector,
  type ReflectionInstruction,
  type ReflectionOutcome,
  StripeSignatureError,
  StripeUnavailableError,
  type StripeWebhookVerifier,
  type VerifiedStripeEvent,
} from '../../../lib/core/payments/ports.ts';
import {
  SignedStripeWebhookReceiver,
  StripeWebhookReflectionError,
} from './stripe-webhook-receiver.ts';

const RAW_BODY = '{"id":"evt_test_receiver"}';
const SIGNATURE = 't=1793880000,v1=signature';
const CREATED_SECONDS = 1_793_880_000;

const CHECKOUT_EVENT: VerifiedStripeEvent = {
  id: 'evt_test_receiver',
  type: 'checkout.session.completed',
  created: CREATED_SECONDS,
  data: { object: { id: 'cs_test_receiver' } },
};

interface Recorded {
  readonly calls: string[];
  readonly instructions: ReflectionInstruction[];
  readonly verified: (readonly [string, string | null])[];
}

function receiverWith(options: {
  readonly verify?: StripeWebhookVerifier['verify'];
  readonly reflect?: PaymentReflector['reflect'];
}): { readonly receiver: SignedStripeWebhookReceiver } & Recorded {
  const calls: string[] = [];
  const instructions: ReflectionInstruction[] = [];
  const verified: (readonly [string, string | null])[] = [];
  const verifier: StripeWebhookVerifier = {
    verify: (rawBody, signatureHeader) => {
      calls.push('verify');
      verified.push([rawBody, signatureHeader]);
      return (options.verify ?? (() => Promise.resolve(CHECKOUT_EVENT)))(
        rawBody,
        signatureHeader,
      );
    },
  };
  const reflector: PaymentReflector = {
    reflect: (instruction) => {
      calls.push('reflect');
      instructions.push(instruction);
      return (
        options.reflect ??
        (() => Promise.resolve<ReflectionOutcome>({ kind: 'applied' }))
      )(instruction);
    },
    reflectCheckoutSnapshot: () =>
      Promise.reject(new Error('Webhookの受け付けでは使わない')),
  };
  return {
    receiver: new SignedStripeWebhookReceiver(verifier, reflector),
    calls,
    instructions,
    verified,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外にならなかった');
}

describe('SignedStripeWebhookReceiver', () => {
  test('文字列のままの本文と署名を検証し、正規化した指示を反映して、通知の種類・ID・結果を返す', async () => {
    const { receiver, calls, instructions, verified } = receiverWith({
      reflect: () =>
        Promise.resolve({ kind: 'applied', purchaseStatus: 'fulfilled' }),
    });

    const receipt = await receiver.receive(RAW_BODY, SIGNATURE);

    expect(receipt).toEqual({
      eventId: 'evt_test_receiver',
      eventType: 'checkout.session.completed',
      outcome: 'applied',
    });
    expect(calls).toEqual(['verify', 'reflect']);
    expect(verified).toEqual([[RAW_BODY, SIGNATURE]]);
    expect(instructions).toEqual([
      {
        kind: 'checkout_session',
        sessionId: 'cs_test_receiver',
        occurredAt: new Date(CREATED_SECONDS * 1000),
      },
    ]);
  });

  test.each<ReflectionOutcome['kind']>([
    'already_applied',
    'stale',
    'unresolved',
    'ignored',
  ])('反映の結果が%sでも受領として返す', async (kind) => {
    const { receiver } = receiverWith({
      reflect: () => Promise.resolve({ kind }),
    });

    const receipt = await receiver.receive(RAW_BODY, SIGNATURE);

    expect(receipt.outcome).toBe(kind);
  });

  test('受け付けない種類の通知は無視の指示として反映の処理へ渡す', async () => {
    const { receiver, instructions } = receiverWith({
      verify: () =>
        Promise.resolve({ ...CHECKOUT_EVENT, type: 'customer.created' }),
      reflect: () => Promise.resolve({ kind: 'ignored' }),
    });

    const receipt = await receiver.receive(RAW_BODY, SIGNATURE);

    expect(instructions).toEqual([
      { kind: 'ignored', eventType: 'customer.created' },
    ]);
    expect(receipt).toEqual({
      eventId: 'evt_test_receiver',
      eventType: 'customer.created',
      outcome: 'ignored',
    });
  });

  test('署名の不正はstripe_signature_invalidの400の共通エラーにし、反映しない', async () => {
    const { receiver, calls } = receiverWith({
      verify: () =>
        Promise.reject(
          new StripeSignatureError('Stripeの通知の署名を検証できません'),
        ),
    });

    const error = await rejectionOf(receiver.receive(RAW_BODY, null));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'stripe_signature_invalid',
    });
    expect(calls).toEqual(['verify']);
  });

  test('署名の秘密が未設定ならpayments_unavailableの503の共通エラーにし、反映しない', async () => {
    const { receiver, calls } = receiverWith({
      verify: () =>
        Promise.reject(new StripeUnavailableError('署名の秘密が未設定')),
    });

    const error = await rejectionOf(receiver.receive(RAW_BODY, SIGNATURE));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'payments_unavailable',
    });
    expect(calls).toEqual(['verify']);
  });

  test('検証の想定外の例外はそのまま伝える', async () => {
    const failure = new TypeError('想定外');
    const { receiver } = receiverWith({
      verify: () => Promise.reject(failure),
    });

    expect(await rejectionOf(receiver.receive(RAW_BODY, SIGNATURE))).toBe(
      failure,
    );
  });

  test.each<{ readonly label: string; readonly failure: Error }>([
    {
      label: 'Stripeの一時的な失敗',
      failure: new StripeUnavailableError('Stripe unavailable'),
    },
    { label: '想定外の例外', failure: new Error('D1_ERROR: no such table') },
  ])(
    '反映の$labelは、通知の種類とIDを持ち元の例外を原因とする共通エラー以外の例外にする',
    async ({ failure }) => {
      const { receiver } = receiverWith({
        reflect: () => Promise.reject(failure),
      });

      const error = await rejectionOf(receiver.receive(RAW_BODY, SIGNATURE));

      expect(error).toBeInstanceOf(StripeWebhookReflectionError);
      expect(error).not.toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        name: 'StripeWebhookReflectionError',
        eventId: 'evt_test_receiver',
        eventType: 'checkout.session.completed',
        cause: failure,
      });
      expect((error as Error).message).not.toContain(RAW_BODY);
    },
  );
});
