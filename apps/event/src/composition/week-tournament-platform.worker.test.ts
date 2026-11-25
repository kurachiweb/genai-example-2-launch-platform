import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../lib/core/week-tournament/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { WEEK_TOURNAMENT_IMPLEMENTATIONS } from '../../lib/workers/week-tournament/testing/week-tournament-platform-implementations.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

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

describe('イベントサーバーのモジュールの一覧へのWeekトーナメントの登録', () => {
  test('Weekトーナメントの共通の束縛を1つだけ持ち、その部品が使う上流の共通の束縛も1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
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

  test('解決を確かめる識別子はWEEK_TOURNAMENT_TYPESの全てである', () => {
    expect(
      WEEK_TOURNAMENT_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(WEEK_TOURNAMENT_TYPES).toSorted());
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのWeekトーナメントの共通の束縛(%s)',
  (kind) => {
    test.each(WEEK_TOURNAMENT_IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(WEEK_TOURNAMENT_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);
