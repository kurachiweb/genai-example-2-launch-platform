import { describe, expect, test } from 'bun:test';
import type { GraphQLResolveInfo } from 'graphql';

import type { CurrentAdmin } from '../../../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import type { CallerKind } from '../../../gateway/gateway-headers.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { USER_MODERATION_ARGS } from './inputs.ts';
import {
  adminOnly,
  moderationOperatorOf,
  toModerationConnection,
} from './resolver-support.ts';

const INFO = {} as GraphQLResolveInfo;

const ADMIN: CurrentAdmin = {
  id: '01JC0000000000000000000009',
  role: 'moderator',
  nickname: 'モデレーター',
  sessionId: '01JC000000000000000000000S',
};

interface AuthorizationCall {
  readonly caller: CallerKind;
  readonly minimum: string;
}

function contextOf(caller: CallerKind, calls: AuthorizationCall[] = []) {
  return {
    caller,
    session: {},
    resolve: (identifier: symbol) => {
      if (identifier !== ADMIN_TYPES.AdminAuthorizer) {
        throw new Error('想定外の識別子です');
      }
      return {
        requireAdmin: (
          _session: unknown,
          requestCaller: CallerKind,
          minimum: string,
        ) => {
          calls.push({ caller: requestCaller, minimum });
          return Promise.resolve(ADMIN);
        },
      };
    },
  } as unknown as GraphQLContext;
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

describe('adminOnly', () => {
  test('利用者側の呼び出しを、入力の検証とロールの確認とリゾルバより前にforbiddenで拒否する', async () => {
    const calls: AuthorizationCall[] = [];
    let resolved = false;
    const resolver = adminOnly(
      withValidatedArgs(
        USER_MODERATION_ARGS,
        async (_parent, _args, context) => {
          await moderationOperatorOf(context, 'moderator');
          resolved = true;
          return true;
        },
      ),
    );

    const error: unknown = await resolver(
      {},
      { id: 'invalid', reason: 'x'.repeat(600) },
      contextOf('client', calls),
      INFO,
    ).catch((reason: unknown) => reason);

    expect(codeOf(error)).toBe('forbidden');
    expect(calls).toEqual([]);
    expect(resolved).toBe(false);
  });

  test('管理者側の呼び出しは、入力の検証を経てリゾルバへ渡す', async () => {
    const resolver = adminOnly(
      withValidatedArgs(USER_MODERATION_ARGS, (_parent, args) =>
        Promise.resolve(args.id),
      ),
    );

    expect(
      await resolver(
        {},
        { id: ADMIN.id, reason: '理由' },
        contextOf('admin'),
        INFO,
      ),
    ).toBe(ADMIN.id);
    const invalid: unknown = await resolver(
      {},
      { id: 'invalid', reason: '理由' },
      contextOf('admin'),
      INFO,
    ).catch((reason: unknown) => reason);
    expect(codeOf(invalid)).toBe('validation_error');
  });
});

describe('moderationOperatorOf', () => {
  test('呼び出し元と必要なロールで管理者を確かめ、操作者のIDを返す', async () => {
    const calls: AuthorizationCall[] = [];

    expect(
      await moderationOperatorOf(contextOf('admin', calls), 'moderator'),
    ).toEqual({ adminId: ADMIN.id });
    expect(calls).toEqual([{ caller: 'admin', minimum: 'moderator' }]);
  });
});

describe('toModerationConnection', () => {
  test('上流の続きの位置から、次のページの有無と最後の位置を組み立てて項目を写す', () => {
    expect(
      toModerationConnection([1, 2], 'next-cursor', (value) => value * 10),
    ).toEqual({
      nodes: [10, 20],
      pageInfo: { hasNextPage: true, endCursor: 'next-cursor' },
    });
  });

  test.each([null, undefined])(
    '続きの位置が無い(%p)なら次のページは無く、最後の位置はnullにする',
    (nextCursor) => {
      expect(
        toModerationConnection(['a'], nextCursor, (value) => value),
      ).toEqual({
        nodes: ['a'],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
      expect(
        toModerationConnection([], nextCursor, (value: string) => value),
      ).toEqual({
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    },
  );
});
