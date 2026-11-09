import { describe, expect, test } from 'bun:test';

import type { QuarantineReason } from '../../../lib/core/media/media-file.ts';
import type { MediaQuarantine } from '../../../lib/core/media/ports.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { ProductPurgeStore } from './ports.ts';
import { ProductImageQuarantineHandler } from './product-image-quarantine-handler.ts';

const PRODUCT_ID = '01JD0PROD00000000000000001';

const LOGO_ID = '01JC0F00000000000000000001';

const SCREENSHOT_IDS = [
  '01JC0F00000000000000000002',
  '01JC0F00000000000000000003',
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
  | {
      readonly operation: 'addReason' | 'removeReason';
      readonly fileIds: readonly string[];
      readonly reason: QuarantineReason;
    };

function createFakes(
  imageFileIds: readonly string[] | undefined,
  failure?: Error,
): {
  readonly purgeStore: ProductPurgeStore;
  readonly quarantine: MediaQuarantine;
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
  const change =
    (operation: 'addReason' | 'removeReason') =>
    (fileIds: readonly string[], reason: QuarantineReason) => {
      calls.push({ operation, fileIds, reason });
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    };
  // この処理が呼ぶのはファイルのIDによる理由の追加と取り除きだけで、他の操作は呼ばれたら失敗させる
  const quarantine = {
    addReason: change('addReason'),
    removeReason: change('removeReason'),
  } as unknown as MediaQuarantine;
  return { purgeStore, quarantine, calls };
}

describe('ProductImageQuarantineHandler', () => {
  test('非公開化では、ロゴとスクリーンショットに非公開化の隔離理由を加えて完了する', async () => {
    const { purgeStore, quarantine, calls } = createFakes([
      LOGO_ID,
      ...SCREENSHOT_IDS,
    ]);

    expect(
      await new ProductImageQuarantineHandler(purgeStore, quarantine).handle(
        eventOf('hidden'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      { operation: 'imageFileIds', productId: PRODUCT_ID },
      {
        operation: 'addReason',
        fileIds: [LOGO_ID, ...SCREENSHOT_IDS],
        reason: 'product_hidden',
      },
    ]);
  });

  test('復元では、ロゴとスクリーンショットから非公開化の隔離理由を取り除いて完了する', async () => {
    const { purgeStore, quarantine, calls } = createFakes([LOGO_ID]);

    expect(
      await new ProductImageQuarantineHandler(purgeStore, quarantine).handle(
        eventOf('unhidden'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      { operation: 'imageFileIds', productId: PRODUCT_ID },
      {
        operation: 'removeReason',
        fileIds: [LOGO_ID],
        reason: 'product_hidden',
      },
    ]);
  });

  test.each(['hidden', 'unhidden'] as const)(
    '%sでプロダクトの行が無ければ、画像に触れずに完了する',
    async (type) => {
      const { purgeStore, quarantine, calls } = createFakes(undefined);

      expect(
        await new ProductImageQuarantineHandler(purgeStore, quarantine).handle(
          eventOf(type),
        ),
      ).toStrictEqual({ kind: 'done' });
      expect(calls).toStrictEqual([
        { operation: 'imageFileIds', productId: PRODUCT_ID },
      ]);
    },
  );

  test.each(['deleted', 'purge_due'] as const)(
    '非公開化・復元以外の種類(%s)のイベントでは、画像に触れずに完了する',
    async (type) => {
      const { purgeStore, quarantine, calls } = createFakes([LOGO_ID]);

      expect(
        await new ProductImageQuarantineHandler(purgeStore, quarantine).handle(
          eventOf(type),
        ),
      ).toStrictEqual({ kind: 'done' });
      expect(calls).toStrictEqual([]);
    },
  );

  test.each(['hidden', 'unhidden'] as const)(
    '%sでの隔離の失敗は捕まえずに投げ、メッセージの再試行に任せる',
    async (type) => {
      const failure = new Error('移動の依頼の障害');
      const { purgeStore, quarantine } = createFakes([LOGO_ID], failure);

      expect(
        await new ProductImageQuarantineHandler(purgeStore, quarantine)
          .handle(eventOf(type))
          .catch((thrown: unknown) => thrown),
      ).toBe(failure);
    },
  );
});
