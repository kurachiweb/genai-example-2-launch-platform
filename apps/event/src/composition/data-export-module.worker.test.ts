import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { EVENT_DATA_EXPORT_TYPES } from '../application/data-export/event-data-export-types.ts';
import { AccountSourceReader } from '../application/data-export/sources/account-source-reader.ts';
import { ExportFileResolver } from '../application/data-export/export-file-resolver.ts';
import { ExportSnapshotCollector } from '../application/data-export/export-snapshot-collector.ts';
import { CorrespondenceSourceReader } from '../application/data-export/sources/correspondence-source-reader.ts';
import { ProductActivitySourceReader } from '../application/data-export/sources/product-activity-source-reader.ts';
import { EVENT_DATA_EXPORT_MODULE } from './data-export-module.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

const IMPLEMENTATIONS = [
  ['AccountSourceReader', AccountSourceReader],
  ['ProductActivitySourceReader', ProductActivitySourceReader],
  ['CorrespondenceSourceReader', CorrespondenceSourceReader],
  ['ExportFileResolver', ExportFileResolver],
  ['ExportSnapshotCollector', ExportSnapshotCollector],
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

describe('イベントサーバーのモジュールの一覧へのデータエクスポートのモジュールの登録', () => {
  test('eventのデータエクスポートのモジュールを、共通の束縛と上流の共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(EVENT_DATA_EXPORT_MODULE.name).toBe('event-data-export');
    expect(names.filter((name) => name === 'event-data-export')).toHaveLength(
      1,
    );
    for (const platform of [
      'data-export-platform',
      'identity-platform',
      'profile-platform',
    ]) {
      expect(names).toContain(platform);
      expect(MODULES.indexOf(EVENT_DATA_EXPORT_MODULE)).toBeGreaterThan(
        names.indexOf(platform),
      );
    }
  });

  test('解決を確かめる識別子は、EVENT_DATA_EXPORT_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(EVENT_DATA_EXPORT_TYPES).toSorted(),
    );
  });

  test.each(
    INVOCATION_KINDS.flatMap((kind) =>
      IMPLEMENTATIONS.map(
        ([name, implementation]) => [kind, name, implementation] as const,
      ),
    ),
  )(
    '%s経路の処理単位のコンテナから%sを実装のクラスに解決する',
    (kind, name, implementation) => {
      expect(
        createContainer(kind).get(EVENT_DATA_EXPORT_TYPES[name]),
      ).toBeInstanceOf(implementation);
    },
  );
});
