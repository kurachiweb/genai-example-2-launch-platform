import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';

export interface LegalVersionSnapshot {
  readonly versionNumber: number;
  readonly body: string;
  readonly publishedAt: Date;
}

export interface LegalDraftSnapshot {
  readonly body: string;
  readonly savedAt: Date;
  readonly savedByAdminId: string;
}

export interface LegalDocumentState {
  readonly kind: LegalDocumentKind;
  readonly stateVersion: number;
  readonly latest: LegalVersionSnapshot | null;
  readonly draft: LegalDraftSnapshot | null;
}

export type LegalDocumentDenial = 'stale' | 'no_draft' | 'unchanged';

const FIRST_VERSION_NUMBER = 1;

// 改訂の日時から版を一意に特定できるよう、公開日時を版番号の順に厳密に増やす最小の間隔
const MIN_PUBLISHED_AT_STEP_MS = 1;

export const checkDraftWritable = (
  state: LegalDocumentState,
  expectedStateVersion: number,
): 'stale' | undefined =>
  state.stateVersion === expectedStateVersion ? undefined : 'stale';

export const checkDraftDiscardable = (
  state: LegalDocumentState,
  expectedStateVersion: number,
): 'stale' | 'no_draft' | undefined => {
  if (checkDraftWritable(state, expectedStateVersion) !== undefined) {
    return 'stale';
  }
  return state.draft === null ? 'no_draft' : undefined;
};

export const checkPublishable = (
  state: LegalDocumentState,
  expectedStateVersion: number,
): LegalDocumentDenial | undefined => {
  const denial = checkDraftDiscardable(state, expectedStateVersion);
  if (denial !== undefined) {
    return denial;
  }
  return state.latest !== null && state.draft?.body === state.latest.body
    ? 'unchanged'
    : undefined;
};

export const nextVersionNumber = (state: LegalDocumentState): number =>
  state.latest === null ? FIRST_VERSION_NUMBER : state.latest.versionNumber + 1;

export const nextPublishedAt = (
  now: Date,
  latestPublishedAt: Date | null,
): Date =>
  new Date(
    latestPublishedAt === null
      ? now.getTime()
      : Math.max(
          now.getTime(),
          latestPublishedAt.getTime() + MIN_PUBLISHED_AT_STEP_MS,
        ),
  );
