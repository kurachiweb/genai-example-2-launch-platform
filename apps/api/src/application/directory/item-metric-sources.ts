import type { ServiceIdentifier } from 'inversify';

import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  assertDecisionSourceRegistrations,
  type DecisionSourceRegistration,
  type RegisteredDecisionSource,
} from '../product/decision-sources.ts';

export interface DirectoryItemMetricSource {
  // 値のあるプロダクトだけを返す(productId → 値)
  metrics(input: {
    readonly productIds: readonly string[];
    readonly at: Date;
  }): Promise<ReadonlyMap<string, number>>;
}

export interface DirectoryItemMetricRegistration extends DecisionSourceRegistration<DirectoryItemMetricSource> {
  // '<名詞>'(例: 'comments')。画面の項目の値の登録のkeyと一致させる
  readonly key: string;
}

export interface RegisteredItemMetricSource extends RegisteredDecisionSource<DirectoryItemMetricSource> {
  readonly key: string;
}

const ITEM_METRIC_SOURCE_LABEL = '一覧の項目の値の供給元';

const ITEM_METRIC_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertItemMetricRegistrations(
  registrations: readonly DirectoryItemMetricRegistration[],
): void {
  assertDecisionSourceRegistrations(registrations, ITEM_METRIC_SOURCE_LABEL);
  const keys = new Map<string, string>();
  for (const { key, name } of registrations) {
    if (!ITEM_METRIC_KEY_PATTERN.test(key)) {
      throw new LifecycleRegistrationError(
        `${ITEM_METRIC_SOURCE_LABEL}${JSON.stringify(name)}のkeyは小文字の英数字とハイフンで指定してください: ${JSON.stringify(key)}`,
      );
    }
    const colliding = keys.get(key);
    if (colliding !== undefined) {
      throw new LifecycleRegistrationError(
        `${ITEM_METRIC_SOURCE_LABEL}${JSON.stringify(colliding)}と${JSON.stringify(name)}のkeyが重複しています: ${JSON.stringify(key)}`,
      );
    }
    keys.set(key, name);
  }
}

export function resolveItemMetricSources(
  registrations: readonly DirectoryItemMetricRegistration[],
  resolve: (
    identifier: ServiceIdentifier<DirectoryItemMetricSource>,
  ) => DirectoryItemMetricSource,
): readonly RegisteredItemMetricSource[] {
  assertItemMetricRegistrations(registrations);
  return Object.freeze(
    registrations
      .toSorted((left, right) => left.order - right.order)
      .map(({ name, key, source }) =>
        Object.freeze({ name, key, source: resolve(source) }),
      ),
  );
}
