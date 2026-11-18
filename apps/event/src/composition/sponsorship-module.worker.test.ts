import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { SPONSORSHIP_DISPATCH_NOTICES_MESSAGE } from '../../lib/core/messaging/contracts/sponsorship.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { AccountPurgeHandler } from '../application/sponsorship/account-purge-handler.ts';
import { EVENT_SPONSORSHIP_TYPES } from '../application/sponsorship/event-sponsorship-types.ts';
import { NoticeDispatchHandler } from '../application/sponsorship/notice-dispatch-handler.ts';
import { ProductPurgeHandler } from '../application/sponsorship/product-purge-handler.ts';
import { D1NoticeClaimStore } from '../infrastructure/sponsorship/d1-notice-claim-store.ts';
import { D1SponsorshipPurgeStore } from '../infrastructure/sponsorship/d1-sponsorship-purge-store.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';
import { EVENT_SPONSORSHIP_MODULE } from './sponsorship-module.ts';
import { EVENT_YEAR_TOURNAMENT_MODULE } from './year-tournament-module.ts';

const IMPLEMENTATIONS = [
  ['NoticeDispatchHandler', NoticeDispatchHandler],
  ['NoticeClaimStore', D1NoticeClaimStore],
  ['AccountPurgeHandler', AccountPurgeHandler],
  ['ProductPurgeHandler', ProductPurgeHandler],
  ['SponsorshipPurgeStore', D1SponsorshipPurgeStore],
] as const;

// 掲載の終わりの精算(6.3)の部品は、束縛を足すときにIMPLEMENTATIONSへ移す
const UNBOUND = [
  'PeriodEndSettlementHandler',
  'PeriodEndSettlementCommitter',
] as const;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧へのスポンサー広告の束縛の登録', () => {
  test('eventのスポンサー広告のモジュールを、共通の束縛と前提の束縛とeventのYearトーナメントのモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(EVENT_SPONSORSHIP_MODULE.name).toBe('event-sponsorship');
    expect(names.filter((name) => name === 'event-sponsorship')).toHaveLength(
      1,
    );
    for (const platform of [
      'sponsorship-platform',
      'identity-platform',
      'product-platform',
      'email-platform',
    ]) {
      expect(names).toContain(platform);
      expect(MODULES.indexOf(EVENT_SPONSORSHIP_MODULE)).toBeGreaterThan(
        names.indexOf(platform),
      );
    }
    expect(MODULES.indexOf(EVENT_SPONSORSHIP_MODULE)).toBeGreaterThan(
      MODULES.indexOf(EVENT_YEAR_TOURNAMENT_MODULE),
    );
  });

  test('解決を確かめる識別子と未束縛の識別子を合わせると、EVENT_SPONSORSHIP_TYPESの全てである', () => {
    expect(
      [...IMPLEMENTATIONS.map(([name]) => name), ...UNBOUND].toSorted(),
    ).toEqual(Object.keys(EVENT_SPONSORSHIP_TYPES).toSorted());
  });

  test.each(IMPLEMENTATIONS)(
    'queue経路の処理単位のコンテナから%sを実装のクラスに解決する',
    (name, implementation) => {
      expect(
        createContainer().get(EVENT_SPONSORSHIP_TYPES[name]),
      ).toBeInstanceOf(implementation);
    },
  );
});

describe('スポンサー広告のメッセージの処理の登録', () => {
  test('sponsorship.dispatch-noticesを通知の送信の処理へ、既定の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) =>
          contract.type === SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
        handler: EVENT_SPONSORSHIP_TYPES.NoticeDispatchHandler,
      },
    ]);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});
