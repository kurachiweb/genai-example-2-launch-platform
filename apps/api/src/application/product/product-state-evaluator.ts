import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { deriveLaunchStatus } from '../../../lib/core/product/launch-status.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type { UltrasEntitlements } from '../../../lib/core/ultras/ports.ts';
import {
  computeLaunchDateWindow,
  type LaunchBasis,
  type LaunchDateWindow,
} from '../../domain/product/launch-date-rules.ts';
import {
  decideLaunchPlan,
  decideLocks,
  type IdentifiedLaunch,
  type LaunchLocks,
  type LaunchPlan,
  type PlanBlock,
  type PlanLock,
} from '../../domain/product/launch-plan.ts';
import {
  callDecisionSources,
  type DecisionSubject,
  type ProductLockSource,
  type RegisteredDecisionSource,
  type RelaunchConditionSource,
} from './decision-sources.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductState {
  readonly productId: string;
  // 取消を除く直近のローンチ
  readonly latestLaunch: LaunchRecord | null;
  readonly plan: LaunchPlan;
  readonly locks: LaunchLocks;
  // planがnew・rescheduleのとき
  readonly window: LaunchDateWindow | null;
  // 敗北が基準のときだけ判定し、判定しなければfalse
  readonly ultrasEntitled: boolean;
}

export interface ProductStateInput {
  readonly productId: string;
  readonly hidden: boolean;
  readonly launches: readonly LaunchRecord[];
}

export interface ProductStateEvaluator {
  evaluate(input: {
    readonly ownerUserId: string;
    // 0〜PRODUCT_STATE_BATCH_MAX件
    readonly products: readonly ProductStateInput[];
    readonly at: Date;
  }): Promise<ReadonlyMap<string, ProductState>>;
}

export const PRODUCT_STATE_BATCH_MAX = 20;

const logger = getAppLogger(['api', 'application', 'product']);

const UNKNOWN_PLAN: LaunchPlan = Object.freeze({ mode: 'unknown' });

interface PreparedProduct {
  readonly input: ProductStateInput;
  readonly facts: readonly IdentifiedLaunch[];
  readonly latestLaunch: LaunchRecord | null;
}

type Entitlement = boolean | 'unavailable';

const factsOf = (record: LaunchRecord): IdentifiedLaunch => ({
  id: record.launchId,
  launchDate: record.launchDate,
  outcome: record.outcome,
  cancelledAt: null,
});

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
const newestFirst = (left: LaunchRecord, right: LaunchRecord): number => {
  if (left.launchDate !== right.launchDate) {
    return left.launchDate < right.launchDate ? 1 : -1;
  }
  return left.launchId < right.launchId ? 1 : -1;
};

function prepare(input: ProductStateInput, at: Date): PreparedProduct {
  const active = input.launches
    .filter(({ status }) => status !== 'canceled')
    .toSorted(newestFirst);
  const facts = active.map(factsOf);
  const [latest] = active;
  const [latestFacts] = facts;
  return {
    input,
    facts,
    latestLaunch:
      latest === undefined || latestFacts === undefined
        ? null
        : { ...latest, status: deriveLaunchStatus(latestFacts, at) },
  };
}

const subjectOf = (
  ownerUserId: string,
  { input, latestLaunch }: PreparedProduct,
): DecisionSubject => ({
  productId: input.productId,
  ownerUserId,
  latestLaunch:
    latestLaunch === null
      ? null
      : {
          launchId: latestLaunch.launchId,
          launchDate: latestLaunch.launchDate,
          status: latestLaunch.status,
          outcome: latestLaunch.outcome,
        },
});

function groupByProduct<TEntry extends { readonly productId: string }, TValue>(
  batches: readonly (readonly TEntry[])[],
  toValue: (entry: TEntry) => TValue,
): ReadonlyMap<string, readonly TValue[]> {
  const grouped = new Map<string, TValue[]>();
  for (const entry of batches.flat()) {
    grouped.set(entry.productId, [
      ...(grouped.get(entry.productId) ?? []),
      toValue(entry),
    ]);
  }
  return grouped;
}

const basisOf = (plan: LaunchPlan): LaunchBasis | null =>
  plan.mode === 'new' || plan.mode === 'reschedule' ? plan.basis : null;

const needsEntitlement = (plan: LaunchPlan): boolean =>
  basisOf(plan)?.outcome === 'lost';

interface ProductDecision {
  readonly product: PreparedProduct;
  readonly plan: LaunchPlan;
  readonly locks: LaunchLocks;
}

function stateOf(
  { product, plan, locks }: ProductDecision,
  entitlement: Entitlement,
  at: Date,
): ProductState {
  const base = {
    productId: product.input.productId,
    latestLaunch: product.latestLaunch,
    locks,
    ultrasEntitled: needsEntitlement(plan) && entitlement === true,
  };
  // 加入の有無で選べる日が変わるため、判定できなければ予約と変更を受け付けない
  if (needsEntitlement(plan) && entitlement === 'unavailable') {
    return { ...base, plan: UNKNOWN_PLAN, window: null };
  }
  const window =
    plan.mode === 'new' || plan.mode === 'reschedule'
      ? computeLaunchDateWindow({
          now: at,
          basis: plan.basis,
          entitled: entitlement === true,
        })
      : null;
  return { ...base, plan, window };
}

@injectable()
export class DefaultProductStateEvaluator implements ProductStateEvaluator {
  constructor(
    @inject(PRODUCT_TYPES.RelaunchConditionSources)
    private readonly relaunchSources: readonly RegisteredDecisionSource<RelaunchConditionSource>[],
    @inject(PRODUCT_TYPES.ProductLockSources)
    private readonly lockSources: readonly RegisteredDecisionSource<ProductLockSource>[],
    @inject(ULTRAS_TYPES.UltrasEntitlements)
    private readonly entitlements: UltrasEntitlements,
  ) {}

  async evaluate(input: {
    readonly ownerUserId: string;
    readonly products: readonly ProductStateInput[];
    readonly at: Date;
  }): Promise<ReadonlyMap<string, ProductState>> {
    const { ownerUserId, products, at } = input;
    if (products.length > PRODUCT_STATE_BATCH_MAX) {
      throw new RangeError(
        `判定するプロダクトは${String(PRODUCT_STATE_BATCH_MAX)}件以下で指定してください: ${String(products.length)}`,
      );
    }
    if (products.length === 0) {
      return new Map();
    }
    const prepared = products.map((product) => prepare(product, at));
    const subjects = prepared.map((product) => subjectOf(ownerUserId, product));
    const [blockResults, lockResults] = await Promise.all([
      callDecisionSources(this.relaunchSources, async (source) =>
        source.findBlocks({ subjects, at }),
      ),
      callDecisionSources(this.lockSources, async (source) =>
        source.findLocks({ subjects, at }),
      ),
    ]);
    const blocks = groupByProduct(
      blockResults.results,
      ({ code, message, releaseAt }): PlanBlock => ({
        code,
        message,
        releaseAt,
      }),
    );
    const locks = groupByProduct(
      lockResults.results,
      ({ code, message }): PlanLock => ({ code, message }),
    );
    const decided = prepared.map((product): ProductDecision => ({
      product,
      plan: decideLaunchPlan({
        now: at,
        hidden: product.input.hidden,
        launches: product.facts,
        sourceBlocks: blockResults.failed
          ? 'unavailable'
          : (blocks.get(product.input.productId) ?? []),
      }),
      locks: decideLocks({
        now: at,
        launches: product.facts,
        sourceLocks: lockResults.failed
          ? 'unavailable'
          : (locks.get(product.input.productId) ?? []),
      }),
    }));
    const entitlement = decided.some(({ plan }) => needsEntitlement(plan))
      ? await this.entitlementOf(ownerUserId, at)
      : false;
    return new Map(
      decided.map((decision) => [
        decision.product.input.productId,
        stateOf(decision, entitlement, at),
      ]),
    );
  }

  private async entitlementOf(
    ownerUserId: string,
    at: Date,
  ): Promise<Entitlement> {
    try {
      return await this.entitlements.isEntitledAt(ownerUserId, at);
    } catch (error: unknown) {
      logger.warning(
        'Ultrasの加入状態を判定できないため、敗北の後の選べる日を確認できない状態にしました',
        { userId: ownerUserId, error },
      );
      return 'unavailable';
    }
  }
}
