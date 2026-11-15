import type { ServiceIdentifier } from 'inversify';

import {
  assertLifecycleHandlerName,
  LifecycleRegistrationError,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  LaunchStatus,
  QualifierOutcome,
} from '../../../lib/core/product/launch-status.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export interface DecisionSubject {
  readonly productId: string;
  readonly ownerUserId: string;
  // 取消を除く直近のローンチ
  readonly latestLaunch: {
    readonly launchId: string;
    readonly launchDate: BusinessDate;
    readonly status: LaunchStatus;
    readonly outcome: QualifierOutcome | null;
  } | null;
}

export interface RelaunchBlock {
  readonly productId: string;
  // '<spec名>.<名詞句>'(例: 'tournament-week.result-pending')
  readonly code: string;
  // 文言規則の「再ローンチ不可」の文言
  readonly message: string;
  readonly releaseAt: Date | null;
}

export interface RelaunchConditionSource {
  // 該当するものだけを返す
  findBlocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly RelaunchBlock[]>;
}

export interface ProductLockEntry {
  readonly productId: string;
  readonly code: string;
  readonly message: string;
}

export interface ProductLockSource {
  findLocks(input: {
    readonly subjects: readonly DecisionSubject[];
    readonly at: Date;
  }): Promise<readonly ProductLockEntry[]>;
}

export interface LaunchSummaryContribution {
  readonly launchId: string;
  readonly label: string;
  // 「トップページで見る」を添える
  readonly inMatch: boolean;
  // 複数の供給元が同じローンチに返したら大きい方を使う
  readonly rank: number;
}

export interface ProductAwardContribution {
  readonly productId: string;
  readonly kind: 'week' | 'year';
  // ツールチップの1行
  readonly label: string;
}

export interface LaunchSummarySource {
  summarize(input: {
    readonly launches: readonly {
      readonly launchId: string;
      readonly productId: string;
      readonly outcome: QualifierOutcome | null;
    }[];
    readonly at: Date;
  }): Promise<{
    readonly launches: readonly LaunchSummaryContribution[];
    readonly awards: readonly ProductAwardContribution[];
  }>;
}

export interface DecisionSourceRegistration<T> {
  // '<spec名>.<名詞句>'
  readonly name: string;
  readonly order: number;
  readonly source: ServiceIdentifier<T>;
}

export interface RegisteredDecisionSource<T> {
  readonly name: string;
  readonly source: T;
}

export interface DecisionSourceResults<R> {
  // 例外を投げた供給元を除き、登録の順
  readonly results: readonly R[];
  readonly failed: boolean;
}

const DECISION_SOURCE_LABEL = '判定の供給元';

const logger = getAppLogger(['api', 'application', 'product']);

// sourceLabelは違反の文言に出す登録口の呼び名
export function assertDecisionSourceRegistrations(
  registrations: readonly Pick<
    DecisionSourceRegistration<unknown>,
    'name' | 'order'
  >[],
  sourceLabel: string = DECISION_SOURCE_LABEL,
): void {
  const names = new Set<string>();
  const orders = new Map<number, string>();
  for (const { name, order } of registrations) {
    assertLifecycleHandlerName(name, sourceLabel);
    if (names.has(name)) {
      throw new LifecycleRegistrationError(
        `${sourceLabel}の名前が重複しています: ${JSON.stringify(name)}`,
      );
    }
    names.add(name);
    if (!Number.isInteger(order)) {
      throw new LifecycleRegistrationError(
        `${sourceLabel}${JSON.stringify(name)}のorderは整数で指定してください: ${String(order)}`,
      );
    }
    const colliding = orders.get(order);
    if (colliding !== undefined) {
      throw new LifecycleRegistrationError(
        `${sourceLabel}${JSON.stringify(colliding)}と${JSON.stringify(name)}のorderが重複しています: ${String(order)}`,
      );
    }
    orders.set(order, name);
  }
}

export function resolveDecisionSources<T>(
  registrations: readonly DecisionSourceRegistration<T>[],
  resolve: (identifier: ServiceIdentifier<T>) => T,
): readonly RegisteredDecisionSource<T>[] {
  assertDecisionSourceRegistrations(registrations);
  return Object.freeze(
    registrations
      .toSorted((left, right) => left.order - right.order)
      .map(({ name, source }) =>
        Object.freeze({ name, source: resolve(source) }),
      ),
  );
}

// 呼び出しは登録の順に始め、応答は並行して待つ
export async function callDecisionSources<T, R>(
  sources: readonly RegisteredDecisionSource<T>[],
  call: (source: T) => Promise<R>,
): Promise<DecisionSourceResults<R>> {
  const settled = await Promise.allSettled(
    sources.map(async ({ source }) => call(source)),
  );
  const results: R[] = [];
  let failed = false;
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
      continue;
    }
    failed = true;
    // 供給元の例外は利用者や後続specの内部の値を含み得るため、名前だけを残す
    logger.warning('判定の供給元の呼び出しに失敗しました', {
      sourceName: sources[index]?.name,
    });
  }
  return { results, failed };
}

// 供給元の結果を登録の順に連結して渡せば、同じ順位なら先の供給元の要約が残る
export function pickLaunchSummaries(
  contributions: readonly LaunchSummaryContribution[],
): ReadonlyMap<string, LaunchSummaryContribution> {
  const picked = new Map<string, LaunchSummaryContribution>();
  for (const contribution of contributions) {
    const current = picked.get(contribution.launchId);
    if (current === undefined || contribution.rank > current.rank) {
      picked.set(contribution.launchId, contribution);
    }
  }
  return picked;
}
