import { describe, expect, test } from 'bun:test';

import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { ProductPurgeStore } from './ports.ts';
import { ProductImageErasureHandler } from './product-image-erasure-handler.ts';

const PRODUCT_ID = '01JD0PROD00000000000000001';

const IMAGE_IDS = [
  '01JC0F00000000000000000001',
  '01JC0F00000000000000000002',
] as const;

function eventOf(type: ProductLifecycleEventType): ProductLifecycleEvent {
  return Object.freeze({
    id: '01JD0PEVT00000000000000010',
    productId: PRODUCT_ID,
    ownerUserId: '01JC0USER00000000000000001',
    type,
    occurredAt: new Date('2026-11-20T00:00:00.000Z'),
  });
}

type Call =
  | { readonly operation: 'imageFileIds'; readonly productId: string }
  | { readonly operation: 'eraseNow'; readonly fileIds: readonly string[] };

function createFakes(
  imageFileIds: readonly string[] | undefined,
  erase: () => Promise<{ readonly erased: number }> = () =>
    Promise.resolve({ erased: imageFileIds?.length ?? 0 }),
): {
  readonly purgeStore: ProductPurgeStore;
  readonly files: MediaFiles;
  readonly calls: readonly Call[];
} {
  const calls: Call[] = [];
  const purgeStore: ProductPurgeStore = {
    imageFileIds: (productId) => {
      calls.push({ operation: 'imageFileIds', productId });
      return Promise.resolve(imageFileIds);
    },
    purge: () => Promise.reject(new Error('想定外の呼び出し')),
  };
  // この処理が呼ぶのは即時の物理削除だけで、他の操作は呼ばれたら失敗させる
  const files = {
    eraseNow: (fileIds: readonly string[]) => {
      calls.push({ operation: 'eraseNow', fileIds });
      return erase();
    },
  } as unknown as MediaFiles;
  return { purgeStore, files, calls };
}

describe('ProductImageErasureHandler', () => {
  test('物理削除の時期の到来では、ロゴとスクリーンショットを即時に物理削除して完了する', async () => {
    const { purgeStore, files, calls } = createFakes(IMAGE_IDS);

    expect(
      await new ProductImageErasureHandler(purgeStore, files).handle(
        eventOf('purge_due'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      { operation: 'imageFileIds', productId: PRODUCT_ID },
      { operation: 'eraseNow', fileIds: IMAGE_IDS },
    ]);
  });

  test('既に消えていて1件も削除しなかった場合も完了する', async () => {
    const { purgeStore, files } = createFakes(IMAGE_IDS, () =>
      Promise.resolve({ erased: 0 }),
    );

    expect(
      await new ProductImageErasureHandler(purgeStore, files).handle(
        eventOf('purge_due'),
      ),
    ).toStrictEqual({ kind: 'done' });
  });

  test('プロダクトの行が無ければ、画像に触れずに完了する', async () => {
    const { purgeStore, files, calls } = createFakes(undefined);

    expect(
      await new ProductImageErasureHandler(purgeStore, files).handle(
        eventOf('purge_due'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      { operation: 'imageFileIds', productId: PRODUCT_ID },
    ]);
  });

  test.each(['deleted', 'hidden', 'unhidden'] as const)(
    '物理削除の時期の到来以外の種類(%s)のイベントでは、画像に触れずに完了する',
    async (type) => {
      const { purgeStore, files, calls } = createFakes(IMAGE_IDS);

      expect(
        await new ProductImageErasureHandler(purgeStore, files).handle(
          eventOf(type),
        ),
      ).toStrictEqual({ kind: 'done' });
      expect(calls).toStrictEqual([]);
    },
  );

  test('削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('保存先の障害');
    const { purgeStore, files } = createFakes(IMAGE_IDS, () =>
      Promise.reject(failure),
    );

    expect(
      await new ProductImageErasureHandler(purgeStore, files)
        .handle(eventOf('purge_due'))
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
