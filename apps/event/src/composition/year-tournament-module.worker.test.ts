import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { AccountEntryLossHandler as YearAccountEntryLossHandler } from '../application/year-tournament/account-entry-loss-handler.ts';
import { EntryUnlinkHandler as YearEntryUnlinkHandler } from '../application/year-tournament/entry-unlink-handler.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { ProductEntryLossHandler as YearProductEntryLossHandler } from '../application/year-tournament/product-entry-loss-handler.ts';
import { RoundProgressHandler as YearRoundProgressHandler } from '../application/year-tournament/round-progress-handler.ts';
import { WeekChampionEntryHandler } from '../application/year-tournament/week-champion-entry-handler.ts';
import { YearEntrySupplementProvider } from '../application/year-tournament/year-entry-supplement-provider.ts';
import { YearOpenEntryCheckoutExpiryHandler } from '../application/year-tournament/year-open-entry-checkout-expiry-handler.ts';
import { YearUltrasEntryExemptionHandler } from '../application/year-tournament/year-ultras-entry-exemption-handler.ts';
import { MODULES } from './modules.ts';
import { EVENT_YEAR_TOURNAMENT_MODULE } from './year-tournament-module.ts';

const IMPLEMENTATIONS = [
  ['WeekChampionEntryHandler', WeekChampionEntryHandler],
  ['RoundProgressHandler', YearRoundProgressHandler],
  ['ProductEntryLossHandler', YearProductEntryLossHandler],
  ['AccountEntryLossHandler', YearAccountEntryLossHandler],
  ['EntryUnlinkHandler', YearEntryUnlinkHandler],
  ['YearUltrasEntryExemptionHandler', YearUltrasEntryExemptionHandler],
  ['YearOpenEntryCheckoutExpiryHandler', YearOpenEntryCheckoutExpiryHandler],
  ['YearEntrySupplementProvider', YearEntrySupplementProvider],
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

describe('イベントサーバーのモジュールの一覧へのYearトーナメントの処理の登録', () => {
  test('eventのYearトーナメントのモジュールを、Year・Weekトーナメントとブラケットの共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(
      MODULES.filter((module) => module === EVENT_YEAR_TOURNAMENT_MODULE),
    ).toHaveLength(1);
    expect(EVENT_YEAR_TOURNAMENT_MODULE.name).toBe('event-year-tournament');
    for (const platform of [
      'year-tournament-platform',
      'week-tournament-platform',
      'tournament-platform',
    ]) {
      expect(names).toContain(platform);
      expect(MODULES.indexOf(EVENT_YEAR_TOURNAMENT_MODULE)).toBeGreaterThan(
        names.indexOf(platform),
      );
    }
  });

  test('解決を確かめる識別子はEVENT_YEAR_TOURNAMENT_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(EVENT_YEAR_TOURNAMENT_TYPES).toSorted(),
    );
  });

  test.each(IMPLEMENTATIONS)(
    'queue経路の処理単位のコンテナから%sを実装のクラスに解決する',
    (name, implementation) => {
      expect(
        createContainer().get(EVENT_YEAR_TOURNAMENT_TYPES[name]),
      ).toBeInstanceOf(implementation);
    },
  );
});
