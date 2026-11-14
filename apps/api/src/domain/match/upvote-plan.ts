import type { MatchPhase } from '../../../lib/core/match/match-model.ts';

export type UpvoteAction =
  | { readonly kind: 'insert'; readonly entryId: string }
  | {
      readonly kind: 'switch';
      readonly fromEntryId: string;
      readonly toEntryId: string;
    }
  | { readonly kind: 'none' };

export interface UpvoteTarget {
  readonly currentEntryId: string | null;
  readonly targetEntryId: string;
}

export function decideUpvote(input: UpvoteTarget): UpvoteAction {
  if (input.currentEntryId === null) {
    return { kind: 'insert', entryId: input.targetEntryId };
  }
  if (input.currentEntryId === input.targetEntryId) {
    return { kind: 'none' };
  }
  return {
    kind: 'switch',
    fromEntryId: input.currentEntryId,
    toEntryId: input.targetEntryId,
  };
}

export type UpvoteRestriction =
  | 'guest'
  | 'email_not_verified'
  | 'account_unavailable'
  | 'own_match'
  | 'not_accepting';

export interface UpvoteViewer {
  readonly userId: string;
  readonly emailVerified: boolean;
  // 停止中・退会済みでなく書き込める
  readonly writable: boolean;
}

export interface UpvoteRestrictionInput {
  readonly viewer: UpvoteViewer | null;
  readonly phase: MatchPhase;
  // 紐付けを解除した側はnull
  readonly ownerUserIds: readonly (string | null)[];
}

export function viewerRestriction(
  input: UpvoteRestrictionInput,
): UpvoteRestriction | null {
  if (input.phase !== 'live') {
    return 'not_accepting';
  }
  const { viewer } = input;
  if (viewer === null) {
    return 'guest';
  }
  if (!viewer.writable) {
    return 'account_unavailable';
  }
  if (!viewer.emailVerified) {
    return 'email_not_verified';
  }
  if (input.ownerUserIds.includes(viewer.userId)) {
    return 'own_match';
  }
  return null;
}
