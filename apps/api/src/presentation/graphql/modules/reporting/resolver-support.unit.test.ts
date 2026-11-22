import { describe, expect, test } from 'bun:test';

import type { GraphQLResolveInfo } from 'graphql';

import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { CallerKind } from '../../../gateway/gateway-headers.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import {
  accountGuardOf,
  adminOnly,
  clientOnly,
  clockOf,
} from './resolver-support.ts';

const INFO = {} as GraphQLResolveInfo;

const ACCOUNT_GUARD = {} as AccountGuard;

const CLOCK: Clock = { now: () => new Date('2026-11-22T00:00:00.000Z') };

function contextOf(caller: CallerKind): GraphQLContext {
  return {
    caller,
    resolve: (identifier: symbol): unknown => {
      if (identifier === IDENTITY_PLATFORM_TYPES.AccountGuard) {
        return ACCOUNT_GUARD;
      }
      if (identifier === PLATFORM_TYPES.Clock) {
        return CLOCK;
      }
      throw new Error(`束縛の無い識別子です: ${String(identifier)}`);
    },
  } as unknown as GraphQLContext;
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

const CALLERS: readonly CallerKind[] = ['client', 'admin'];

describe.each([
  ['clientOnly', clientOnly, 'client'],
  ['adminOnly', adminOnly, 'admin'],
] as const)('%s', (_name, guard, allowed) => {
  test.each(CALLERS.filter((caller) => caller !== allowed))(
    '呼び出し元が%sなら、包んだリゾルバ(入力の検証を含む)を呼ばずにforbiddenで拒否する',
    async (caller) => {
      let called = false;
      const resolver = guard(() => {
        called = true;
        return Promise.resolve('resolved');
      });

      const error = await rejectionOf(
        resolver({}, {}, contextOf(caller), INFO),
      );

      expect({ kind: error.kind, code: error.code }).toEqual({
        kind: 'forbidden',
        code: 'forbidden',
      });
      expect(called).toBe(false);
    },
  );

  test(`呼び出し元が${allowed}なら、包んだリゾルバに引数と文脈をそのまま渡して結果を返す`, async () => {
    const context = contextOf(allowed);
    const args = { id: '01JE0CASE00000000000000001' };

    const result = await guard((parent, received, receivedContext) =>
      Promise.resolve({ parent, received, receivedContext }),
    )({ parent: true }, args, context, INFO);

    expect(result).toEqual({
      parent: { parent: true },
      received: args,
      receivedContext: context,
    });
  });
});

describe('文脈からの部品の取得', () => {
  test('accountGuardOfは処理単位のコンテナの利用者の状態の判定を返す', () => {
    expect(accountGuardOf(contextOf('client'))).toBe(ACCOUNT_GUARD);
  });

  test('clockOfは処理単位のコンテナの時計を返す', () => {
    expect(clockOf(contextOf('admin'))).toBe(CLOCK);
  });
});
