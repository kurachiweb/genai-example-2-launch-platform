import type { ServiceIdentifier } from 'inversify';

import {
  assertDecisionSourceRegistrations,
  type DecisionSourceRegistration,
  type RegisteredDecisionSource,
  resolveDecisionSources,
} from '../product/decision-sources.ts';

export type TrophyKind = 'week' | 'year';

export interface TrophyRecord {
  readonly kind: TrophyKind;
  // '2026-W37'・'2026'
  readonly period: string;
  // '2026年第37週(9/7〜9/13)'・'2026年'
  readonly periodLabel: string;
  readonly awardedAt: Date;
  // '/tournaments/week/2026-W37'
  readonly bracketPath: string | null;
}

export interface TrophySource {
  // そのプロダクトの受賞だけを返す。順は問わない
  listTrophies(productId: string): Promise<readonly TrophyRecord[]>;
}

export type TrophySourceRegistration = DecisionSourceRegistration<TrophySource>;

export type RegisteredTrophySource = RegisteredDecisionSource<TrophySource>;

const TROPHY_SOURCE_LABEL = 'トロフィーの供給元';

export function assertTrophySourceRegistrations(
  registrations: readonly TrophySourceRegistration[],
): void {
  assertDecisionSourceRegistrations(registrations, TROPHY_SOURCE_LABEL);
}

export function resolveTrophySources(
  registrations: readonly TrophySourceRegistration[],
  resolve: (identifier: ServiceIdentifier<TrophySource>) => TrophySource,
): readonly RegisteredTrophySource[] {
  assertTrophySourceRegistrations(registrations);
  return resolveDecisionSources(registrations, resolve);
}
