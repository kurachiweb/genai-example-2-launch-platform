import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { ULTRAS_TYPES } from '../../lib/core/ultras/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { QueueActivationDispatcher } from '../../lib/workers/ultras/activation-dispatcher.ts';
import { D1ActivationStore } from '../../lib/workers/ultras/d1-activation-store.ts';
import { D1NoticeStore } from '../../lib/workers/ultras/d1-notice-store.ts';
import { D1PromotionFlagReader } from '../../lib/workers/ultras/d1-promotion-flag-reader.ts';
import { D1SubscriptionStore } from '../../lib/workers/ultras/d1-subscription-store.ts';
import { PlanStateSink } from '../../lib/workers/ultras/plan-state-sink.ts';
import { StoredUltrasEntitlements } from '../../lib/workers/ultras/ultras-entitlements.ts';
import { UltrasFulfillment } from '../../lib/workers/ultras/ultras-fulfillment.ts';
import { EmailUltrasNotifier } from '../../lib/workers/ultras/ultras-notifier.ts';
import { UltrasOfferPolicy } from '../../lib/workers/ultras/ultras-offer-policy.ts';
import { StoredUltrasPlanExport } from '../../lib/workers/ultras/ultras-plan-export.ts';
import { MODULES } from './modules.ts';

const IMPLEMENTATIONS = [
  ['SubscriptionStore', D1SubscriptionStore],
  ['SubscriptionStatements', D1SubscriptionStore],
  ['ActivationStore', D1ActivationStore],
  ['ActivationStatements', D1ActivationStore],
  ['NoticeStore', D1NoticeStore],
  ['NoticeStatements', D1NoticeStore],
  ['UltrasPromotionFlagReader', D1PromotionFlagReader],
  ['UltrasEntitlements', StoredUltrasEntitlements],
  ['UltrasPlanExport', StoredUltrasPlanExport],
  ['ActivationDispatcher', QueueActivationDispatcher],
  ['UltrasNotifier', EmailUltrasNotifier],
  ['UltrasOfferPolicy', UltrasOfferPolicy],
  ['UltrasFulfillment', UltrasFulfillment],
  ['PlanStateSink', PlanStateSink],
] as const;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-api-ultras-module',
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

describe('APIサーバーのモジュールの一覧へのUltrasの登録', () => {
  test('Ultrasの共通の束縛と、それが使う決済・メール・利用者の共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'ultras-platform',
      'payments-platform',
      'email-platform',
      'identity-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('解決を確かめる識別子はULTRAS_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(ULTRAS_TYPES).toSorted(),
    );
  });

  test.each(IMPLEMENTATIONS)(
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      expect(createContainer().get(ULTRAS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test.each([
    ['SubscriptionStore', 'SubscriptionStatements'],
    ['ActivationStore', 'ActivationStatements'],
    ['NoticeStore', 'NoticeStatements'],
  ] as const)(
    '%sと%sは同じインスタンスに解決される',
    (operations, statements) => {
      const container = createContainer();

      expect(container.get(ULTRAS_TYPES[statements])).toBe(
        container.get(ULTRAS_TYPES[operations]),
      );
    },
  );
});
