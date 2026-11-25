import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { userLifecycleEvents } from '../../db/schema/identity/user-lifecycle-events.ts';
import { productLaunches } from '../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../db/schema/product/product-lifecycle-events.ts';
import { products } from '../../db/schema/product/products.ts';
import { productScreenshots } from '../../db/schema/product/product-screenshots.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import {
  desiredLocation,
  type QuarantineReason,
} from '../../lib/core/media/media-file.ts';
import { RELOCATE_FILES_MESSAGE } from '../../lib/core/media/media-messages.ts';
import type { MediaQuarantine } from '../../lib/core/media/ports.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import { toBusinessDateTime } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearEngagementTables } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  readReasons,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearMediaState } from '../../lib/workers/media/testing/media-operations-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import {
  db,
  OPERATOR_ADMIN_ID,
  readModerationRows,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import {
  after,
  insertLaunch,
  insertProduct,
  insertScreenshot,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import type { ImageModerationService } from '../application/moderation/image-moderation-service.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type { ModerationCommand } from '../application/moderation/ports.ts';
import type { ProductModerationService } from '../application/moderation/product-moderation-service.ts';
import type { UserModerationService } from '../application/moderation/user-moderation-service.ts';
import {
  clearModerationWrites,
  PSEUDONYMOUS_ID,
  readModerationAuditLogs,
} from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { MODULES } from './modules.ts';

const OWNER = 1;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const PROFILE_IMAGE = 1;
const LOGO = 2;
const SCREENSHOT = 3;
const OTHER_LOGO = 4;
const UPCOMING_LAUNCH = 1;
const DECIDED_LAUNCH = 2;
const TODAY_LAUNCH = 3;

const FIRST_AT = after(60_000);
const SECOND_AT = after(120_000);
const TODAY = toBusinessDateTime(FIRST_AT).date;
const UPCOMING_DATE = '2026-11-08';
const DECIDED_DATE = '2026-10-25';
const REASON = '規約違反の投稿を繰り返したため';

interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
}

interface Harness {
  readonly container: Container;
  readonly published: readonly PublishedMessage[];
}

// 確定の後の発行を記録し、イベントサーバーへ届くはずのメッセージをテストの中で配る
function createHarness(): Harness {
  const published: PublishedMessage[] = [];
  const recordingPublisher = new ContainerModule(({ rebind }) => {
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue({
      publish: (contract, body) => {
        published.push({ type: contract.type, body });
        return Promise.resolve(crypto.randomUUID());
      },
    });
  });
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
    [...MODULES, { bindings: recordingPublisher }],
  );
  return { container, published };
}

const eventIdsOf = (
  published: readonly PublishedMessage[],
  type: string,
): string[] =>
  published
    .filter((message) => message.type === type)
    .map((message) => (message.body as { eventId: string }).eventId);

async function productImageFileIdsOf(productId: string): Promise<string[]> {
  const [product] = await db
    .select({ logoFileId: products.logoFileId })
    .from(products)
    .where(eq(products.id, productId));
  const screenshots = await db
    .select({ fileId: productScreenshots.fileId })
    .from(productScreenshots)
    .where(eq(productScreenshots.productId, productId))
    .orderBy(asc(productScreenshots.position));
  return product === undefined
    ? []
    : [product.logoFileId, ...screenshots.map(({ fileId }) => fileId)];
}

// apiのテストはイベントサーバーのアプリを読み込めないため、イベントサーバーに登録された画像の隔離の処理
// (user-profile-social.owned-image-quarantine・product-launch.image-quarantine)と同じく、
// 記録したメッセージのイベントを読み直して上流の共有の部品の隔離理由の追加・取り除きを呼ぶ
async function deliverLifecycleMessages(
  published: readonly PublishedMessage[],
): Promise<Harness> {
  const delivery = createHarness();
  const quarantine = delivery.container.get<MediaQuarantine>(
    MEDIA_TYPES.MediaQuarantine,
  );
  for (const eventId of eventIdsOf(
    published,
    RUN_USER_LIFECYCLE_MESSAGE.type,
  )) {
    const [event] = await db
      .select()
      .from(userLifecycleEvents)
      .where(eq(userLifecycleEvents.id, eventId));
    if (event?.type !== 'suspended' && event?.type !== 'unsuspended') {
      continue;
    }
    const owner = { kind: 'user', id: event.userId } as const;
    let hasMore = true;
    while (hasMore) {
      ({ hasMore } =
        event.type === 'suspended'
          ? await quarantine.addReasonForOwner(owner, 'user_suspended')
          : await quarantine.removeReasonForOwner(owner, 'user_suspended'));
    }
  }
  for (const eventId of eventIdsOf(
    published,
    RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
  )) {
    const [event] = await db
      .select()
      .from(productLifecycleEvents)
      .where(eq(productLifecycleEvents.id, eventId));
    if (event?.type !== 'hidden' && event?.type !== 'unhidden') {
      continue;
    }
    const fileIds = await productImageFileIdsOf(event.productId);
    await (event.type === 'hidden'
      ? quarantine.addReason(fileIds, 'product_hidden')
      : quarantine.removeReason(fileIds, 'product_hidden'));
  }
  return delivery;
}

const relocatedIdsOf = (published: readonly PublishedMessage[]): string[] =>
  published
    .filter((message) => message.type === RELOCATE_FILES_MESSAGE.type)
    .flatMap((message) => (message.body as { fileIds: string[] }).fileIds)
    .toSorted();

const commandOf = (
  targetId: string,
  at: Date,
  reason: string | undefined = REASON,
): ModerationCommand => ({
  targetId,
  reason,
  operator: { adminId: OPERATOR_ADMIN_ID },
  at,
});

async function reasonsOf(index: number): Promise<QuarantineReason[]> {
  return (await readReasons())
    .filter((row) => row.fileId === fileIdOf(index))
    .map((row) => row.reason)
    .toSorted();
}

async function locationOf(index: number) {
  return desiredLocation('images', await reasonsOf(index));
}

async function readLaunch(index: number) {
  const [row] = await db
    .select({
      cancelledAt: productLaunches.cancelledAt,
      outcome: productLaunches.outcome,
    })
    .from(productLaunches)
    .where(eq(productLaunches.id, launchIdOf(index)));
  return row;
}

async function readActions() {
  return (await readModerationRows())
    .map(({ id, action, lifecycleEventId, occurredAt }) => ({
      id,
      action,
      lifecycleEventId,
      occurredAt,
    }))
    .toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

async function readAuditActions() {
  return (await readModerationAuditLogs())
    .map(({ action, occurredAt, targets }) => ({
      action,
      occurredAt,
      targets,
    }))
    .toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

async function seedOwnedImage(
  index: number,
  reasons: readonly QuarantineReason[] = [],
): Promise<void> {
  await insertFile(index, {
    ownerId: userIdOf(OWNER),
    location: reasons.length > 0 ? 'quarantine' : 'images',
  });
  for (const reason of reasons) {
    await insertReason(index, reason);
  }
}

async function seedProductWithImages(
  logoReasons: readonly QuarantineReason[] = [],
): Promise<void> {
  await seedOwnedImage(LOGO, logoReasons);
  await seedOwnedImage(SCREENSHOT);
  await insertProduct(PRODUCT, OWNER, { logoFileId: fileIdOf(LOGO) });
  await insertScreenshot(1, PRODUCT, 0, fileIdOf(SCREENSHOT));
  await insertLaunch(DECIDED_LAUNCH, PRODUCT, {
    launchDate: DECIDED_DATE,
    outcome: 'lost',
    decidedAt: after(1),
  });
  await insertLaunch(UPCOMING_LAUNCH, PRODUCT, { launchDate: UPCOMING_DATE });
}

function userServiceOf(container: Container): UserModerationService {
  return container.get<UserModerationService>(
    MODERATION_TYPES.UserModerationService,
  );
}

function productServiceOf(container: Container): ProductModerationService {
  return container.get<ProductModerationService>(
    MODERATION_TYPES.ProductModerationService,
  );
}

function imageServiceOf(container: Container): ImageModerationService {
  return container.get<ImageModerationService>(
    MODERATION_TYPES.ImageModerationService,
  );
}

beforeEach(async () => {
  await clearModerationWrites();
  await clearEngagementTables();
  await clearMediaState();
  await insertUser(OWNER, { pseudonymousId: PSEUDONYMOUS_ID });
});

describe('停止と停止解除の連鎖', () => {
  beforeEach(async () => {
    await seedOwnedImage(PROFILE_IMAGE);
    await seedProductWithImages();
    await seedOwnedImage(OTHER_LOGO);
    await insertProduct(OTHER_PRODUCT, OWNER, {
      logoFileId: fileIdOf(OTHER_LOGO),
    });
    await insertLaunch(TODAY_LAUNCH, OTHER_PRODUCT, { launchDate: TODAY });
  });

  test('停止で未開始のローンチだけが取り消され、記録と監査ログが残り、配った停止のイベントで保有する画像に隔離理由が付く', async () => {
    const suspension = createHarness();

    const outcome = await userServiceOf(suspension.container).suspend(
      commandOf(userIdOf(OWNER), FIRST_AT),
    );

    expect(outcome.changed).toBe(true);
    expect(await readLaunch(UPCOMING_LAUNCH)).toStrictEqual({
      cancelledAt: FIRST_AT,
      outcome: null,
    });
    expect(await readLaunch(TODAY_LAUNCH)).toStrictEqual({
      cancelledAt: null,
      outcome: null,
    });
    expect(await readLaunch(DECIDED_LAUNCH)).toStrictEqual({
      cancelledAt: null,
      outcome: 'lost',
    });
    const [suspendedEventId] = eventIdsOf(
      suspension.published,
      RUN_USER_LIFECYCLE_MESSAGE.type,
    );
    expect(await readActions()).toStrictEqual([
      {
        id: outcome.actionId,
        action: 'user.suspend',
        lifecycleEventId: suspendedEventId,
        occurredAt: FIRST_AT,
      },
    ]);
    expect(await readAuditActions()).toStrictEqual([
      {
        action: 'user.suspend',
        occurredAt: FIRST_AT,
        targets: [{ targetKind: 'user', targetId: PSEUDONYMOUS_ID }],
      },
    ]);

    const delivery = await deliverLifecycleMessages(suspension.published);

    for (const image of [PROFILE_IMAGE, LOGO, SCREENSHOT, OTHER_LOGO]) {
      expect(await reasonsOf(image)).toStrictEqual(['user_suspended']);
    }
    expect(relocatedIdsOf(delivery.published)).toStrictEqual(
      [PROFILE_IMAGE, LOGO, SCREENSHOT, OTHER_LOGO].map(fileIdOf).toSorted(),
    );
  });

  test('停止解除で取り消したローンチは戻らず、記録と監査ログが2件になり、配った停止解除のイベントで隔離理由が外れて公開へ戻る', async () => {
    const suspension = createHarness();
    await userServiceOf(suspension.container).suspend(
      commandOf(userIdOf(OWNER), FIRST_AT),
    );
    await deliverLifecycleMessages(suspension.published);
    const unsuspension = createHarness();

    const outcome = await userServiceOf(unsuspension.container).unsuspend(
      commandOf(userIdOf(OWNER), SECOND_AT),
    );

    expect(outcome.changed).toBe(true);
    expect(await readLaunch(UPCOMING_LAUNCH)).toStrictEqual({
      cancelledAt: FIRST_AT,
      outcome: null,
    });
    expect(
      (await readActions()).map(({ action, occurredAt }) => ({
        action,
        occurredAt,
      })),
    ).toStrictEqual([
      { action: 'user.suspend', occurredAt: FIRST_AT },
      { action: 'user.unsuspend', occurredAt: SECOND_AT },
    ]);
    expect(
      (await readAuditActions()).map(({ action, targets }) => ({
        action,
        targets,
      })),
    ).toStrictEqual([
      {
        action: 'user.suspend',
        targets: [{ targetKind: 'user', targetId: PSEUDONYMOUS_ID }],
      },
      {
        action: 'user.unsuspend',
        targets: [{ targetKind: 'user', targetId: PSEUDONYMOUS_ID }],
      },
    ]);

    const delivery = await deliverLifecycleMessages(unsuspension.published);

    for (const image of [PROFILE_IMAGE, LOGO, SCREENSHOT, OTHER_LOGO]) {
      expect(await reasonsOf(image)).toStrictEqual([]);
      expect(await locationOf(image)).toBe('images');
    }
    expect(relocatedIdsOf(delivery.published)).toStrictEqual(
      [PROFILE_IMAGE, LOGO, SCREENSHOT, OTHER_LOGO].map(fileIdOf).toSorted(),
    );
  });
});

describe('非公開化と復元の連鎖', () => {
  test('非公開化で未開始のローンチだけが取り消され、記録と監査ログが残り、配った非公開化のイベントでロゴとスクリーンショットに隔離理由が付く', async () => {
    await seedProductWithImages();
    await seedOwnedImage(PROFILE_IMAGE);
    const hiding = createHarness();

    const outcome = await productServiceOf(hiding.container).hide(
      commandOf(productIdOf(PRODUCT), FIRST_AT),
    );

    expect(outcome.changed).toBe(true);
    expect(await readLaunch(UPCOMING_LAUNCH)).toStrictEqual({
      cancelledAt: FIRST_AT,
      outcome: null,
    });
    expect(await readLaunch(DECIDED_LAUNCH)).toStrictEqual({
      cancelledAt: null,
      outcome: 'lost',
    });
    const [hiddenEventId] = eventIdsOf(
      hiding.published,
      RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
    );
    expect(await readActions()).toStrictEqual([
      {
        id: outcome.actionId,
        action: 'product.hide',
        lifecycleEventId: hiddenEventId,
        occurredAt: FIRST_AT,
      },
    ]);
    expect(await readAuditActions()).toStrictEqual([
      {
        action: 'product.hide',
        occurredAt: FIRST_AT,
        targets: [{ targetKind: 'product', targetId: productIdOf(PRODUCT) }],
      },
    ]);

    await deliverLifecycleMessages(hiding.published);

    expect(await reasonsOf(LOGO)).toStrictEqual(['product_hidden']);
    expect(await reasonsOf(SCREENSHOT)).toStrictEqual(['product_hidden']);
    expect(await reasonsOf(PROFILE_IMAGE)).toStrictEqual([]);
  });

  test('復元で取り消したローンチは戻らず、記録と監査ログが2件になり、配った復元のイベントで隔離理由が外れて公開へ戻る', async () => {
    await seedProductWithImages();
    const hiding = createHarness();
    await productServiceOf(hiding.container).hide(
      commandOf(productIdOf(PRODUCT), FIRST_AT),
    );
    await deliverLifecycleMessages(hiding.published);
    const restoring = createHarness();

    const outcome = await productServiceOf(restoring.container).unhide(
      commandOf(productIdOf(PRODUCT), SECOND_AT),
    );

    expect(outcome.changed).toBe(true);
    expect(await readLaunch(UPCOMING_LAUNCH)).toStrictEqual({
      cancelledAt: FIRST_AT,
      outcome: null,
    });
    expect(
      (await readActions()).map(({ action, occurredAt }) => ({
        action,
        occurredAt,
      })),
    ).toStrictEqual([
      { action: 'product.hide', occurredAt: FIRST_AT },
      { action: 'product.unhide', occurredAt: SECOND_AT },
    ]);
    expect(
      (await readAuditActions()).map(({ action }) => action),
    ).toStrictEqual(['product.hide', 'product.unhide']);

    const delivery = await deliverLifecycleMessages(restoring.published);

    for (const image of [LOGO, SCREENSHOT]) {
      expect(await reasonsOf(image)).toStrictEqual([]);
      expect(await locationOf(image)).toBe('images');
    }
    expect(relocatedIdsOf(delivery.published)).toStrictEqual(
      [LOGO, SCREENSHOT].map(fileIdOf).toSorted(),
    );
  });
});

describe('隔離理由が2つある画像', () => {
  test('ユーザー停止の理由も持つ画像は、復元で非公開化の理由だけが外れて隔離のまま残る', async () => {
    await seedProductWithImages(['user_suspended']);
    const hiding = createHarness();
    await productServiceOf(hiding.container).hide(
      commandOf(productIdOf(PRODUCT), FIRST_AT),
    );
    await deliverLifecycleMessages(hiding.published);
    expect(await reasonsOf(LOGO)).toStrictEqual([
      'product_hidden',
      'user_suspended',
    ]);
    const restoring = createHarness();
    await productServiceOf(restoring.container).unhide(
      commandOf(productIdOf(PRODUCT), SECOND_AT),
    );

    const delivery = await deliverLifecycleMessages(restoring.published);

    expect(await reasonsOf(LOGO)).toStrictEqual(['user_suspended']);
    expect(await locationOf(LOGO)).toBe('quarantine');
    expect(await reasonsOf(SCREENSHOT)).toStrictEqual([]);
    expect(relocatedIdsOf(delivery.published)).toStrictEqual([
      fileIdOf(SCREENSHOT),
    ]);
  });

  test('自動判定の理由も持つ画像は、停止解除でユーザー停止の理由だけが外れて隔離のまま残る', async () => {
    await seedOwnedImage(PROFILE_IMAGE, ['auto']);
    const suspension = createHarness();
    await userServiceOf(suspension.container).suspend(
      commandOf(userIdOf(OWNER), FIRST_AT),
    );
    await deliverLifecycleMessages(suspension.published);
    const unsuspension = createHarness();
    await userServiceOf(unsuspension.container).unsuspend(
      commandOf(userIdOf(OWNER), SECOND_AT),
    );

    const delivery = await deliverLifecycleMessages(unsuspension.published);

    expect(await reasonsOf(PROFILE_IMAGE)).toStrictEqual(['auto']);
    expect(await locationOf(PROFILE_IMAGE)).toBe('quarantine');
    expect(relocatedIdsOf(delivery.published)).toStrictEqual([]);
  });

  test('非公開化の理由も持つ画像は、公開承認で自動判定の理由だけが外れて隔離のまま残り、記録と監査ログが残る', async () => {
    await seedProductWithImages(['auto']);
    const hiding = createHarness();
    await productServiceOf(hiding.container).hide(
      commandOf(productIdOf(PRODUCT), FIRST_AT),
    );
    await deliverLifecycleMessages(hiding.published);
    const approval = createHarness();

    const outcome = await imageServiceOf(approval.container).approve(
      commandOf(fileIdOf(LOGO), SECOND_AT, undefined),
    );

    expect(outcome.changed).toBe(true);
    expect(await reasonsOf(LOGO)).toStrictEqual(['product_hidden']);
    expect(await locationOf(LOGO)).toBe('quarantine');
    expect(relocatedIdsOf(approval.published)).toStrictEqual([]);
    expect(
      (await readActions()).map(({ id, action }) => ({ id, action })),
    ).toStrictEqual([
      expect.objectContaining({ action: 'product.hide' }),
      { id: outcome.actionId, action: 'image.approve' },
    ]);
    expect(
      (await readAuditActions()).map(({ action, targets }) => ({
        action,
        targets,
      })),
    ).toStrictEqual([
      {
        action: 'product.hide',
        targets: [{ targetKind: 'product', targetId: productIdOf(PRODUCT) }],
      },
      {
        action: 'image.approve',
        targets: [{ targetKind: 'image', targetId: fileIdOf(LOGO) }],
      },
    ]);
  });

  test('非公開化の理由だけを持つ画像は画像の操作で解除できず、記録も監査ログも増えない', async () => {
    await seedProductWithImages();
    const hiding = createHarness();
    await productServiceOf(hiding.container).hide(
      commandOf(productIdOf(PRODUCT), FIRST_AT),
    );
    await deliverLifecycleMessages(hiding.published);
    const images = imageServiceOf(createHarness().container);

    await expect(
      images.approve(commandOf(fileIdOf(LOGO), SECOND_AT, undefined)),
    ).rejects.toMatchObject({ code: 'image_action_not_applicable' });
    await expect(
      images.release(commandOf(fileIdOf(LOGO), SECOND_AT, undefined)),
    ).rejects.toMatchObject({ code: 'image_action_not_applicable' });

    expect(await reasonsOf(LOGO)).toStrictEqual(['product_hidden']);
    expect((await readActions()).map(({ action }) => action)).toStrictEqual([
      'product.hide',
    ]);
    expect(
      (await readAuditActions()).map(({ action }) => action),
    ).toStrictEqual(['product.hide']);
  });
});
