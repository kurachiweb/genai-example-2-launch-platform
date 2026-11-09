import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { products } from '../../db/schema/product/products.ts';
import { RELOCATE_FILES_MESSAGE } from '../../lib/core/media/media-messages.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
  readFile,
  readReasons,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearProductTables,
  db,
  insertProduct,
  insertProductEvent,
  insertScreenshot,
  insertUser,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  readProductEventsOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import worker from '../index.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly relocatedFileIds: readonly string[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const PRODUCT = 1;

const OTHER_PRODUCT = 2;

const EVENT = 10;

const LOGO = 1;

const SCREENSHOTS = [2, 3] as const;

const OTHER_LOGO = 4;

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(eventIndex: number): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
    id: `01JD0PMGQ${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId: productEventIdOf(eventIndex) },
  };
}

function relocatedFileIdsOf(sent: unknown): readonly string[] {
  if (
    typeof sent !== 'object' ||
    sent === null ||
    !('type' in sent) ||
    sent.type !== RELOCATE_FILES_MESSAGE.type ||
    !('body' in sent)
  ) {
    return [];
  }
  const { fileIds } = RELOCATE_FILES_MESSAGE.schema.parse(sent.body);
  return fileIds;
}

// 本番と同じエントリのqueueハンドラーで処理する。画像の移動の依頼と画像のキャッシュのパージの依頼も同じキューへ送られるため、実際には送らずに移動の依頼の対象だけを集める
async function dispatch(envelope: QueueEnvelope): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  try {
    await queue(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      relocatedFileIds: sendSpy.mock.calls
        .flatMap(([sent]) => relocatedFileIdsOf(sent))
        .toSorted(),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function insertProductWithImages(
  columns: { readonly hiddenAt?: Date; readonly deletedAt?: Date } = {},
): Promise<void> {
  await insertProduct(PRODUCT, OWNER, {
    logoFileId: fileIdOf(LOGO),
    ...columns,
  });
  for (const [position, file] of SCREENSHOTS.entries()) {
    await insertScreenshot(file, PRODUCT, position, fileIdOf(file));
  }
  await insertProduct(OTHER_PRODUCT, OWNER, {
    logoFileId: fileIdOf(OTHER_LOGO),
  });
}

async function insertImage(
  file: number,
  reasons: readonly ('auto' | 'product_hidden' | 'user_suspended')[] = [],
): Promise<void> {
  await insertFile(file, {
    ownerId: userIdOf(OWNER),
    location: reasons.length > 0 ? 'quarantine' : 'images',
  });
  for (const reason of reasons) {
    await insertReason(file, reason);
  }
}

async function productRowExists(productIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productIdOf(productIndex)));
  return rows.length === 1;
}

async function reasonsByFile(): Promise<
  readonly (readonly [number, string])[]
> {
  const rows = await readReasons();
  return rows.map((row) => [Number(row.fileId.slice(-2)), row.reason]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearMediaTables();
  await clearProductTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('非公開化・復元でのプロダクトの画像の隔離', () => {
  test('非公開化で、ロゴとスクリーンショットに非公開化の隔離理由が付き、隔離中でなかった画像だけ移動を依頼し、他のプロダクトの画像には付かない', async () => {
    await insertUser(OWNER);
    await insertProductWithImages({ hiddenAt: T0 });
    await insertImage(LOGO);
    await insertImage(2, ['auto']);
    await insertImage(3);
    await insertImage(OTHER_LOGO);
    await insertProductEvent(EVENT, PRODUCT, { type: 'hidden' });

    const outcome = await dispatch(lifecycleEnvelope(EVENT));

    expect(outcome).toStrictEqual({
      acked: true,
      retried: false,
      relocatedFileIds: [fileIdOf(LOGO), fileIdOf(3)],
    });
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [LOGO, 'product_hidden'],
      [2, 'auto'],
      [2, 'product_hidden'],
      [3, 'product_hidden'],
    ]);
    await expect(readProductEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('復元で、非公開化の隔離理由だけが外れ、ユーザー停止の理由も持つ画像は隔離のまま残る', async () => {
    await insertUser(OWNER);
    await insertProductWithImages();
    await insertImage(LOGO, ['product_hidden']);
    await insertImage(2, ['product_hidden', 'user_suspended']);
    await insertImage(3, ['product_hidden']);
    await insertProductEvent(EVENT, PRODUCT, { type: 'unhidden' });

    const outcome = await dispatch(lifecycleEnvelope(EVENT));

    expect(outcome).toStrictEqual({
      acked: true,
      retried: false,
      relocatedFileIds: [fileIdOf(LOGO), fileIdOf(3)],
    });
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [2, 'user_suspended'],
    ]);
    await expect(readFile(2)).resolves.toMatchObject({
      location: 'quarantine',
    });
    await expect(readProductEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('同じ非公開化のイベントが重複して届いても隔離理由は重複せず、復元で元に戻る', async () => {
    await insertUser(OWNER);
    await insertProductWithImages({ hiddenAt: T0 });
    await insertImage(LOGO);
    await insertProductEvent(EVENT, PRODUCT, { type: 'hidden' });
    const envelope = lifecycleEnvelope(EVENT);
    await dispatch(envelope);
    await dispatch(envelope);
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [LOGO, 'product_hidden'],
    ]);
    await insertProductEvent(EVENT + 1, PRODUCT, {
      type: 'unhidden',
      occurredAt: new Date(T0.getTime() + 60_000),
    });

    await dispatch(lifecycleEnvelope(EVENT + 1));

    await expect(reasonsByFile()).resolves.toStrictEqual([]);
  });
});

describe('物理削除の時期の到来でのプロダクトの画像の削除', () => {
  test('ロゴとスクリーンショットを隔離中のものも含めて記録と保存先から消し、既に消えた画像があっても失敗せずにプロダクトを物理削除する', async () => {
    await insertUser(OWNER, { deletedAt: T0 });
    await insertProductWithImages({ deletedAt: T0 });
    await insertImage(LOGO);
    await insertImage(3, ['user_suspended']);
    await insertImage(OTHER_LOGO);
    await env.IMAGES_BUCKET.put(objectKeyOf(LOGO), 'logo');
    await env.QUARANTINE_BUCKET.put(objectKeyOf(3), 'screenshot');
    await insertProductEvent(EVENT, PRODUCT, { type: 'purge_due' });

    const outcome = await dispatch(lifecycleEnvelope(EVENT));

    expect(outcome).toMatchObject({ acked: true, retried: false });
    await expect(readFile(LOGO)).resolves.toBeUndefined();
    await expect(readFile(3)).resolves.toBeUndefined();
    await expect(readReasons()).resolves.toStrictEqual([]);
    await expect(env.IMAGES_BUCKET.head(objectKeyOf(LOGO))).resolves.toBeNull();
    await expect(
      env.QUARANTINE_BUCKET.head(objectKeyOf(3)),
    ).resolves.toBeNull();
    await expect(readFile(OTHER_LOGO)).resolves.toBeDefined();
    await expect(readProductEventsOf(PRODUCT)).resolves.toStrictEqual([]);
    await expect(productRowExists(PRODUCT)).resolves.toBe(false);
    await expect(productRowExists(OTHER_PRODUCT)).resolves.toBe(true);
  });

  test('画像が全て既に消えていても、失敗せずにプロダクトを物理削除する', async () => {
    await insertUser(OWNER, { deletedAt: T0 });
    await insertProductWithImages({ deletedAt: T0 });
    await insertProductEvent(EVENT, PRODUCT, { type: 'purge_due' });

    const outcome = await dispatch(lifecycleEnvelope(EVENT));

    expect(outcome).toMatchObject({ acked: true, retried: false });
    await expect(readProductEventsOf(PRODUCT)).resolves.toStrictEqual([]);
    await expect(productRowExists(PRODUCT)).resolves.toBe(false);
    await expect(productRowExists(OTHER_PRODUCT)).resolves.toBe(true);
  });
});
