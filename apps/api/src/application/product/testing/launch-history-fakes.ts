import type {
  AccountGuard,
  CurrentUser,
} from '../../../../lib/core/identity/account-guard.ts';
import type {
  LaunchRecord,
  ProductDirectory,
} from '../../../../lib/core/product/ports.ts';
import type {
  UserHandleResolution,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';
import type { SessionView } from '../../../../lib/core/session/session-view.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  LaunchSummarySource,
  RegisteredDecisionSource,
} from '../decision-sources.ts';
import type {
  LaunchHistoryProductRecord,
  LaunchHistoryScope,
  LaunchHistoryStore,
  ProductListPosition,
} from '../ports.ts';

export const SESSION: SessionView = Object.freeze({
  principal: () => Promise.reject(new Error('この偽物では使わない: principal')),
});

export const TARGET_USER_ID = '01JC0USER00000000000000009';

export const userSummaryOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: TARGET_USER_ID,
  handle: 'target',
  nickname: 'ターゲット',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

export const viewerOf = (userId: string): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: userId,
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'viewer@mail.example',
    nickname: '閲覧者',
    handle: 'viewer',
  },
});

export function createFakeAccountGuard(
  calls: string[],
  viewer: CurrentUser | undefined,
): AccountGuard {
  const unexpected = () => {
    throw new Error('この偽物では使わない');
  };
  return {
    currentUser() {
      calls.push('guard.currentUser');
      return Promise.resolve(viewer);
    },
    requireUser: unexpected,
    requireWritableUser: unexpected,
    requireVerifiedUser: unexpected,
  };
}

export interface FakeUserProfileDirectory extends UserProfileDirectory {
  readonly resolved: string[];
}

export function createFakeUserProfileDirectory(
  calls: string[],
  resolution: UserHandleResolution,
): FakeUserProfileDirectory {
  const resolved: string[] = [];
  return {
    resolved,
    findSummaries() {
      throw new Error('この偽物では使わない: findSummaries');
    },
    resolveHandle(handle) {
      calls.push('users.resolveHandle');
      resolved.push(handle);
      return Promise.resolve(resolution);
    },
  };
}

export const historyProductOf = (
  productId: string,
  latestLaunchDate: string,
  overrides: Partial<LaunchHistoryProductRecord> = {},
): LaunchHistoryProductRecord => ({
  productId,
  ownerUserId: TARGET_USER_ID,
  handle: `handle-${productId.toLowerCase()}`,
  name: `名称${productId}`,
  tagline: `タグライン${productId}`,
  category: { id: 'category-1', name: '開発ツール', handle: 'developer-tools' },
  websiteUrl: 'https://product.example/',
  logoFileId: `logo-${productId}`,
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  latestLaunchDate: parseBusinessDate(latestLaunchDate),
  ...overrides,
});

export interface FakeLaunchHistoryRequest {
  readonly userId: string;
  readonly scope: LaunchHistoryScope;
  readonly limit?: number;
  readonly before?: ProductListPosition | undefined;
}

export interface FakeLaunchHistoryStore extends LaunchHistoryStore {
  readonly listRequests: FakeLaunchHistoryRequest[];
  readonly countRequests: FakeLaunchHistoryRequest[];
}

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
const isAfterPosition = (
  record: LaunchHistoryProductRecord,
  before: ProductListPosition | undefined,
): boolean =>
  before === undefined ||
  record.latestLaunchDate < before.latestLaunchDate ||
  (record.latestLaunchDate === before.latestLaunchDate &&
    record.productId < before.id);

const newestFirst = (
  left: LaunchHistoryProductRecord,
  right: LaunchHistoryProductRecord,
): number => {
  if (left.latestLaunchDate !== right.latestLaunchDate) {
    return left.latestLaunchDate < right.latestLaunchDate ? 1 : -1;
  }
  return left.productId < right.productId ? 1 : -1;
};

// 範囲ごとの対象をそのまま持ち、ストアと同じ並びと位置で返す
export function createFakeLaunchHistoryStore(
  calls: string[],
  records: Readonly<
    Record<LaunchHistoryScope, readonly LaunchHistoryProductRecord[]>
  >,
): FakeLaunchHistoryStore {
  const listRequests: FakeLaunchHistoryRequest[] = [];
  const countRequests: FakeLaunchHistoryRequest[] = [];
  return {
    listRequests,
    countRequests,
    count(input) {
      calls.push('history.count');
      countRequests.push(input);
      return Promise.resolve(records[input.scope].length);
    },
    list(input) {
      calls.push('history.list');
      listRequests.push(input);
      return Promise.resolve(
        records[input.scope]
          .filter((record) => isAfterPosition(record, input.before))
          .toSorted(newestFirst)
          .slice(0, input.limit),
      );
    },
  };
}

export interface FakeLaunchDirectory {
  readonly directory: ProductDirectory;
  readonly requests: (readonly string[])[];
}

// ローンチはプロダクトごとにローンチ日の新しい順で、取消を含む
export function createFakeLaunchDirectory(
  calls: string[],
  launches: ReadonlyMap<string, readonly LaunchRecord[]>,
): FakeLaunchDirectory {
  const requests: (readonly string[])[] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`この偽物では使わない: ${name}`);
  };
  return {
    requests,
    directory: {
      findSummaries: unexpected('findSummaries'),
      resolveHandle: unexpected('resolveHandle'),
      findDetail: unexpected('findDetail'),
      listLaunches(productIds) {
        calls.push('directory.listLaunches');
        requests.push(productIds);
        return Promise.resolve(
          new Map(
            productIds.flatMap((id) => {
              const found = launches.get(id);
              return found === undefined ? [] : [[id, found] as const];
            }),
          ),
        );
      },
    },
  };
}

export type SummarizeInput = Parameters<LaunchSummarySource['summarize']>[0];

export interface FakeSummarySource {
  readonly registered: RegisteredDecisionSource<LaunchSummarySource>;
  readonly inputs: SummarizeInput[];
}

export function createFakeSummarySource(
  name: string,
  summarize: LaunchSummarySource['summarize'],
): FakeSummarySource {
  const inputs: SummarizeInput[] = [];
  return {
    inputs,
    registered: {
      name,
      source: {
        summarize(input) {
          inputs.push(input);
          return summarize(input);
        },
      },
    },
  };
}

export const day = (value: string): BusinessDate => parseBusinessDate(value);
