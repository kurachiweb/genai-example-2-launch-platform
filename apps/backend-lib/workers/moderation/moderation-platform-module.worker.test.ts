import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { MODERATION_PLATFORM_TYPES } from '../../core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../core/moderation/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1ModerationRecordStore } from './d1-moderation-record-store.ts';
import type { ModerationRecordStatements } from './moderation-record-statements.ts';
import { MODERATION_PLATFORM_MODULE } from './moderation-platform-module.ts';
import {
  clearModerationRecords,
  db,
  moderationIdOf,
  newRecordOf,
} from './testing/moderation-record-fixtures.ts';

const BOUND_IDENTIFIERS = Object.values(MODERATION_PLATFORM_TYPES);

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
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
    [MODERATION_PLATFORM_MODULE],
  );
}

beforeEach(clearModerationRecords);

describe('MODERATION_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      MODERATION_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(MODERATION_PLATFORM_MODULE.name).toBe('moderation-platform');
    expect('routes' in MODERATION_PLATFORM_MODULE).toBe(false);
  });

  test('記録のストアと記録の文をD1の実装に解決し、文で書いた記録をストアで引ける', async () => {
    const container = createContainer();
    const records = container.get<ModerationRecordStatements>(
      MODERATION_PLATFORM_TYPES.ModerationRecordStatements,
    );
    const store = container.get<ModerationRecordStore>(
      MODERATION_PLATFORM_TYPES.ModerationRecordStore,
    );
    const record = newRecordOf(1, { noticeStatus: 'pending' });

    await db.batch([records.insertStatement(record)]);

    expect(records).toBeInstanceOf(D1ModerationRecordStore);
    expect(store).toBeInstanceOf(D1ModerationRecordStore);
    await expect(store.find(moderationIdOf(1))).resolves.toEqual({
      ...record,
      noticeRequestedAt: null,
    });
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した2つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(BOUND_IDENTIFIERS).toHaveLength(2);
      for (const identifier of BOUND_IDENTIFIERS) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of BOUND_IDENTIFIERS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });
});
