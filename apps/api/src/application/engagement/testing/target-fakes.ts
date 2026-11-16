import type {
  LaunchRecord,
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';

export const NOW = fromBusinessDateTime(parseBusinessDate('2026-11-20'), {
  hour: 12,
  minute: 0,
});

export const PRODUCT_ID = '01JD0PR0D00000000000000001';
export const OTHER_PRODUCT_ID = '01JD0PR0D00000000000000002';
export const OWNER_ID = '01JD0USER00000000000000001';
export const MEMBER_ID = '01JD0USER00000000000000002';
export const LAUNCH_ID = '01JD01NCH00000000000000001';
export const OTHER_LAUNCH_ID = '01JD01NCH00000000000000002';

export const summaryOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: 'my-product',
  name: '名称',
  tagline: 'タグライン',
  category: { id: 'category-1', name: '開発ツール', handle: 'devtools' },
  websiteUrl: 'https://product.example/',
  logoFileId: 'logo-1',
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

export const launchOf = (
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord => ({
  launchId: LAUNCH_ID,
  productId: PRODUCT_ID,
  number: 1,
  launchDate: parseBusinessDate('2026-11-20'),
  status: 'in_progress',
  outcome: null,
  decidedAt: null,
  ...overrides,
});

// 照会の結果を決めるプロダクトの状態。どれかが真なら可視でない
export interface FakeProductState {
  hidden: boolean;
  deleted: boolean;
  ownerSuspended: boolean;
  ownerWithdrawn: boolean;
}

export interface FakeProductEntry {
  readonly summary: ProductSummaryRecord;
  readonly state: FakeProductState;
}

export interface FakeTargetDirectory {
  readonly directory: ProductDirectory;
  readonly summaryReads: {
    readonly productIds: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
  readonly launchReads: {
    readonly productIds: readonly string[];
    readonly now: Date;
  }[];
}

export const activeState = (): FakeProductState => ({
  hidden: false,
  deleted: false,
  ownerSuspended: false,
  ownerWithdrawn: false,
});

const isVisible = (state: FakeProductState): boolean =>
  !state.hidden &&
  !state.deleted &&
  !state.ownerSuspended &&
  !state.ownerWithdrawn;

const isNotDeleted = (state: FakeProductState): boolean =>
  !state.deleted && !state.ownerWithdrawn;

// 照会の引数を記録し、本物と同じくvisibleの照会では可視でないプロダクトを結果に含めない模擬のProductDirectory
export function createFakeTargetDirectory(input: {
  readonly products: readonly FakeProductEntry[];
  readonly launches: readonly LaunchRecord[];
}): FakeTargetDirectory {
  const summaryReads: FakeTargetDirectory['summaryReads'] = [];
  const launchReads: FakeTargetDirectory['launchReads'] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`この偽物では使わない: ${name}`);
  };
  const directory: ProductDirectory = {
    findSummaries(productIds, scope) {
      summaryReads.push({ productIds, scope });
      const ids = new Set(productIds);
      const included = scope === 'visible' ? isVisible : isNotDeleted;
      return Promise.resolve(
        new Map(
          input.products
            .filter(
              ({ summary, state }) =>
                ids.has(summary.productId) && included(state),
            )
            .map(({ summary, state }) => [
              summary.productId,
              {
                ...summary,
                hidden: state.hidden,
                visible: isVisible(state),
                listed: summary.listed && isVisible(state),
              },
            ]),
        ),
      );
    },
    listLaunches(productIds, now) {
      launchReads.push({ productIds, now });
      const ids = new Set(productIds);
      return Promise.resolve(
        Map.groupBy(
          input.launches.filter((launch) => ids.has(launch.productId)),
          (launch) => launch.productId,
        ),
      );
    },
    resolveHandle: unexpected('resolveHandle'),
    findDetail: unexpected('findDetail'),
  };
  return { directory, summaryReads, launchReads };
}
