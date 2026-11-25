import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  AUTHORIZED_ADMIN_ID,
  AUTHORIZED_NICKNAME,
  AUTHORIZED_SESSION_ID,
  authorizationContextOf,
  storedAdminOf,
} from '../../../test/support/admin-authorization-context.ts';
import { requireAdmin, requireSelfOrRole } from './admin-guard.ts';

const AUTHORIZATION_CATEGORY = 'api.admin.authorization';

const OTHER_ADMIN_ID = '01JC0ADMN00000000000000002';

const records: LogRecord[] = [];

function denialLogs(): readonly {
  readonly level: string;
  readonly properties: Record<string, unknown>;
}[] {
  return records
    .filter((record) => record.category.join('.') === AUTHORIZATION_CATEGORY)
    .map((record) => ({ level: record.level, properties: record.properties }));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否されなかった');
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await rejectionOf(promise);
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否されなかった', { cause: error });
  }
  return error.code;
}

function currentAdminOf(role: AdminRole) {
  return {
    id: AUTHORIZED_ADMIN_ID,
    role,
    nickname: AUTHORIZED_NICKNAME,
    sessionId: AUTHORIZED_SESSION_ID,
  };
}

beforeEach(() => {
  records.length = 0;
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
});

afterEach(() => {
  resetSync();
});

describe('requireAdmin', () => {
  test('最低限のロールを満たす管理者には、管理者のID・ロール・ニックネーム・セッションのIDを返し、ログを残さない', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('moderator'),
    });

    expect(await requireAdmin(context, 'moderator')).toEqual(
      currentAdminOf('moderator'),
    );
    expect(denialLogs()).toEqual([]);
  });

  test('最低限のロールに満たない管理者は禁止し、必要なロールを警告のログに残す', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('viewer'),
    });

    expect(await codeOf(requireAdmin(context, 'moderator'))).toBe('forbidden');
    expect(denialLogs()).toEqual([
      { level: 'warning', properties: { requiredRole: 'moderator' } },
    ]);
  });

  test('利用者側の呼び出し元は最上位管理者のセッションでも禁止し、ロールの不足ではないためログを残さない', async () => {
    const { context, reads } = authorizationContextOf({
      caller: 'client',
      admin: storedAdminOf('super_admin'),
    });

    expect(await codeOf(requireAdmin(context, 'viewer'))).toBe('forbidden');
    expect(reads).toEqual([]);
    expect(denialLogs()).toEqual([]);
  });

  test('管理者のセッションで認証されていなければ未認証にし、ログを残さない', async () => {
    const { context } = authorizationContextOf({
      principal: { kind: 'anonymous' },
      admin: storedAdminOf('super_admin'),
    });

    expect(await codeOf(requireAdmin(context, 'viewer'))).toBe(
      'unauthenticated',
    );
    expect(denialLogs()).toEqual([]);
  });

  test('判定のAppErrorでない例外は、そのまま投げてログを残さない', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('super_admin', { nickname: null }),
    });

    const error = await rejectionOf(requireAdmin(context, 'viewer'));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect(denialLogs()).toEqual([]);
  });
});

describe('requireSelfOrRole', () => {
  test('対象の所有者本人なら、最低限のロールに満たなくても許可する', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('viewer'),
    });

    expect(
      await requireSelfOrRole(context, AUTHORIZED_ADMIN_ID, 'super_admin'),
    ).toEqual(currentAdminOf('viewer'));
    expect(denialLogs()).toEqual([]);
  });

  test('本人でなくても最低限のロールを満たせば許可する', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('super_admin'),
    });

    expect(
      await requireSelfOrRole(context, OTHER_ADMIN_ID, 'super_admin'),
    ).toEqual(currentAdminOf('super_admin'));
  });

  test('本人でなく最低限のロールに満たなければ禁止し、必要なロールを警告のログに残す', async () => {
    const { context } = authorizationContextOf({
      admin: storedAdminOf('moderator'),
    });

    expect(
      await codeOf(requireSelfOrRole(context, OTHER_ADMIN_ID, 'super_admin')),
    ).toBe('forbidden');
    expect(denialLogs()).toEqual([
      { level: 'warning', properties: { requiredRole: 'super_admin' } },
    ]);
  });

  test('利用者側の呼び出し元は本人の対象でも禁止し、ログを残さない', async () => {
    const { context } = authorizationContextOf({
      caller: 'client',
      admin: storedAdminOf('viewer'),
    });

    expect(
      await codeOf(requireSelfOrRole(context, AUTHORIZED_ADMIN_ID, 'viewer')),
    ).toBe('forbidden');
    expect(denialLogs()).toEqual([]);
  });
});
