import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { DefaultAdminSponsorshipsReader } from '../application/sponsorship/admin-sponsorships-reader.ts';
import { DefaultMySponsorshipsReader } from '../application/sponsorship/my-sponsorships-reader.ts';
import { DefaultSponsorshipApplication } from '../application/sponsorship/sponsorship-application.ts';
import { DefaultSponsorshipOfferReader } from '../application/sponsorship/sponsorship-offer-reader.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';
import { MODULES } from './modules.ts';
import { SPONSORSHIP_API_MODULE } from './sponsorship-module.ts';
import { YEAR_TOURNAMENT_API_MODULE } from './year-tournament-module.ts';

type SponsorshipTypeName = keyof typeof SPONSORSHIP_TYPES;

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['SponsorshipApplication', DefaultSponsorshipApplication],
  ['SponsorshipOfferReader', DefaultSponsorshipOfferReader],
  ['MySponsorshipsReader', DefaultMySponsorshipsReader],
  ['AdminSponsorshipsReader', DefaultAdminSponsorshipsReader],
] as const;

// 実装の無い部品の識別子。実装と束縛を加えたらIMPLEMENTATIONSへ移す
const UNBOUND: readonly SponsorshipTypeName[] = [
  'SponsorshipTermination',
  'SponsorshipTerminationWriter',
  'DailyNoticesJob',
  'MaintenanceJob',
  'AccountWithdrawalSyncHandler',
  'ProductDeletionSyncHandler',
  'AccountDisplayStopSyncHandler',
  'ProductDisplayStopSyncHandler',
];

function createContainer(kind: InvocationScopeInfo['kind']): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

describe('APIサーバーのモジュールの一覧へのスポンサー広告の束縛の登録', () => {
  test('apiのスポンサー広告のモジュールを、スポンサー広告の共通の束縛とapiのYearトーナメントのモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(SPONSORSHIP_API_MODULE.name).toBe('api-sponsorship');
    expect(names.filter((name) => name === 'api-sponsorship')).toHaveLength(1);
    expect(MODULES.indexOf(SPONSORSHIP_API_MODULE)).toBeGreaterThan(
      names.indexOf('sponsorship-platform'),
    );
    expect(MODULES.indexOf(SPONSORSHIP_API_MODULE)).toBeGreaterThan(
      MODULES.indexOf(YEAR_TOURNAMENT_API_MODULE),
    );
  });

  test('解決を確かめる識別子と束縛を待つ識別子を合わせるとSPONSORSHIP_TYPESの全てになる', () => {
    expect(
      [...IMPLEMENTATIONS.map(([name]) => name), ...UNBOUND].toSorted(),
    ).toEqual(Object.keys(SPONSORSHIP_TYPES).toSorted());
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのスポンサー広告の束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを実装のクラスに解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(SPONSORSHIP_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );

    test.each(UNBOUND)('%sはまだ束縛しない', (name) => {
      expect(createContainer(kind).isBound(SPONSORSHIP_TYPES[name])).toBe(
        false,
      );
    });
  },
);
