import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { UpvoteState } from './ports.ts';
import {
  createFakeUpvoteStore,
  ENTRY_A_ID,
  ENTRY_B_ID,
  type FakeUpvoteStoreOptions,
  MATCH_ID,
  OWNER_B_ID,
  UPVOTE_ID,
  UPVOTE_NOW,
  upvoteStateOf,
  VOTER_ID,
  voterOf,
} from './testing/upvote-fakes.ts';
import { StoreUpvoteService } from './upvote-service.ts';

function setup(options: FakeUpvoteStoreOptions = {}) {
  const store = createFakeUpvoteStore(options);
  const service = new StoreUpvoteService(store, {
    generate: () => UPVOTE_ID,
  });
  return { store, service };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

const upvoteInput = (entryId = ENTRY_A_ID, user = voterOf()) => ({
  user,
  matchId: MATCH_ID,
  entryId,
  now: UPVOTE_NOW,
});

const cancelInput = () => ({
  user: voterOf(),
  matchId: MATCH_ID,
  now: UPVOTE_NOW,
});

const NOT_LIVE_PHASES: readonly UpvoteState['phase'][] = [
  'scheduled',
  'tallying',
  'finished',
];

describe('StoreUpvoteService.upvote', () => {
  test('有効なUpvoteが無ければ、利用者・要求の時刻・新しいIDで指定の側への追加を書き込む', async () => {
    const { store, service } = setup();

    await service.upvote(upvoteInput());

    expect(store.calls).toEqual(['findState', 'apply']);
    expect(store.stateQueries).toEqual([
      { matchId: MATCH_ID, userId: VOTER_ID, now: UPVOTE_NOW },
    ]);
    expect(store.applied).toEqual([
      {
        action: { kind: 'insert', entryId: ENTRY_A_ID },
        matchId: MATCH_ID,
        userId: VOTER_ID,
        upvoteId: UPVOTE_ID,
        now: UPVOTE_NOW,
      },
    ]);
  });

  test('もう一方の側にUpvote済みなら、元の側から指定の側への付け替えを書き込む', async () => {
    const { store, service } = setup({
      states: [upvoteStateOf({ currentEntryId: ENTRY_A_ID })],
    });

    await service.upvote(upvoteInput(ENTRY_B_ID));

    expect(store.applied.map((input) => input.action)).toEqual([
      { kind: 'switch', fromEntryId: ENTRY_A_ID, toEntryId: ENTRY_B_ID },
    ]);
  });

  test('既に同じ側にUpvote済みなら、書き込まずに成功する', async () => {
    const { store, service } = setup({
      states: [upvoteStateOf({ currentEntryId: ENTRY_A_ID })],
    });

    await service.upvote(upvoteInput(ENTRY_A_ID));

    expect(store.calls).toEqual(['findState']);
  });

  test('書き込みが同時の別の要求と重なりduplicateになっても、読み直さずに成功する', async () => {
    const { store, service } = setup({ applyResult: 'duplicate' });

    await service.upvote(upvoteInput());

    expect(store.calls).toEqual(['findState', 'apply']);
  });

  test('マッチが無ければmatch_not_found(404)で拒否し、書き込まない', async () => {
    const { store, service } = setup({ states: [undefined] });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('match_not_found');
    expect(error.kind).toBe('not_found');
    expect(store.calls).toEqual(['findState']);
  });

  test('指定の側がマッチのものでなければ、受け付け中かどうかより先にvalidation_error(400)で拒否する', async () => {
    const { store, service } = setup({
      states: [upvoteStateOf({ phase: 'scheduled' })],
    });

    const error = await rejectionOf(
      service.upvote(upvoteInput('01JF0ENTRY0000000000000099')),
    );

    expect(error.code).toBe('validation_error');
    expect(error.kind).toBe('bad_request');
    expect(error.details).toEqual([
      {
        field: 'entryId',
        code: 'custom',
        message:
          'マッチが見つかりませんでした。ページを再読み込みしてください。',
      },
    ]);
    expect(store.calls).toEqual(['findState']);
  });

  test.each(NOT_LIVE_PHASES)(
    'マッチが%sならupvote_not_accepting(409)で拒否し、書き込まない',
    async (phase) => {
      const { store, service } = setup({ states: [upvoteStateOf({ phase })] });

      const error = await rejectionOf(service.upvote(upvoteInput()));

      expect(error.code).toBe('upvote_not_accepting');
      expect(error.kind).toBe('conflict');
      expect(store.calls).toEqual(['findState']);
    },
  );

  test('受け付け中でないことを、自分のマッチであることより先に分類する', async () => {
    const { service } = setup({
      states: [
        upvoteStateOf({
          phase: 'tallying',
          ownerUserIds: [VOTER_ID, OWNER_B_ID],
        }),
      ],
    });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('upvote_not_accepting');
  });

  test.each([
    ['自分のプロダクトの側', ENTRY_A_ID],
    ['自分のプロダクトの対戦相手の側', ENTRY_B_ID],
  ])(
    '%sへのUpvoteはupvote_own_match(403)で拒否し、書き込まない',
    async (_label, entryId) => {
      const { store, service } = setup({
        states: [
          upvoteStateOf({
            ownerUserIds: [VOTER_ID, OWNER_B_ID],
          }),
        ],
      });

      const error = await rejectionOf(service.upvote(upvoteInput(entryId)));

      expect(error.code).toBe('upvote_own_match');
      expect(error.kind).toBe('forbidden');
      expect(store.calls).toEqual(['findState']);
    },
  );

  test('紐付けを解除した側(投稿者がnull)があっても、自分のマッチとは扱わない', async () => {
    const { store, service } = setup({
      states: [upvoteStateOf({ ownerUserIds: [null, OWNER_B_ID] })],
    });

    await service.upvote(upvoteInput());

    expect(store.calls).toEqual(['findState', 'apply']);
  });

  test.each([
    ['停止中', { status: 'suspended' }, 'account_unavailable', 'forbidden'],
    [
      '退会済み',
      { deletedAt: new Date('2027-03-02T00:00:00.000Z') },
      'account_unavailable',
      'forbidden',
    ],
    [
      'メールアドレスが未確認',
      { emailVerifiedAt: null },
      'email_not_verified',
      'forbidden',
    ],
  ] as const)(
    '引数の利用者が%sなら%s(%s)で拒否し、書き込まない',
    async (_label, overrides, code, kind) => {
      const { store, service } = setup();

      const error = await rejectionOf(
        service.upvote(upvoteInput(ENTRY_A_ID, voterOf(overrides))),
      );

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(store.calls).toEqual(['findState']);
    },
  );

  test('書き込みが拒否され、読み直すと受け付け中でなくなっていればupvote_not_acceptingにする', async () => {
    const { store, service } = setup({
      states: [upvoteStateOf(), upvoteStateOf({ phase: 'tallying' })],
      applyResult: 'rejected',
    });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('upvote_not_accepting');
    expect(store.calls).toEqual(['findState', 'apply', 'findState']);
    expect(store.stateQueries[1]).toEqual({
      matchId: MATCH_ID,
      userId: VOTER_ID,
      now: UPVOTE_NOW,
    });
  });

  test('書き込みが拒否され、読み直すと確定していればupvote_not_acceptingにする', async () => {
    const { service } = setup({
      states: [upvoteStateOf(), upvoteStateOf({ phase: 'finished' })],
      applyResult: 'rejected',
    });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('upvote_not_accepting');
  });

  test('書き込みが拒否され、読み直すとマッチが無くなっていればmatch_not_foundにする', async () => {
    const { service } = setup({
      states: [upvoteStateOf(), undefined],
      applyResult: 'rejected',
    });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('match_not_found');
  });

  test('書き込みが拒否され、読み直すと自分のマッチになっていればupvote_own_matchにする', async () => {
    const { service } = setup({
      states: [
        upvoteStateOf(),
        upvoteStateOf({ ownerUserIds: [VOTER_ID, null] }),
      ],
      applyResult: 'rejected',
    });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('upvote_own_match');
  });

  test('書き込みが拒否され、読み直してもマッチの条件に当たらなければ、利用者の状態の変化としてaccount_unavailableにする', async () => {
    const { service } = setup({ applyResult: 'rejected' });

    const error = await rejectionOf(service.upvote(upvoteInput()));

    expect(error.code).toBe('account_unavailable');
    expect(error.message).toBe(
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    );
  });
});

describe('StoreUpvoteService.cancel', () => {
  test('有効なUpvoteを、利用者と要求の時刻で取り消し、読み直さずに成功する', async () => {
    const { store, service } = setup({ cancelResult: 'cancelled' });

    await service.cancel(cancelInput());

    expect(store.calls).toEqual(['cancel']);
    expect(store.cancelled).toEqual([
      { matchId: MATCH_ID, userId: VOTER_ID, now: UPVOTE_NOW },
    ]);
  });

  test('受け付け中のマッチに有効なUpvoteが無ければ、読み直して成功として扱う', async () => {
    const { store, service } = setup({ cancelResult: 'nothing' });

    await service.cancel(cancelInput());

    expect(store.calls).toEqual(['cancel', 'findState']);
    expect(store.stateQueries).toEqual([
      { matchId: MATCH_ID, userId: VOTER_ID, now: UPVOTE_NOW },
    ]);
  });

  test.each(NOT_LIVE_PHASES)(
    '取り消せず、読み直すとマッチが%sならupvote_not_accepting(409)で拒否する',
    async (phase) => {
      const { service } = setup({
        cancelResult: 'nothing',
        states: [upvoteStateOf({ phase, currentEntryId: ENTRY_A_ID })],
      });

      const error = await rejectionOf(service.cancel(cancelInput()));

      expect(error.code).toBe('upvote_not_accepting');
      expect(error.kind).toBe('conflict');
    },
  );

  test('取り消せず、読み直すとマッチが無ければmatch_not_found(404)で拒否する', async () => {
    const { service } = setup({ cancelResult: 'nothing', states: [undefined] });

    const error = await rejectionOf(service.cancel(cancelInput()));

    expect(error.code).toBe('match_not_found');
  });
});
