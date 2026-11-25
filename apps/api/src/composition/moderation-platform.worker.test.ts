import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { MODERATION_PLATFORM_TYPES } from '../../lib/core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../lib/core/moderation/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ModerationRecordStore } from '../../lib/workers/moderation/d1-moderation-record-store.ts';
import type { ModerationRecordStatements } from '../../lib/workers/moderation/moderation-record-statements.ts';
import {
  clearModerationRecords,
  db,
  moderationIdOf,
  newRecordOf,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

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

beforeEach(clearModerationRecords);

describe.each(INVOCATION_KINDS)(
  'APIサーバーの措置の記録の共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから記録の文とストアをD1の実装に解決し、文で書いた記録をストアで引ける', async () => {
      const container = createContainer(kind);
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
  },
);
