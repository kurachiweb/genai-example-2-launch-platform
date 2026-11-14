import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../../../common-lib/product/product-input-rules.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { LaunchRecord } from '../../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import { computeLaunchDateWindow } from '../../../domain/product/launch-date-rules.ts';
import type {
  LaunchLocks,
  LaunchPlan,
} from '../../../domain/product/launch-plan.ts';
import type { ProductSnapshot } from '../ports.ts';
import {
  type ProductUpdateInput,
  StoreProductEditor,
} from '../product-editor.ts';
import type { ProductState } from '../product-state-evaluator.ts';
import {
  CATEGORY,
  CATEGORY_ID,
  createFakeProductMedia,
  createFakeProductStore,
  createFakeStateEvaluator,
  createSequentialIds,
  type FakeProductMediaOptions,
  type FakeProductStoreOptions,
  fixedClock,
  imageFileOf,
  LOGO_FILE_ID,
  PRODUCT_NOW,
  SCREENSHOT_FILE_IDS,
  USER_ID,
} from './product-fakes.ts';

export const day = (value: string): BusinessDate => parseBusinessDate(value);

export const PRODUCT_ID = '01JD0PRODUCT00000000000001';
export const LAUNCH_ID = '01JD0LAUNCH000000000000001';
export const OTHER_CATEGORY_ID = '01JD0CATEGORY0000000000002';
export const NEW_LOGO_FILE_ID = '01JC0FILE00000000000000002';
export const NEW_SCREENSHOT_FILE_ID = '01JC0FILE00000000000000013';
export const [FIRST_SCREENSHOT_ID, SECOND_SCREENSHOT_ID] = SCREENSHOT_FILE_IDS;

export const FINISHED_LAUNCH: LaunchRecord = Object.freeze({
  launchId: LAUNCH_ID,
  productId: PRODUCT_ID,
  number: 1,
  launchDate: day('2026-10-10'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-10-10T15:00:00.000Z'),
});

export const snapshotOf = (
  overrides: Partial<ProductSnapshot> = {},
): ProductSnapshot => ({
  productId: PRODUCT_ID,
  ownerUserId: USER_ID,
  handle: 'launch-meter',
  previousHandle: null,
  name: 'ローンチ計測',
  tagline: '公開の反応をまとめて見る',
  category: CATEGORY,
  websiteUrl: 'https://launch-meter.example/',
  descriptionMarkdown: '# 概要',
  logoFileId: LOGO_FILE_ID,
  screenshotFileIds: [...SCREENSHOT_FILE_IDS],
  hidden: false,
  version: 3,
  launches: [FINISHED_LAUNCH],
  ...overrides,
});

export const inputOf = (
  overrides: Partial<ProductUpdateInput> = {},
): ProductUpdateInput => ({
  productHandle: 'launch-meter',
  expectedVersion: 3,
  name: 'ローンチ計測',
  tagline: '公開の反応をまとめて見る',
  categoryId: CATEGORY_ID,
  handle: 'launch-meter',
  websiteUrl: 'https://launch-meter.example/',
  descriptionMarkdown: '# 概要',
  logoFileId: LOGO_FILE_ID,
  screenshotFileIds: [...SCREENSHOT_FILE_IDS],
  launchDate: null,
  ...overrides,
});

// 業務日付2026-10-23の12:00に、基準の無い予約で選べる日は10-24〜2027-01-21
export const WINDOW = computeLaunchDateWindow({
  now: PRODUCT_NOW,
  basis: null,
  entitled: false,
});

export const UNLOCKED: LaunchLocks = Object.freeze({
  locked: false,
  locks: [],
  unknown: false,
});

export const LOCKED: LaunchLocks = Object.freeze({
  locked: true,
  locks: [
    {
      code: 'qualifier_match',
      message:
        'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
    },
  ],
  unknown: false,
});

export const LOCKS_UNKNOWN: LaunchLocks = Object.freeze({
  locked: false,
  locks: [],
  unknown: true,
});

export const NEW_PLAN: LaunchPlan = Object.freeze({
  mode: 'new',
  basis: null,
});

export const RESCHEDULE_PLAN: LaunchPlan = Object.freeze({
  mode: 'reschedule',
  launchId: LAUNCH_ID,
  current: day('2026-10-30'),
  basis: null,
});

export const stateWith = (
  plan: LaunchPlan,
  locks: LaunchLocks = UNLOCKED,
): ProductState => ({
  productId: PRODUCT_ID,
  latestLaunch: null,
  plan,
  locks,
  window: plan.mode === 'new' || plan.mode === 'reschedule' ? WINDOW : null,
  ultrasEntitled: false,
});

export const DEFAULT_FILES = [
  imageFileOf(LOGO_FILE_ID, PRODUCT_LOGO_PURPOSE, 1000),
  imageFileOf(NEW_LOGO_FILE_ID, PRODUCT_LOGO_PURPOSE, 1000),
  ...[...SCREENSHOT_FILE_IDS, NEW_SCREENSHOT_FILE_ID].map((id) =>
    imageFileOf(id, PRODUCT_SCREENSHOT_PURPOSE, 2000),
  ),
];

export interface EditorSetupOptions {
  readonly store?: FakeProductStoreOptions;
  readonly media?: FakeProductMediaOptions;
  readonly state?: ProductState;
}

export function setupEditor(options: EditorSetupOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, {
    snapshots: [snapshotOf()],
    ...options.store,
  });
  const fakeMedia = createFakeProductMedia(calls, {
    files: DEFAULT_FILES,
    ...options.media,
  });
  const state = options.state ?? stateWith(NEW_PLAN);
  const fakeEvaluator = createFakeStateEvaluator(calls, () => state);
  const editor = new StoreProductEditor(
    store,
    fakeEvaluator.evaluator,
    fakeMedia.media,
    fixedClock,
    createSequentialIds(),
  );
  return { editor, store, calls, ...fakeMedia, ...fakeEvaluator };
}

export async function rejectionOf(
  promise: Promise<unknown>,
): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

export const generatedIdOf = (index: number): string =>
  `01JD0ID${String(index).padStart(19, '0')}`;
