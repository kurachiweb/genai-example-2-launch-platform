import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { SPONSORSHIP_IMPLEMENTATIONS } from '../../lib/workers/sponsorship/testing/sponsorship-platform-implementations.ts';
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

describe('APIサーバーのモジュールの一覧へのスポンサー広告の登録', () => {
  test('スポンサー広告の共通の束縛を1つだけ持ち、その部品が使う上流の共通の束縛も1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'sponsorship-platform',
      'payments-platform',
      'product-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('解決を確かめる識別子はSPONSORSHIP_PLATFORM_TYPESの全てである', () => {
    expect(
      SPONSORSHIP_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(SPONSORSHIP_PLATFORM_TYPES).toSorted());
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのスポンサー広告の共通の束縛(%s)',
  (kind) => {
    test.each(SPONSORSHIP_IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(SPONSORSHIP_PLATFORM_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);
