import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { MODERATION_PLATFORM_TYPES } from '../../lib/core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../lib/core/moderation/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ModerationRecordStore } from '../../lib/workers/moderation/d1-moderation-record-store.ts';
import {
  clearModerationRecords,
  db,
  moderatedUserIdOf,
  newRecordOf,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
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

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(clearModerationRecords);

describe.each(INVOCATION_KINDS)(
  'イベントサーバーの措置の記録の共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから記録のストアをD1の実装に解決し、利用者に関わる記録を消せる', async () => {
      const subject = moderatedUserIdOf(1);
      const store = createContainer(kind).get<ModerationRecordStore>(
        MODERATION_PLATFORM_TYPES.ModerationRecordStore,
      );
      await db.batch([
        new D1ModerationRecordStore(db).insertStatement(newRecordOf(1)),
      ]);

      expect(store).toBeInstanceOf(D1ModerationRecordStore);
      await expect(store.eraseBySubjectUser(subject, 500)).resolves.toEqual({
        remaining: false,
      });
      await expect(
        store.latestFor({ targetIds: [subject], actions: ['user.suspend'] }),
      ).resolves.toEqual(new Map());
    });
  },
);
