import { describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import type { GraphQLResolveInfo } from 'graphql';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import type { Principal } from '../../../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import {
  ADMIN_PRINCIPAL,
  AUTHORIZED_ADMIN_ID,
  authorizationContextOf,
  storedAdminOf,
} from '../../../../../test/support/admin-authorization-context.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import {
  adminOnly,
  clockOf,
  moderationOperatorOf,
  toModerationConnection,
} from './resolver-support.ts';

const INFO = {} as GraphQLResolveInfo;

const AUTHORIZATION_LOG_CATEGORY = 'api.admin.authorization';

// 照会は閲覧のみ以上、措置はモデレーター以上、代理の退会は最上位管理者だけに許す
const ROLE_MATRIX: readonly (readonly [AdminRole, AdminRole, boolean])[] = [
  ['viewer', 'viewer', true],
  ['viewer', 'moderator', false],
  ['viewer', 'super_admin', false],
  ['moderator', 'viewer', true],
  ['moderator', 'moderator', true],
  ['moderator', 'super_admin', false],
  ['super_admin', 'viewer', true],
  ['super_admin', 'moderator', true],
  ['super_admin', 'super_admin', true],
];

const MINIMUM_ROLES: readonly AdminRole[] = [
  'viewer',
  'moderator',
  'super_admin',
];

const NOT_ADMIN_PRINCIPALS: readonly (readonly [string, Principal])[] = [
  ['未ログイン', { kind: 'anonymous' }],
  [
    '利用者のセッション',
    {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: AUTHORIZED_ADMIN_ID,
      sessionId: '01JC0SESN00000000000000002',
    },
  ],
];

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

describe('moderationOperatorOf', () => {
  test.each(ROLE_MATRIX)(
    '保存済みのロールが%sの管理者に最低限のロール%sを求めると、許可=%s',
    async (role, minimum, allowed) => {
      const { context } = authorizationContextOf({
        admin: storedAdminOf(role),
      });

      const result = moderationOperatorOf(context, minimum);

      if (allowed) {
        expect(await result).toEqual({ adminId: AUTHORIZED_ADMIN_ID });
      } else {
        expect(await codeOf(result)).toBe('forbidden');
      }
    },
  );

  test('ロールの不足による拒否は、認可の入口を経て必要なロールを警告のログに1件残す', async () => {
    const records: LogRecord[] = [];
    configureSync({
      reset: true,
      sinks: {
        capture: (record) => {
          records.push(record);
        },
      },
      loggers: [
        { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
        { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
      ],
    });
    try {
      const { context } = authorizationContextOf({
        admin: storedAdminOf('moderator'),
      });

      expect(await codeOf(moderationOperatorOf(context, 'super_admin'))).toBe(
        'forbidden',
      );
      expect(
        records
          .filter(
            (record) =>
              record.category.join('.') === AUTHORIZATION_LOG_CATEGORY,
          )
          .map((record) => ({
            level: record.level,
            properties: record.properties,
          })),
      ).toEqual([
        { level: 'warning', properties: { requiredRole: 'super_admin' } },
      ]);
    } finally {
      resetSync();
    }
  });

  test.each(MINIMUM_ROLES)(
    '利用者側の呼び出し元なら、最上位管理者のセッションでも最低限のロール%sの操作を管理者を読まずに禁止する',
    async (minimum) => {
      const { context, reads } = authorizationContextOf({
        caller: 'client',
        admin: storedAdminOf('super_admin'),
      });

      expect(await codeOf(moderationOperatorOf(context, minimum))).toBe(
        'forbidden',
      );
      expect(reads).toEqual([]);
    },
  );

  test.each(NOT_ADMIN_PRINCIPALS)(
    '%sなら、閲覧のみを求める照会でも管理者を読まずに未認証にする',
    async (_label, principal) => {
      const { context, reads } = authorizationContextOf({
        principal,
        admin: storedAdminOf('super_admin'),
      });

      expect(await codeOf(moderationOperatorOf(context, 'viewer'))).toBe(
        'unauthenticated',
      );
      expect(reads).toEqual([]);
    },
  );

  test('管理者のセッションでも保存済みの管理者が有効でなければ未認証にする', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('super_admin', {
        status: 'invited',
        nickname: null,
      }),
    });

    expect(await codeOf(moderationOperatorOf(context, 'viewer'))).toBe(
      'unauthenticated',
    );
  });
});

describe('adminOnly', () => {
  test('利用者側の呼び出しは、ロールの確認とリゾルバより前にforbiddenで拒否する', async () => {
    const { context, reads } = authorizationContextOf({
      caller: 'client',
      admin: storedAdminOf('super_admin'),
    });
    let called = false;
    const resolver = adminOnly(async (_parent, _args, ctx: GraphQLContext) => {
      called = true;
      return moderationOperatorOf(ctx, 'viewer');
    });

    expect(await codeOf(resolver({}, {}, context, INFO))).toBe('forbidden');
    expect(called).toBe(false);
    expect(reads).toEqual([]);
  });

  test('管理者側の呼び出しは、親・引数・文脈・情報をそのままリゾルバへ渡して結果を返す', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('viewer'),
    });
    const parent = { kind: 'parent' };
    const args = { id: AUTHORIZED_ADMIN_ID };
    const resolver = adminOnly(
      (
        receivedParent: unknown,
        receivedArgs: unknown,
        receivedContext: GraphQLContext,
        receivedInfo: GraphQLResolveInfo,
      ) =>
        Promise.resolve([
          receivedParent,
          receivedArgs,
          receivedContext,
          receivedInfo,
        ]),
    );

    expect(await resolver(parent, args, context, INFO)).toEqual([
      parent,
      args,
      context,
      INFO,
    ]);
  });

  test.each(ROLE_MATRIX)(
    '管理者側の呼び出しでも、保存済みのロールが%sの管理者に最低限のロール%sを求めるリゾルバは、許可=%s',
    async (role, minimum, allowed) => {
      const { context } = authorizationContextOf({
        admin: storedAdminOf(role),
      });
      const resolver = adminOnly(async (_parent, _args, ctx: GraphQLContext) =>
        moderationOperatorOf(ctx, minimum),
      );

      const result = resolver({}, {}, context, INFO);

      if (allowed) {
        expect(await result).toEqual({ adminId: AUTHORIZED_ADMIN_ID });
      } else {
        expect(await codeOf(result)).toBe('forbidden');
      }
    },
  );

  test('管理者側の呼び出しでも管理者のセッションが無ければ、リゾルバの中のロールの確認で未認証にする', async () => {
    const { context } = authorizationContextOf({
      principal: { kind: 'anonymous' },
      admin: storedAdminOf('super_admin'),
    });
    const resolver = adminOnly(async (_parent, _args, ctx: GraphQLContext) =>
      moderationOperatorOf(ctx, 'viewer'),
    );

    expect(await codeOf(resolver({}, {}, context, INFO))).toBe(
      'unauthenticated',
    );
  });
});

describe('clockOf', () => {
  test('処理単位のコンテナに束縛した時計を返す', () => {
    const { context, container } = authorizationContextOf({
      principal: ADMIN_PRINCIPAL,
      admin: undefined,
    });
    const clock: Clock = { now: () => new Date('2026-11-20T00:00:00.000Z') };
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);

    expect(clockOf(context)).toBe(clock);
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
    },
  );
});
