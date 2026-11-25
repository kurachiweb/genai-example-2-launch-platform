import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { StoreArchiveDownloadService } from '../application/data-export/archive-download-service.ts';
import { StoreDataExportReader } from '../application/data-export/data-export-reader.ts';
import { StoreDataExportRequestService } from '../application/data-export/data-export-request-service.ts';
import { DATA_EXPORT_TYPES } from '../application/data-export/data-export-types.ts';
import {
  ARCHIVE_EXPIRY_JOB_DEFINITION,
  ArchiveExpiryJob,
} from '../application/data-export/jobs/archive-expiry-job.ts';
import {
  GENERATION_RECOVERY_JOB_DEFINITION,
  GenerationRecoveryJob,
} from '../application/data-export/jobs/generation-recovery-job.ts';
import { CounterDataExportRequestLimits } from '../infrastructure/data-export/counter-data-export-request-limits.ts';
import { DATA_EXPORT_MODULE } from './data-export-module.ts';
import { MODULES } from './modules.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['DataExportRequestLimits', CounterDataExportRequestLimits],
  ['DataExportRequestService', StoreDataExportRequestService],
  ['DataExportReader', StoreDataExportReader],
  ['ArchiveDownloadService', StoreArchiveDownloadService],
  ['ArchiveExpiryJob', ArchiveExpiryJob],
  ['GenerationRecoveryJob', GenerationRecoveryJob],
] as const;

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

describe('APIサーバーのモジュールの一覧へのデータエクスポートの束縛の登録', () => {
  test('apiのデータエクスポートのモジュールを、共通の束縛と本人確認の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(DATA_EXPORT_MODULE.name).toBe('api-data-export');
    expect(names.filter((name) => name === 'api-data-export')).toHaveLength(1);
    expect(MODULES.indexOf(DATA_EXPORT_MODULE)).toBeGreaterThan(
      names.indexOf('data-export-platform'),
    );
    expect(MODULES.indexOf(DATA_EXPORT_MODULE)).toBeGreaterThan(
      names.indexOf('identity-platform'),
    );
  });

  test('解決を確かめる識別子はDATA_EXPORT_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(DATA_EXPORT_TYPES).toSorted(),
    );
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーのデータエクスポートの束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(DATA_EXPORT_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);

describe('定期実行の一覧へのデータエクスポートのジョブの登録', () => {
  test('期限切れの削除と生成の受け皿のジョブの定義を、そのまま定期実行の一覧に1つずつ載せる', () => {
    expect(
      SCHEDULED_JOBS.filter(({ name }) => name.startsWith('data-export.')),
    ).toStrictEqual([
      ARCHIVE_EXPIRY_JOB_DEFINITION,
      GENERATION_RECOVERY_JOB_DEFINITION,
    ]);
    expect(ARCHIVE_EXPIRY_JOB_DEFINITION).toStrictEqual({
      name: 'data-export.archive-expiry',
      at: { hour: 4, minute: 21 },
      order: 2100,
      handler: DATA_EXPORT_TYPES.ArchiveExpiryJob,
    });
    expect(GENERATION_RECOVERY_JOB_DEFINITION).toStrictEqual({
      name: 'data-export.generation-recovery',
      at: { hour: 4, minute: 21 },
      order: 2110,
      handler: DATA_EXPORT_TYPES.GenerationRecoveryJob,
    });
  });

  test('定期実行の登録の検証を通り、4:21の起動(21 12 * * *)で他の機能のジョブとorderが重ならず、通報の保持期間の削除(2010)の後・キーワードの再抽出(2300)の前に2100・2110の順で動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor('21 12 * * *')
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'data-export.archive-expiry',
    );

    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 3)).toEqual([
      { name: 'content-reporting.report-retention', order: 2010 },
      { name: 'data-export.archive-expiry', order: 2100 },
      { name: 'data-export.generation-recovery', order: 2110 },
      { name: 'content-processing.keyword-reextraction', order: 2300 },
    ]);
  });
});
