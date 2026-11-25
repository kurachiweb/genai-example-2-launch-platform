import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { YEAR_TOURNAMENT_IMPLEMENTATIONS } from '../../lib/workers/year-tournament/testing/year-tournament-platform-implementations.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

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

describe('APIサーバーのモジュールの一覧へのYearトーナメントの登録', () => {
  test('Yearトーナメントの共通の束縛を1つだけ持ち、その部品が使う上流の共通の束縛も1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'year-tournament-platform',
      'week-tournament-platform',
      'tournament-platform',
      'match-platform',
      'payments-platform',
      'ultras-platform',
      'notifications-platform',
      'product-platform',
      'identity-platform',
      'email-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('解決を確かめる識別子はYEAR_TOURNAMENT_TYPESの全てである', () => {
    expect(
      YEAR_TOURNAMENT_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(YEAR_TOURNAMENT_TYPES).toSorted());
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのYearトーナメントの共通の束縛(%s)',
  (kind) => {
    test.each(YEAR_TOURNAMENT_IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(YEAR_TOURNAMENT_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);
