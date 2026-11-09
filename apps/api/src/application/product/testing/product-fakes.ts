import { toHandleKey } from '../../../../common-lib/handles/handle-rules.ts';
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
  ProductInsertInput,
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
}

export interface FakeProductStore extends ProductStore {
  readonly inserts: ProductInsertInput[];
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
  const inserts: ProductInsertInput[] = [];
  const implemented: Partial<FakeProductStore> = {
    inserts,
    categoryExists(categoryId) {
      calls.push('store.categoryExists');
      return Promise.resolve(categories.has(categoryId));
    },
    isHandleOccupied(handle) {
      calls.push('store.isHandleOccupied');
      return Promise.resolve(occupied.has(toHandleKey(handle)));
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
        snapshots.find(
          (snapshot) =>
            snapshot.ownerUserId === ownerUserId && snapshot.handle === handle,
        ),
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
}

export interface FakeProductMedia {
  readonly media: MediaFiles;
  readonly claims: ClaimRequest[];
  readonly lookups: (readonly string[])[];
}

export function createFakeProductMedia(
  calls: string[],
  options: FakeProductMediaOptions = {},
): FakeProductMedia {
  const claims: ClaimRequest[] = [];
  const lookups: (readonly string[])[] = [];
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
    },
    'media',
  );
  return { media, claims, lookups };
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

export function createFakeStateEvaluator(calls: string[]): FakeStateEvaluator {
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
              stateOf(productId),
            ]),
          ),
        );
      },
    },
  };
}
