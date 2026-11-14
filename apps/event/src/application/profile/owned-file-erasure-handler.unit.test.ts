import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  MediaFiles,
  OwnerBatchResult,
  OwnerRef,
} from '../../../lib/core/media/ports.ts';
import { OwnedFileErasureHandler } from './owned-file-erasure-handler.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000062',
  userId: '01JC0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

function createFakeFiles(results: readonly OwnerBatchResult[]): {
  readonly files: MediaFiles;
  readonly owners: readonly OwnerRef[];
} {
  const owners: OwnerRef[] = [];
  const pending = [...results];
  // 本タスクが呼ぶのはeraseOwnedByだけで、他の操作は呼ばれたら失敗させる
  const files = {
    eraseOwnedBy: (owner: OwnerRef) => {
      owners.push(owner);
      const next = pending.shift();
      return next === undefined
        ? Promise.reject(new Error('想定外の呼び出し'))
        : Promise.resolve(next);
    },
  } as unknown as MediaFiles;
  return { files, owners };
}

describe('OwnedFileErasureHandler', () => {
  test('イベントの利用者を保有者にしてファイルを消し、残りがあれば続きを返す', async () => {
    const { files, owners } = createFakeFiles([
      { processed: 1000, hasMore: true },
    ]);

    expect(
      await new OwnedFileErasureHandler(files).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(owners).toStrictEqual([{ kind: 'user', id: EVENT.userId }]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { files } = createFakeFiles([{ processed: 3, hasMore: false }]);

    expect(
      await new OwnedFileErasureHandler(files).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
  });

  test('ファイルが1件も無くても完了を返す', async () => {
    const { files } = createFakeFiles([{ processed: 0, hasMore: false }]);

    expect(
      await new OwnedFileErasureHandler(files).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
  });

  test('削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('R2の障害');
    const files = {
      eraseOwnedBy: () => Promise.reject(failure),
    } as unknown as MediaFiles;

    expect(
      await new OwnedFileErasureHandler(files)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
