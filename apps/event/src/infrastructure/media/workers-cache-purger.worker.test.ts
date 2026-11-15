import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { MEDIA_MESSAGE_LIMITS } from '../../../lib/core/media/media-messages.ts';
import type { InvocationScope } from '../../../lib/workers/di/invocation-container.ts';
import {
  EVENT_MEDIA_TYPES,
  type ImageCachePurger,
} from '../../application/media/ports.ts';
import type { PurgeObjectKeysResult } from '../../presentation/media/image-delivery-entrypoint.ts';
import { objectKeyFor } from './image-delivery.fixtures.ts';
import { WorkersCachePurger } from './workers-cache-purger.ts';

const keysOf = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => objectKeyFor(index + 1));

const scopeWith = (executionCtx: ExecutionContext): InvocationScope<Env> => ({
  env,
  executionCtx,
  info: { kind: 'queue', correlationId: 'purger-test', clientIp: undefined },
});

// 処理単位のコンテナと同じく、実行コンテキストを持つ処理単位の情報からパージの部品を取り出す
function resolvePurger(executionCtx: ExecutionContext): ImageCachePurger {
  const container = new Container({ defaultScope: 'Transient' });
  container
    .bind<InvocationScope<Env>>(PLATFORM_TYPES.InvocationScope)
    .toConstantValue(scopeWith(executionCtx));
  container
    .bind<ImageCachePurger>(EVENT_MEDIA_TYPES.ImageCachePurger)
    .to(WorkersCachePurger);
  return container.get<ImageCachePurger>(EVENT_MEDIA_TYPES.ImageCachePurger);
}

// 画像配信のエントリポイントのパージのRPCだけを差し替えた実行コンテキスト
function contextWithPurgeRpc(result: PurgeObjectKeysResult): {
  readonly executionCtx: ExecutionContext;
  readonly calls: (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  const executionCtx = {
    exports: {
      ImageDelivery: {
        purgeObjectKeys: (objectKeys: readonly string[]) => {
          calls.push(objectKeys);
          return Promise.resolve(result);
        },
      },
    },
  } as unknown as ExecutionContext;
  return { executionCtx, calls };
}

describe('WorkersCachePurger', () => {
  test('処理単位の実行コンテキストから画像配信のパージのRPCを呼び、キャッシュの無い環境では成功にする', async () => {
    const executionCtx = createExecutionContext();

    const result = await resolvePurger(executionCtx).purge(
      keysOf(MEDIA_MESSAGE_LIMITS.purgeBatch),
    );

    expect(result).toEqual({ ok: true });
  });

  test('受け取ったオブジェクトキーをそのままパージのRPCへ渡す', async () => {
    const { executionCtx, calls } = contextWithPurgeRpc({
      ok: true,
      skipped: false,
      errorCodes: [],
    });
    const keys = keysOf(3);

    const result = await resolvePurger(executionCtx).purge(keys);

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([keys]);
  });

  test('パージが拒否されたらエラーコードを返す', async () => {
    const { executionCtx } = contextWithPurgeRpc({
      ok: false,
      skipped: false,
      errorCodes: [1134, 1199],
    });

    const result = await resolvePurger(executionCtx).purge(keysOf(1));

    expect(result).toEqual({ ok: false, errorCodes: [1134, 1199] });
  });

  test('上限を超える件数はパージのRPCが拒否し、例外として伝える', async () => {
    const executionCtx = createExecutionContext();

    await expect(
      resolvePurger(executionCtx).purge(
        keysOf(MEDIA_MESSAGE_LIMITS.purgeBatch + 1),
      ),
    ).rejects.toThrow(RangeError);
  });
});
