import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { PUBLIC_API_PLATFORM_TYPES } from '../../lib/core/public-api/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ApiKeyExport } from '../../lib/workers/public-api/d1-api-key-export.ts';
import { MODULES } from './modules.ts';

describe('APIサーバーの公開APIの共通の束縛', () => {
  test('公開APIの共通の束縛をモジュールの一覧に1つだけ持つ', () => {
    expect(
      MODULES.filter(({ name }) => name === 'public-api-platform'),
    ).toHaveLength(1);
  });

  test('fetchの処理単位のコンテナからデータエクスポートのAPIキーの照会をD1の実装に解決する', () => {
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
