import { isSameHandle } from '../../../common-lib/handles/handle-rules.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { LaunchPlan } from './launch-plan.ts';

export type HandleChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'case-only'; readonly next: string }
  | {
      readonly kind: 'changed';
      readonly next: string;
      readonly previous: string;
    };

export type LogoChange =
  | { readonly kind: 'keep' }
  | {
      readonly kind: 'replace';
      readonly fileId: string;
      readonly replaced: string;
    };

export interface ScreenshotChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly order: readonly string[];
}

export type LaunchChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'reserve'; readonly date: BusinessDate }
  | {
      readonly kind: 'reschedule';
      readonly launchId: string;
      readonly date: BusinessDate;
    };

export interface ProductEditPlan {
  readonly handle: HandleChange;
  readonly logo: LogoChange;
  readonly screenshots: ScreenshotChange;
  readonly categoryChanged: boolean;
  readonly launch: LaunchChange;
}

export interface ProductEditState {
  readonly handle: string;
  readonly logoFileId: string;
  readonly screenshotFileIds: readonly string[];
  readonly categoryId: string;
}

export interface ProductEditInput extends ProductEditState {
  // nullはローンチを変えない。予約の取りやめは入力の形として持たない
  readonly launchDate: BusinessDate | null;
}

export interface LaunchNotAllowed {
  readonly error: 'launch-not-allowed';
}

const planHandleChange = (current: string, next: string): HandleChange => {
  if (current === next) {
    return { kind: 'none' };
  }
  if (isSameHandle(current, next)) {
    return { kind: 'case-only', next };
  }
  return { kind: 'changed', next, previous: current };
};

const planLogoChange = (current: string, next: string): LogoChange =>
  current === next
    ? { kind: 'keep' }
    : { kind: 'replace', fileId: next, replaced: current };

const planScreenshotChange = (
  current: readonly string[],
  next: readonly string[],
): ScreenshotChange => {
  const currentIds = new Set(current);
  const nextIds = new Set(next);
  return {
    added: next.filter((id) => !currentIds.has(id)),
    removed: current.filter((id) => !nextIds.has(id)),
    order: [...next],
  };
};

const planLaunchChange = (
  date: BusinessDate | null,
  plan: LaunchPlan,
): LaunchChange | LaunchNotAllowed => {
  if (date === null) {
    return { kind: 'none' };
  }
  if (plan.mode === 'new') {
    return { kind: 'reserve', date };
  }
  if (plan.mode === 'reschedule') {
    return date === plan.current
      ? { kind: 'none' }
      : { kind: 'reschedule', launchId: plan.launchId, date };
  }
  return { error: 'launch-not-allowed' };
};

export function planProductEdit(
  current: ProductEditState,
  input: ProductEditInput,
  plan: LaunchPlan,
): ProductEditPlan | LaunchNotAllowed {
  const launch = planLaunchChange(input.launchDate, plan);
  if ('error' in launch) {
    return launch;
  }
  return {
    handle: planHandleChange(current.handle, input.handle),
    logo: planLogoChange(current.logoFileId, input.logoFileId),
    screenshots: planScreenshotChange(
      current.screenshotFileIds,
      input.screenshotFileIds,
    ),
    categoryChanged: current.categoryId !== input.categoryId,
    launch,
  };
}
