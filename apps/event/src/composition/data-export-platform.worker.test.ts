import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterEach, describe, expect, test } from 'vitest';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../lib/core/data-export/identifiers.ts';
import type { DataExportIncidentReporter } from '../../lib/core/data-export/ports.ts';
import type { InvocationScopeInfo } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { DATA_EXPORT_IMPLEMENTATIONS } from '../../lib/workers/data-export/testing/data-export-platform-implementations.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../../lib/workers/tournament/testing/observability-fixtures.ts';
import { MODULES } from './modules.ts';

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

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

afterEach(() => {
  resetObservability();
});

describe('イベントサーバーのモジュールの一覧へのデータエクスポートの登録', () => {
  test('データエクスポートの共通の束縛を1つだけ持ち、その部品が使う上流の共通の束縛も1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'data-export-platform',
      'identity-platform',
      'email-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('解決を確かめる識別子はDATA_EXPORT_PLATFORM_TYPESの全てである', () => {
    expect(
      DATA_EXPORT_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(DATA_EXPORT_PLATFORM_TYPES).toSorted());
  });

  test('エラートラッキングへの送信のログは、eventのカテゴリに出る', () => {
    const logs = recordLogs('event');
    installRecordingSentry();

    createContainer('fetch')
      .get<DataExportIncidentReporter>(
        DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter,
      )
      .report({ kind: 'notice-redispatch-failed', count: 1 });

    expect(logs).toStrictEqual([
      expect.objectContaining({
        category: 'event.infrastructure.data-export',
        incident: 'notice-redispatch-failed',
      }),
    ]);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのデータエクスポートの共通の束縛(%s)',
  (kind) => {
    test.each(DATA_EXPORT_IMPLEMENTATIONS)(
      'モジュールの一覧の処理単位のコンテナから%sを解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get(DATA_EXPORT_PLATFORM_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);
