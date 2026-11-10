import type {
  CurrentUser,
  UserAccountView,
} from '../../../../lib/core/identity/account-guard.ts';
import type {
  UpvoteApplyInput,
  UpvoteCancelInput,
  UpvoteState,
  UpvoteStore,
  UpvoteWriteResult,
} from '../ports.ts';

export const VOTER_ID = '01JC0USER00000000000000003';
export const OWNER_A_ID = '01JC0USER00000000000000001';
export const OWNER_B_ID = '01JC0USER00000000000000002';
export const MATCH_ID = '01JF0MATCH0000000000000001';
export const ENTRY_A_ID = '01JF0ENTRY0000000000000011';
export const ENTRY_B_ID = '01JF0ENTRY0000000000000012';
export const UPVOTE_ID = '01JF0UPVOTE000000000000001';
export const UPVOTE_NOW = new Date('2027-03-02T12:00:00.000Z');

export const voterOf = (
  overrides: Partial<UserAccountView> = {},
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: overrides.id ?? VOTER_ID,
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: VOTER_ID,
    pseudonymousId: '01JC0PSEUDO000000000000003',
    status: 'active',
    emailVerifiedAt: new Date('2027-03-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'voter@mail.example',
    nickname: 'サポーター',
    handle: 'voter',
    ...overrides,
  },
});

export const upvoteStateOf = (
  overrides: Partial<UpvoteState> = {},
): UpvoteState => ({
  matchId: MATCH_ID,
  phase: 'live',
  entryIds: [ENTRY_A_ID, ENTRY_B_ID],
  ownerUserIds: [OWNER_A_ID, OWNER_B_ID],
  currentEntryId: null,
  ...overrides,
});

export interface FakeUpvoteStoreOptions {
  // findStateが呼ばれた順に返す状態。尽きたら最後の値を返し続ける
  readonly states?: readonly (UpvoteState | undefined)[];
  readonly applyResult?: UpvoteWriteResult;
  readonly cancelResult?: 'cancelled' | 'nothing';
}

export interface FakeUpvoteStore extends UpvoteStore {
  readonly calls: string[];
  readonly stateQueries: {
    readonly matchId: string;
    readonly userId: string;
    readonly now: Date;
  }[];
  readonly applied: UpvoteApplyInput[];
  readonly cancelled: UpvoteCancelInput[];
}

export function createFakeUpvoteStore(
  options: FakeUpvoteStoreOptions = {},
): FakeUpvoteStore {
  const states = options.states ?? [upvoteStateOf()];
  const calls: string[] = [];
  const stateQueries: FakeUpvoteStore['stateQueries'] = [];
  const applied: UpvoteApplyInput[] = [];
  const cancelled: UpvoteCancelInput[] = [];
  return {
    calls,
    stateQueries,
    applied,
    cancelled,
    findState(matchId, userId, now) {
      calls.push('findState');
      const index = Math.min(stateQueries.length, states.length - 1);
      stateQueries.push({ matchId, userId, now });
      return Promise.resolve(states[index]);
    },
    apply(input) {
      calls.push('apply');
      applied.push(input);
      return Promise.resolve(options.applyResult ?? 'applied');
    },
    cancel(input) {
      calls.push('cancel');
      cancelled.push(input);
      return Promise.resolve(options.cancelResult ?? 'cancelled');
    },
  };
}
