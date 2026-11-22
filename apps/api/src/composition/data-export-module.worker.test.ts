import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { StoreArchiveDownloadService } from '../application/data-export/archive-download-service.ts';
import { StoreDataExportReader } from '../application/data-export/data-export-reader.ts';
import { StoreDataExportRequestService } from '../application/data-export/data-export-request-service.ts';
import { DATA_EXPORT_TYPES } from '../application/data-export/data-export-types.ts';
import { CounterDataExportRequestLimits } from '../infrastructure/data-export/counter-data-export-request-limits.ts';
import { DATA_EXPORT_MODULE } from './data-export-module.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['DataExportRequestLimits', CounterDataExportRequestLimits],
  ['DataExportRequestService', StoreDataExportRequestService],
  ['DataExportReader', StoreDataExportReader],
  ['ArchiveDownloadService', StoreArchiveDownloadService],
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
