import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { PUBLIC_API_PLATFORM_TYPES } from '../../lib/core/public-api/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ApiKeyExport } from '../../lib/workers/public-api/d1-api-key-export.ts';
import { MODULES } from './modules.ts';
import { PUBLIC_API_MODULE } from './public-api-module.ts';

describe('APIサーバーの公開APIの束縛', () => {
  test('公開APIの束縛をモジュールの一覧に1つだけ持つ', () => {
    expect(MODULES.filter(({ name }) => name === 'public-api')).toEqual([
      PUBLIC_API_MODULE,
    ]);
  });

  test('経路を登録せず、束縛だけを持つ', () => {
    expect(PUBLIC_API_MODULE.routes).toBeUndefined();
    expect(PUBLIC_API_MODULE.bindings).toBeDefined();
  });

  test('公開APIの束縛を加えた一覧からfetchの処理単位のコンテナを作り、既存の束縛を解決できる', () => {
    const container = createInvocationContainer(
      {
        env,
        executionCtx: createExecutionContext(),
        info: {
          kind: 'fetch',
          correlationId: crypto.randomUUID(),
          clientIp: undefined,
        },
      },
      MODULES,
    );

    expect(
      container.get(PUBLIC_API_PLATFORM_TYPES.ApiKeyExport),
    ).toBeInstanceOf(D1ApiKeyExport);
  });
});
