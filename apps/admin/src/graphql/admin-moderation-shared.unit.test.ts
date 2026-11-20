import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
  unavailableResponse,
} from '../../test/moderation-graphql-api.ts';
import {
  moderationActionOptions,
  toAdminMediaFile,
  toAdminUserSummary,
  toModerationNote,
  toModerationPage,
} from './admin-moderation-shared.ts';
import { AdminSuspendUserDocument } from './generated/graphql.ts';

const FILE_ID = '01JC0FILE00000000000000001';
const USER_ID = '01JC0USER00000000000000001';

describe('toModerationPage', () => {
  test('続きがあれば最後の項目のカーソルを続きのカーソルにし、項目を順に写す', () => {
    expect(
      toModerationPage(
        {
          nodes: [{ n: 1 }, { n: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
        },
        ({ n }) => n * 10,
      ),
    ).toStrictEqual({ items: [10, 20], nextCursor: 'cursor-2' });
  });

  test('続きが無い・カーソルが無いときは続きのカーソルをnullにし、空の一覧は空のままにする', () => {
    const toItem = (node: number) => node;

    expect(
      toModerationPage(
        { nodes: [1], pageInfo: { hasNextPage: false, endCursor: 'cursor-1' } },
        toItem,
      ),
    ).toStrictEqual({ items: [1], nextCursor: null });
    expect(
      toModerationPage(
        { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
        toItem,
      ),
    ).toStrictEqual({ items: [], nextCursor: null });
  });
});

describe('toModerationNote', () => {
  test('理由と日時を写し、理由の無い措置はnull、措置が無ければnullにする', () => {
    expect(
      toModerationNote({
        reason: 'スパムの投稿',
        occurredAt: '2026-11-20T01:00:00.000Z',
      }),
    ).toStrictEqual({
      reason: 'スパムの投稿',
      occurredAt: '2026-11-20T01:00:00.000Z',
    });
    expect(
      toModerationNote({
        reason: null,
        occurredAt: '2026-11-20T01:00:00.000Z',
      }),
    ).toStrictEqual({ reason: null, occurredAt: '2026-11-20T01:00:00.000Z' });
    expect(toModerationNote(null)).toBeNull();
  });
});

describe('toAdminMediaFile', () => {
  test('GraphQLの大文字の隔離理由を、表示名を引く共用部品の値へ写す', () => {
    expect(
      toAdminMediaFile({
        id: FILE_ID,
        path: `/media/files/${FILE_ID}`,
        quarantined: true,
        quarantineReasons: [
          'AUTO',
          'PRODUCT_HIDDEN',
          'USER_SUSPENDED',
          'ADMIN_ACTION',
        ],
      }),
    ).toStrictEqual({
      id: FILE_ID,
      path: `/media/files/${FILE_ID}`,
      quarantined: true,
      quarantineReasons: [
        'auto',
        'product_hidden',
        'user_suspended',
        'admin_action',
      ],
    });
  });

  test('画像が無ければnull、隔離理由の無い画像は空の一覧にする', () => {
    expect(toAdminMediaFile(null)).toBeNull();
    expect(
      toAdminMediaFile({
        id: FILE_ID,
        path: `/media/files/${FILE_ID}`,
        quarantined: false,
        quarantineReasons: [],
      }).quarantineReasons,
    ).toStrictEqual([]);
  });
});

describe('toAdminUserSummary', () => {
  test('利用者の表示を写し、表示できない利用者はnullにする', () => {
    expect(
      toAdminUserSummary({
        id: USER_ID,
        handle: 'maker_ai',
        nickname: 'メーカーAI',
        suspended: true,
      }),
    ).toStrictEqual({
      id: USER_ID,
      handle: 'maker_ai',
      nickname: 'メーカーAI',
      suspended: true,
    });
    expect(toAdminUserSummary(null)).toBeNull();
  });
});

describe('moderationActionOptions', () => {
  const options = moderationActionOptions({
    document: AdminSuspendUserDocument,
    variablesOf: ({ targetId, reason }) => ({ id: targetId, reason }),
    outcomeOf: ({ suspendUser }) => suspendUser,
  });

  test('変更のキーを操作の識別子にする', () => {
    expect(options.mutationKey).toStrictEqual([
      documentIdOf(AdminSuspendUserDocument),
    ]);
  });

  test('対象と理由を操作の変数にして実行し、変化の有無だけを返す', async () => {
    const { result, sent } = await runThroughApi(
      () =>
        options.mutationFn({
          variables: { targetId: USER_ID, reason: '規約違反' },
        }),
      dataResponse({ suspendUser: { changed: false } }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminSuspendUserDocument),
        variables: { id: USER_ID, reason: '規約違反' },
      },
    ]);
    expect(result).toStrictEqual({ changed: false });
  });

  test('失敗はGraphQLClientErrorの例外にする', async () => {
    const { result } = await runThroughApi(
      () =>
        options
          .mutationFn({ variables: { targetId: USER_ID, reason: '規約違反' } })
          .catch((error: unknown) => error),
      unavailableResponse,
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
  });
});
