import type {
  LaunchStatus,
  QualifierOutcome,
} from '../../../../../lib/core/product/launch-status.ts';
import { kickoffAt } from '../../../../../lib/core/product/launch-status.ts';
import {
  fallbackLaunchSummary,
  type LaunchSummaryView,
} from '../../../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductCategoryRecord,
} from '../../../../../lib/core/product/ports.ts';
import type { MyProductOwnerStatus } from '../../../../application/product/my-products-reader.ts';
import type { MyProductView } from '../../../../application/product/ports.ts';
import type { ProductHandleAvailability } from '../../../../application/product/product-handle-availability-checker.ts';
import type { ProductState } from '../../../../application/product/product-state-evaluator.ts';
import type {
  LaunchDateUnavailableReason,
  LaunchDateWindow,
} from '../../../../domain/product/launch-date-rules.ts';
import type { LaunchPlan } from '../../../../domain/product/launch-plan.ts';

export type LaunchStatusValue =
  'SCHEDULED' | 'PAIRED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELED';

export type QualifierOutcomeValue = 'WON' | 'LOST';

export type LaunchDateUnavailableReasonValue =
  'PAIRING_DEADLINE' | 'RELAUNCH_INTERVAL' | 'OUT_OF_RANGE';

export type LaunchPlanModeValue = 'NEW' | 'RESCHEDULE' | 'BLOCKED' | 'UNKNOWN';

export type HandleAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';

export interface ProductCategoryModel {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly systemDefault: boolean;
}

export interface ProductLaunchModel {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  readonly kickoffAt: Date;
  readonly status: LaunchStatusValue;
  readonly outcome: QualifierOutcomeValue | null;
  readonly summary: LaunchSummaryView;
}

export interface LaunchDateWindowModel {
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: {
    readonly from: string;
    readonly to: string;
    readonly reason: LaunchDateUnavailableReasonValue;
  }[];
  readonly relaunchIntervalDays: number | null;
}

export interface ProductLaunchPlanModel {
  readonly mode: LaunchPlanModeValue;
  readonly currentLaunchDate: string | null;
  readonly window: LaunchDateWindowModel | null;
  readonly blocks: {
    readonly code: string;
    readonly message: string;
    readonly releaseAt: Date | null;
  }[];
  readonly locked: boolean;
  readonly locks: { readonly code: string; readonly message: string }[];
  readonly lockUnknown: boolean;
  readonly ultrasEntitled: boolean;
}

// 画像は項目のリゾルバが要求されたときだけ読むため、ファイルのIDだけを持つ
export interface ProductScreenshotModel {
  readonly fileId: string;
}

export interface MyProductModel {
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryModel;
  readonly websiteUrl: string;
  readonly description: string;
  readonly logoFileId: string;
  readonly screenshots: readonly ProductScreenshotModel[];
  readonly hidden: boolean;
  readonly listed: boolean;
  readonly version: number;
  readonly latestLaunch: ProductLaunchModel | null;
  readonly plan: ProductLaunchPlanModel;
}

export interface MyProductRedirectModel {
  readonly handle: string;
}

export interface ProductOwnerStatusModel {
  readonly latestLaunch: ProductLaunchModel | null;
  readonly plan: ProductLaunchPlanModel;
}

const LAUNCH_STATUS_VALUES = Object.freeze({
  scheduled: 'SCHEDULED',
  paired: 'PAIRED',
  in_progress: 'IN_PROGRESS',
  finished: 'FINISHED',
  canceled: 'CANCELED',
} as const satisfies Record<LaunchStatus, LaunchStatusValue>);

const QUALIFIER_OUTCOME_VALUES = Object.freeze({
  won: 'WON',
  lost: 'LOST',
} as const satisfies Record<QualifierOutcome, QualifierOutcomeValue>);

const UNAVAILABLE_REASON_VALUES = Object.freeze({
  pairing_deadline: 'PAIRING_DEADLINE',
  relaunch_interval: 'RELAUNCH_INTERVAL',
  out_of_range: 'OUT_OF_RANGE',
} as const satisfies Record<
  LaunchDateUnavailableReason,
  LaunchDateUnavailableReasonValue
>);

const PLAN_MODE_VALUES = Object.freeze({
  new: 'NEW',
  reschedule: 'RESCHEDULE',
  blocked: 'BLOCKED',
  unknown: 'UNKNOWN',
} as const satisfies Record<LaunchPlan['mode'], LaunchPlanModeValue>);

const HANDLE_AVAILABILITY_VALUES = Object.freeze({
  available: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
  invalid: 'INVALID',
} as const satisfies Record<
  ProductHandleAvailability,
  HandleAvailabilityValue
>);

export const handleAvailabilityOf = (
  result: ProductHandleAvailability,
): HandleAvailabilityValue => HANDLE_AVAILABILITY_VALUES[result];

export const toProductCategory = (
  category: Pick<
    ProductCategoryRecord,
    'id' | 'name' | 'handle' | 'systemDefault'
  >,
): ProductCategoryModel => ({
  id: category.id,
  name: category.name,
  handle: category.handle,
  systemDefault: category.systemDefault,
});

// 要約の供給元を呼ばない照会は、予選の結果から要約を作る
export const toProductLaunch = (
  launch: LaunchRecord,
  summary: LaunchSummaryView = fallbackLaunchSummary(launch),
): ProductLaunchModel => ({
  id: launch.launchId,
  number: launch.number,
  launchDate: launch.launchDate,
  kickoffAt: kickoffAt(launch.launchDate),
  status: LAUNCH_STATUS_VALUES[launch.status],
  outcome:
    launch.outcome === null ? null : QUALIFIER_OUTCOME_VALUES[launch.outcome],
  summary,
});

export const toLaunchDateWindow = (
  window: LaunchDateWindow,
): LaunchDateWindowModel => ({
  earliest: window.earliest,
  latest: window.latest,
  unavailable: window.unavailable.map((range) => ({
    from: range.from,
    to: range.to,
    reason: UNAVAILABLE_REASON_VALUES[range.reason],
  })),
  relaunchIntervalDays: window.relaunchIntervalDays,
});

export const toProductLaunchPlan = (
  state: ProductState,
): ProductLaunchPlanModel => {
  const { plan, locks } = state;
  return {
    mode: PLAN_MODE_VALUES[plan.mode],
    currentLaunchDate: plan.mode === 'reschedule' ? plan.current : null,
    window: state.window === null ? null : toLaunchDateWindow(state.window),
    blocks:
      plan.mode === 'blocked'
        ? plan.blocks.map(({ code, message, releaseAt }) => ({
            code,
            message,
            releaseAt,
          }))
        : [],
    locked: locks.locked,
    locks: locks.locks.map(({ code, message }) => ({ code, message })),
    lockUnknown: locks.unknown,
    ultrasEntitled: state.ultrasEntitled,
  };
};

export const toMyProduct = (view: MyProductView): MyProductModel => ({
  handle: view.handle,
  previousHandle: view.previousHandle,
  name: view.name,
  tagline: view.tagline,
  category: toProductCategory(view.category),
  websiteUrl: view.websiteUrl,
  description: view.descriptionMarkdown,
  logoFileId: view.logoFileId,
  screenshots: view.screenshotFileIds.map((fileId) => ({ fileId })),
  hidden: view.hidden,
  listed: view.listed,
  version: view.version,
  latestLaunch:
    view.state.latestLaunch === null
      ? null
      : toProductLaunch(view.state.latestLaunch),
  plan: toProductLaunchPlan(view.state),
});

export const toProductOwnerStatus = (
  status: MyProductOwnerStatus,
): ProductOwnerStatusModel => ({
  latestLaunch:
    status.latestLaunch === null ? null : toProductLaunch(status.latestLaunch),
  plan: toProductLaunchPlan(status.state),
});
