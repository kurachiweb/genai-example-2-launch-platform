import { describe, expect, expectTypeOf, test } from 'bun:test';

import type {
  PaymentsEnv,
  PurchaseOfferRegistration,
} from './purchase-kind-contract.ts';
import {
  assertSubscriptionEventSinkNames,
  createPurchaseKindRegistry,
  PurchaseKindRegistrationError,
} from './purchase-kind-registry.ts';

const SMOKE_DISABLED_ENV: PaymentsEnv = {
  STRIPE_API_KEY: undefined,
  PAYMENTS_SMOKE_ENABLED: 'false',
  CLIENT_SITE_ORIGIN: 'https://launch-stadium.example',
};

const SMOKE_ENABLED_ENV: PaymentsEnv = {
  ...SMOKE_DISABLED_ENV,
  PAYMENTS_SMOKE_ENABLED: 'true',
};

const offerOf = (name: string): symbol => Symbol.for(`test.${name}.offer`);

const registrationOf = (
  kind: PurchaseOfferRegistration['kind'],
  enabled?: PurchaseOfferRegistration['enabled'],
): PurchaseOfferRegistration =>
  enabled === undefined
    ? { kind, offer: offerOf(kind) }
    : { kind, offer: offerOf(kind), enabled };

// workers/paymentsのPurchaseKindRegistrationと同じく、可否と内容の側にfulfillmentの識別子を加えた登録
interface RegistrationWithFulfillment extends PurchaseOfferRegistration {
  readonly fulfillment: symbol;
}

describe('createPurchaseKindRegistry', () => {
  test('同じ購入種別を2回登録すると例外になる', () => {
    expect(() =>
      createPurchaseKindRegistry([
        registrationOf('sponsorship'),
        registrationOf('ultras'),
        registrationOf('sponsorship'),
      ]),
    ).toThrow(PurchaseKindRegistrationError);
  });

  test('重複の例外は購入種別の名前を示す', () => {
    expect(() =>
      createPurchaseKindRegistry([
        registrationOf('ultras'),
        registrationOf('ultras'),
      ]),
    ).toThrow('"ultras"');
  });

  test('enabledを持たない登録は常に解決される', () => {
    const registration = registrationOf('week_tournament_entry');
    const registry = createPurchaseKindRegistry([registration]);

    expect(registry.resolve('week_tournament_entry', SMOKE_DISABLED_ENV)).toBe(
      registration,
    );
  });

  test('未登録の購入種別は解決されない', () => {
    const registry = createPurchaseKindRegistry([registrationOf('ultras')]);

    expect(
      registry.resolve('year_tournament_entry', SMOKE_ENABLED_ENV),
    ).toBeUndefined();
  });

  test('enabledが偽を返す登録は解決されない', () => {
    const registry = createPurchaseKindRegistry([
      registrationOf('sponsorship', () => false),
    ]);

    expect(registry.resolve('sponsorship', SMOKE_ENABLED_ENV)).toBeUndefined();
  });

  test('PAYMENTS_SMOKE_ENABLEDを見る登録は、falseの環境では解決されず、trueの環境では解決される', () => {
    const registration = registrationOf(
      'payments_smoke',
      (env) => env.PAYMENTS_SMOKE_ENABLED === 'true',
    );
    const registry = createPurchaseKindRegistry([registration]);

    expect(
      registry.resolve('payments_smoke', SMOKE_DISABLED_ENV),
    ).toBeUndefined();
    expect(registry.resolve('payments_smoke', SMOKE_ENABLED_ENV)).toBe(
      registration,
    );
  });

  test('enabledには解決の時に渡した環境が渡される', () => {
    const seen: PaymentsEnv[] = [];
    const registry = createPurchaseKindRegistry([
      registrationOf('sponsorship', (env) => {
        seen.push(env);
        return true;
      }),
    ]);

    registry.resolve('sponsorship', SMOKE_ENABLED_ENV);

    expect(seen).toEqual([SMOKE_ENABLED_ENV]);
  });

  test('fulfillmentを持つ登録を渡すと、同じ値がその型のまま解決される', () => {
    const registration: RegistrationWithFulfillment = {
      ...registrationOf('ultras'),
      fulfillment: Symbol.for('test.ultras.fulfillment'),
    };
    const registry = createPurchaseKindRegistry([registration]);

    const resolved = registry.resolve('ultras', SMOKE_DISABLED_ENV);

    expect(resolved).toBe(registration);
    expect(resolved?.fulfillment).toBe(Symbol.for('test.ultras.fulfillment'));
    expectTypeOf(resolved).toEqualTypeOf<
      RegistrationWithFulfillment | undefined
    >();
  });

  test('可否と内容の側として受け取るとfulfillmentは型に現れない', () => {
    const registry = createPurchaseKindRegistry<PurchaseOfferRegistration>([
      registrationOf('ultras'),
    ]);

    expectTypeOf(registry.resolve('ultras', SMOKE_DISABLED_ENV)).toEqualTypeOf<
      PurchaseOfferRegistration | undefined
    >();
  });

  test('登録の一覧を後から変えても解決の結果は変わらない', () => {
    const registrations = [registrationOf('sponsorship')];
    const registry = createPurchaseKindRegistry(registrations);

    registrations.pop();

    expect(
      registry.resolve('sponsorship', SMOKE_DISABLED_ENV),
    ).not.toBeUndefined();
  });

  test('登録の解決は実行時に書き換えられない', () => {
    const registry = createPurchaseKindRegistry([]);

    expect(Object.isFrozen(registry)).toBe(true);
  });
});

describe('assertSubscriptionEventSinkNames', () => {
  test.each([
    'ultras-subscription.plan-state',
    'ultras-subscription.renewal-notice',
    'a.b',
    'spec2.noun3-phrase',
  ])('%sは<spec名>.<名詞句>の形として受け付ける', (name) => {
    expect(() => {
      assertSubscriptionEventSinkNames([{ name }]);
    }).not.toThrow();
  });

  test.each([
    '',
    'ultras-subscription',
    'ultras-subscription.',
    '.plan-state',
    'Ultras-subscription.plan-state',
    'ultras_subscription.plan-state',
    'ultras-subscription.plan--state',
    'ultras-subscription.plan-state-',
    'ultras-subscription.plan.state',
    '1ultras.plan-state',
    'ultras-subscription.plan state',
  ])('%sは形式の違反として例外になる', (name) => {
    expect(() => {
      assertSubscriptionEventSinkNames([{ name }]);
    }).toThrow(PurchaseKindRegistrationError);
  });

  test('同じ名前の受け取り口が2つあると例外になる', () => {
    expect(() => {
      assertSubscriptionEventSinkNames([
        { name: 'ultras-subscription.plan-state' },
        { name: 'ultras-subscription.renewal-notice' },
        { name: 'ultras-subscription.plan-state' },
      ]);
    }).toThrow('"ultras-subscription.plan-state"');
  });

  test('登録が無ければ何もしない', () => {
    expect(() => {
      assertSubscriptionEventSinkNames([]);
    }).not.toThrow();
  });

  test('例外はErrorであり、名前で区別できる', () => {
    const error = new PurchaseKindRegistrationError('message');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PurchaseKindRegistrationError');
  });
});
