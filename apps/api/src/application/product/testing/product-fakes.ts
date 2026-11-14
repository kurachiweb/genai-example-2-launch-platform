import {
  isSameHandle,
  toHandleKey,
} from '../../../../common-lib/handles/handle-rules.ts';
import type {
  CurrentUser,
  UserAccountView,
} from '../../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type { MediaFileView } from '../../../../lib/core/media/media-file.ts';
import type {
  ClaimRequest,
  ClaimResult,
  MediaFiles,
} from '../../../../lib/core/media/ports.ts';
import type { ProductCategoryRecord } from '../../../../lib/core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  ProductDescriptionUpdateInput,
  ProductDescriptionUpdateResult,
  ProductInsertInput,
  ProductListPosition,
  ProductSaveInput,
  ProductSaveResult,
  ProductSnapshot,
  ProductStore,
} from '../ports.ts';
import type {
  ProductState,
  ProductStateEvaluator,
  ProductStateInput,
} from '../product-state-evaluator.ts';

export const USER_ID = '01JC0USER00000000000000001';
export const CATEGORY_ID = '01JD0CATEGORY0000000000001';
export const LOGO_FILE_ID = '01JC0FILE00000000000000001';
export const SCREENSHOT_FILE_IDS = [
  '01JC0FILE00000000000000011',
  '01JC0FILE00000000000000012',
] as const;

// 業務日付2026-10-23の12:00。登録で選べる日は10-24〜2027-01-21
export const PRODUCT_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-10-23'),
  { hour: 12, minute: 0 },
);

export const fixedClock: Clock = { now: () => PRODUCT_NOW };

export const CATEGORY: ProductCategoryRecord = Object.freeze({
  id: CATEGORY_ID,
  name: '開発ツール',
  handle: 'developer-tools',
  systemDefault: false,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
});

export const currentUserOf = (
  overrides: Partial<UserAccountView> = {},
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'alice@mail.example',
    nickname: 'アリス',
    handle: 'alice',
    ...overrides,
  },
});

// 呼び出しのたびに連番のIDを返す
export function createSequentialIds(prefix = '01JD0ID'): IdGenerator {
  let next = 0;
  return {
    generate: () => {
      next += 1;
      return `${prefix}${String(next).padStart(26 - prefix.length, '0')}`;
    },
  };
}

export interface FakeProductStoreOptions {
  readonly categoryIds?: readonly string[];
  readonly occupiedHandles?: readonly string[];
  readonly insertResult?: Awaited<ReturnType<ProductStore['insert']>>;
  readonly snapshots?: readonly ProductSnapshot[];
  // 保存の直後に退会などで読めなくなった場合を再現する
  readonly forgetsInserted?: boolean;
  readonly saveResult?: ProductSaveResult;
  readonly descriptionResult?: ProductDescriptionUpdateResult;
  // 論理削除したプロダクトとして、読み取りのメソッドから除く
  readonly deletedProductIds?: readonly string[];
}

export interface FakeListRequest {
  readonly ownerUserId: string;
  readonly limit: number;
  readonly before: ProductListPosition | undefined;
  readonly now: Date;
}

export interface FakeProductStore extends ProductStore {
  readonly inserts: ProductInsertInput[];
  readonly saves: ProductSaveInput[];
  readonly descriptionUpdates: ProductDescriptionUpdateInput[];
  readonly listRequests: FakeListRequest[];
  readonly occupiedChecks: {
    readonly handle: string;
    readonly exceptProductId: string | undefined;
  }[];
}

const snapshotOfInsert = (input: ProductInsertInput): ProductSnapshot => ({
  productId: input.productId,
  ownerUserId: input.ownerUserId,
  handle: input.fields.handle,
  previousHandle: null,
  name: input.fields.name,
  tagline: input.fields.tagline,
  category: { ...CATEGORY, id: input.fields.categoryId },
  websiteUrl: input.fields.websiteUrl,
  descriptionMarkdown: input.fields.descriptionMarkdown,
  logoFileId: input.fields.logoFileId,
  screenshotFileIds: input.fields.screenshotFileIds,
  hidden: false,
  version: 0,
  launches: [
    {
      launchId: input.launchId,
      productId: input.productId,
      number: 1,
      launchDate: input.launchDate,
      status: 'scheduled',
      outcome: null,
      decidedAt: null,
    },
  ],
});

const snapshotOfSave = (
  current: ProductSnapshot,
  input: ProductSaveInput,
): ProductSnapshot => ({
  ...current,
  ...input.fields,
  previousHandle:
    input.plan.handle.kind === 'changed'
      ? input.plan.handle.previous
      : current.previousHandle,
  category: { ...CATEGORY, id: input.fields.categoryId },
  version: current.version + 1,
});

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
const latestLaunchDateOf = (snapshot: ProductSnapshot): string =>
  snapshot.launches.reduce<string>(
    (latest, { launchDate }) => (launchDate > latest ? launchDate : latest),
    '',
  );

// ストアと同じく最新のローンチ日とIDの降順
const newestFirst = (left: ProductSnapshot, right: ProductSnapshot): number => {
  const leftDate = latestLaunchDateOf(left);
  const rightDate = latestLaunchDateOf(right);
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? 1 : -1;
  }
  return left.productId < right.productId ? 1 : -1;
};

const isAfterPosition = (
  snapshot: ProductSnapshot,
  before: ProductListPosition | undefined,
): boolean => {
  if (before === undefined) {
    return true;
  }
  const date = latestLaunchDateOf(snapshot);
  return (
    date < before.latestLaunchDate ||
    (date === before.latestLaunchDate && snapshot.productId < before.id)
  );
};

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function failUnused<T extends object>(
  implemented: Partial<T>,
  label: string,
): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${label}.${String(property)}`);
      };
    },
  }) as T;
}

// 呼び出しの順序を他の偽物と同じ記録に残し、登録が成功したら次の読み取りに反映する
export function createFakeProductStore(
  calls: string[],
  options: FakeProductStoreOptions = {},
): FakeProductStore {
  const categories = new Set(options.categoryIds ?? [CATEGORY_ID]);
  const occupied = new Set((options.occupiedHandles ?? []).map(toHandleKey));
  const snapshots = [...(options.snapshots ?? [])];
  const deleted = new Set(options.deletedProductIds ?? []);
  const readable = (ownerUserId: string): ProductSnapshot[] =>
    snapshots.filter(
      (snapshot) =>
        snapshot.ownerUserId === ownerUserId &&
        !deleted.has(snapshot.productId),
    );
  const listRequests: FakeListRequest[] = [];
  const inserts: ProductInsertInput[] = [];
  const saves: ProductSaveInput[] = [];
  const descriptionUpdates: ProductDescriptionUpdateInput[] = [];
  const occupiedChecks: FakeProductStore['occupiedChecks'] = [];
  const implemented: Partial<FakeProductStore> = {
    inserts,
    saves,
    descriptionUpdates,
    listRequests,
    occupiedChecks,
    categoryExists(categoryId) {
      calls.push('store.categoryExists');
      return Promise.resolve(categories.has(categoryId));
    },
    isHandleOccupied(handle, exceptProductId) {
      calls.push('store.isHandleOccupied');
      occupiedChecks.push({ handle, exceptProductId });
      return Promise.resolve(occupied.has(toHandleKey(handle)));
    },
    save(input) {
      calls.push('store.save');
      saves.push(input);
      const result = options.saveResult ?? 'saved';
      const index = snapshots.findIndex(
        ({ productId }) => productId === input.productId,
      );
      const current = snapshots[index];
      if (result === 'saved' && current !== undefined) {
        snapshots[index] = snapshotOfSave(current, input);
      }
      return Promise.resolve(result);
    },
    updateDescription(input) {
      calls.push('store.updateDescription');
      descriptionUpdates.push(input);
      return Promise.resolve(options.descriptionResult ?? 'saved');
    },
    insert(input) {
      calls.push('store.insert');
      inserts.push(input);
      const result = options.insertResult ?? 'saved';
      if (result === 'saved' && options.forgetsInserted !== true) {
        snapshots.push(snapshotOfInsert(input));
      }
      return Promise.resolve(result);
    },
    findForOwner(ownerUserId, handle) {
      calls.push('store.findForOwner');
      return Promise.resolve(
        readable(ownerUserId).find((snapshot) => snapshot.handle === handle),
      );
    },
    resolveOwnPreviousHandle(ownerUserId, handle) {
      calls.push('store.resolveOwnPreviousHandle');
      return Promise.resolve(
        readable(ownerUserId).find(
          ({ previousHandle }) =>
            previousHandle !== null && isSameHandle(previousHandle, handle),
        )?.handle,
      );
    },
    listForOwner(input) {
      calls.push('store.listForOwner');
      listRequests.push(input);
      return Promise.resolve(
        readable(input.ownerUserId)
          .filter((snapshot) => isAfterPosition(snapshot, input.before))
          .toSorted(newestFirst)
          .slice(0, input.limit),
      );
    },
  };
  return failUnused<FakeProductStore>(implemented, 'store');
}

export const imageFileOf = (
  id: string,
  purpose: string,
  byteSize: number,
): MediaFileView => ({
  id,
  objectKey: `images/${id}`,
  purpose,
  storage: 'images',
  location: 'images',
  owner: { kind: 'user', id: USER_ID },
  originalFileName: `${id}.png`,
  contentType: 'image/png',
  byteSize,
  width: 100,
  height: 100,
  stored: true,
  attached: true,
  deletedAt: null,
  eraseRequested: false,
  moderationStatus: 'passed',
  quarantineReasons: [],
  quarantined: false,
  createdAt: new Date('2026-10-23T00:00:00.000Z'),
});

export interface FakeProductMediaOptions {
  // 用途ごとの紐付けの結果。無ければ成功
  readonly claimResults?: Readonly<Record<string, ClaimResult>>;
  readonly files?: readonly MediaFileView[];
  readonly eraseNowError?: Error;
  readonly markDeletedError?: Error;
}

export interface FakeProductMedia {
  readonly media: MediaFiles;
  readonly claims: ClaimRequest[];
  readonly lookups: (readonly string[])[];
  readonly erased: (readonly string[])[];
  readonly markedDeleted: (readonly string[])[];
}

export function createFakeProductMedia(
  calls: string[],
  options: FakeProductMediaOptions = {},
): FakeProductMedia {
  const claims: ClaimRequest[] = [];
  const lookups: (readonly string[])[] = [];
  const erased: (readonly string[])[] = [];
  const markedDeleted: (readonly string[])[] = [];
  const files = new Map((options.files ?? []).map((file) => [file.id, file]));
  const media = failUnused<MediaFiles>(
    {
      claim(request) {
        calls.push(`media.claim:${request.purpose}`);
        claims.push(request);
        return Promise.resolve(
          options.claimResults?.[request.purpose] ?? { ok: true },
        );
      },
      findMany(fileIds) {
        calls.push('media.findMany');
        lookups.push(fileIds);
        return Promise.resolve(
          new Map(
            fileIds.flatMap((id) => {
              const file = files.get(id);
              return file === undefined ? [] : [[id, file] as const];
            }),
          ),
        );
      },
      eraseNow(fileIds) {
        calls.push('media.eraseNow');
        erased.push(fileIds);
        if (options.eraseNowError !== undefined) {
          return Promise.reject(options.eraseNowError);
        }
        return Promise.resolve({ erased: fileIds.length });
      },
      markDeleted(fileIds) {
        calls.push('media.markDeleted');
        markedDeleted.push(fileIds);
        if (options.markDeletedError !== undefined) {
          return Promise.reject(options.markDeletedError);
        }
        return Promise.resolve();
      },
    },
    'media',
  );
  return { media, claims, lookups, erased, markedDeleted };
}

export const stateOf = (productId: string): ProductState => ({
  productId,
  latestLaunch: null,
  plan: { mode: 'unknown' },
  locks: { locked: false, locks: [], unknown: false },
  window: null,
  ultrasEntitled: false,
});

export interface FakeStateEvaluator {
  readonly evaluator: ProductStateEvaluator;
  readonly requests: {
    readonly ownerUserId: string;
    readonly products: readonly ProductStateInput[];
    readonly at: Date;
  }[];
}

// stateForで、プロダクトごとの判定の結果を差し替える
export function createFakeStateEvaluator(
  calls: string[],
  stateFor: (productId: string) => ProductState = stateOf,
): FakeStateEvaluator {
  const requests: FakeStateEvaluator['requests'] = [];
  return {
    requests,
    evaluator: {
      evaluate(input) {
        calls.push('evaluator.evaluate');
        requests.push(input);
        return Promise.resolve(
          new Map(
            input.products.map(({ productId }) => [
              productId,
              stateFor(productId),
            ]),
          ),
        );
      },
    },
  };
}
