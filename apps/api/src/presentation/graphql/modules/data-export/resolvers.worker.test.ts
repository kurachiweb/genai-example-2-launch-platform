import { describe, expect, test } from 'vitest';

import {
  daysAfter,
  expiredColumnsOf,
  failedColumnsOf,
  readyColumnsOf,
  seed,
  T0,
} from '../../../../../lib/workers/data-export/testing/data-export-fixtures.ts';
import { encodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import {
  codesOf,
  detailsOf,
  elapseRequestWindow,
  exportIdOf,
  exportRowOf,
  fetchMyDataExports,
  fetchMyDataExportsDefaultPage,
  freshExportUser,
  installDataExportGraphQLTest,
  issueUserSession,
  readExportRowsOf,
  readPublishedMessages,
  requestDataExport,
  verifyEmail,
} from '../../../../../test/support/data-export-graphql-operations.ts';

installDataExportGraphQLTest();

const SECONDS_PER_DAY = 86_400;

const PAGE_SIZE_MESSAGE = '表示する件数は1〜20件の整数で指定してください。';

const SUSPENDED_COLUMNS = {
  emailVerifiedAt: T0,
  status: 'suspended',
  suspendedAt: T0,
} as const;

async function sessionOf(userIndex: number) {
  return { sessionToken: await issueUserSession(userIndex) };
}

async function adminSessionOf(userIndex: number) {
  return {
    caller: 'admin',
    sessionToken: await issueUserSession(userIndex),
  } as const;
}

const hoursFromNow = (hours: number): Date =>
  new Date(Date.now() + hours * 3_600_000);

describe('requestDataExport', () => {
  test('受け付けた要求を作成中の状態で返し、記録を作って生成の依頼と7,200秒後の見張りを送る', async () => {
    const user = await freshExportUser();

    const response = await requestDataExport(await sessionOf(user));

    expect(response.status).toBe(200);
    expect(response.errors).toBeUndefined();
    const rows = await readExportRowsOf(user);
    expect(rows).toHaveLength(1);
    expect(response.data?.requestDataExport).toEqual({
      id: rows[0]?.id,
      status: 'PENDING',
      requestedAt: rows[0]?.requestedAt.toISOString(),
      completedAt: null,
      expiresAt: null,
      failedAt: null,
      failureKind: null,
      fileName: null,
      byteSize: null,
      downloadPath: null,
    });
    expect(rows[0]).toMatchObject({ status: 'queued' });
    expect(readPublishedMessages()).toEqual([
      {
        type: 'data-export.generate-archive',
        body: { exportId: rows[0]?.id },
        delaySeconds: undefined,
      },
      {
        type: 'data-export.check-generation',
        body: { exportId: rows[0]?.id },
        delaySeconds: 7200,
      },
    ]);
  });

  test('同じ利用者の3回目まで受け付け、4回目は429のrate_limit_exceededと再試行までの秒数で拒否して記録を作らない', async () => {
    const user = await freshExportUser();
    const session = await sessionOf(user);

    const accepted = [];
    for (let count = 0; count < 3; count += 1) {
      accepted.push(await requestDataExport(session));
    }
    const rejected = await requestDataExport(session);

    expect(accepted.map((response) => codesOf(response))).toEqual([[], [], []]);
    expect(rejected.status).toBe(429);
    expect(codesOf(rejected)).toEqual(['rate_limit_exceeded']);
    const retryAfter = Number(rejected.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(SECONDS_PER_DAY);
    expect(await readExportRowsOf(user)).toHaveLength(3);
    expect(readPublishedMessages()).toHaveLength(6);
  });

  test('厳密カウンタのアラームで期間が終わった後は、再び受け付ける', async () => {
    const user = await freshExportUser();
    const session = await sessionOf(user);
    for (let count = 0; count < 3; count += 1) {
      await requestDataExport(session);
    }
    expect(codesOf(await requestDataExport(session))).toEqual([
      'rate_limit_exceeded',
    ]);

    await elapseRequestWindow(user);
    const again = await requestDataExport(session);

    expect(codesOf(again)).toEqual([]);
    expect(again.data?.requestDataExport?.status).toBe('PENDING');
    expect(await readExportRowsOf(user)).toHaveLength(4);
  });

  test('別の利用者の回数は別に数える', async () => {
    const first = await freshExportUser();
    const second = await freshExportUser();
    for (let count = 0; count < 3; count += 1) {
      await requestDataExport(await sessionOf(first));
    }

    const response = await requestDataExport(await sessionOf(second));

    expect(codesOf(response)).toEqual([]);
  });

  test('メールアドレスが未確認の利用者は403のemail_not_verifiedで拒否し、記録も送信も回数の消費も無い', async () => {
    const user = await freshExportUser({ emailVerifiedAt: null });
    const session = await sessionOf(user);

    const response = await requestDataExport(session);

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(await readExportRowsOf(user)).toEqual([]);
    expect(readPublishedMessages()).toEqual([]);
    await verifyEmail(user);
    for (let count = 0; count < 3; count += 1) {
      expect(codesOf(await requestDataExport(session))).toEqual([]);
    }
  });

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await requestDataExport();

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(readPublishedMessages()).toEqual([]);
  });

  test('停止中の利用者も受け付ける', async () => {
    const user = await freshExportUser(SUSPENDED_COLUMNS);

    const response = await requestDataExport(await sessionOf(user));

    expect(codesOf(response)).toEqual([]);
    expect(response.data?.requestDataExport?.status).toBe('PENDING');
    expect(await readExportRowsOf(user)).toHaveLength(1);
  });

  test('管理者側の呼び出し元はforbiddenで拒否し、記録も送信も回数の消費も無い', async () => {
    const user = await freshExportUser();

    const response = await requestDataExport(await adminSessionOf(user));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readExportRowsOf(user)).toEqual([]);
    expect(readPublishedMessages()).toEqual([]);
    for (let count = 0; count < 3; count += 1) {
      expect(codesOf(await requestDataExport(await sessionOf(user)))).toEqual(
        [],
      );
    }
  });

  test('作成中の要求があっても新しい要求を受け付け、並行した要求も別々の記録にする', async () => {
    const user = await freshExportUser();
    await seed([
      exportRowOf(1, user),
      exportRowOf(2, user, { status: 'generating' }),
    ]);
    const session = await sessionOf(user);

    const responses = await Promise.all([
      requestDataExport(session),
      requestDataExport(session),
    ]);

    expect(responses.map((response) => codesOf(response))).toEqual([[], []]);
    const ids = responses.map(
      (response) => response.data?.requestDataExport?.id,
    );
    expect(new Set(ids).size).toBe(2);
    expect(await readExportRowsOf(user)).toHaveLength(4);
  });
});

describe('myDataExports', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await fetchMyDataExports({ first: 20 });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('管理者側の呼び出し元はforbiddenで拒否する', async () => {
    const user = await freshExportUser();

    const response = await fetchMyDataExports(
      { first: 20 },
      await adminSessionOf(user),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('本人の要求だけを新しい順に、表示の状態・日時・ファイル名・大きさ・ダウンロードのパスと合わせて返す', async () => {
    const user = await freshExportUser();
    const other = await freshExportUser();
    const readyExpiresAt = hoursFromNow(48);
    const lapsedExpiresAt = hoursFromNow(-1);
    await seed([
      exportRowOf(1, user, { status: 'generating' }),
      exportRowOf(2, user, readyColumnsOf(readyExpiresAt)),
      exportRowOf(3, user, expiredColumnsOf()),
      exportRowOf(4, user, failedColumnsOf()),
      exportRowOf(5, user, {
        ...failedColumnsOf(),
        failureKind: 'too_large',
      }),
      exportRowOf(6, user, {
        ...readyColumnsOf(lapsedExpiresAt),
        byteSize: 4_000_000_000,
      }),
      exportRowOf(7, other, readyColumnsOf(readyExpiresAt)),
    ]);

    const response = await fetchMyDataExports(
      { first: 20 },
      await sessionOf(user),
    );

    expect(response.errors).toBeUndefined();
    const requestedAt = (index: number) =>
      new Date(T0.getTime() + index * 60_000).toISOString();
    const empty = {
      completedAt: null,
      expiresAt: null,
      failedAt: null,
      failureKind: null,
      fileName: null,
      byteSize: null,
      downloadPath: null,
    };
    expect(response.data?.myDataExports).toEqual({
      nodes: [
        {
          ...empty,
          id: exportIdOf(6),
          status: 'EXPIRED',
          requestedAt: requestedAt(6),
          completedAt: T0.toISOString(),
          expiresAt: lapsedExpiresAt.toISOString(),
          fileName: 'launch-stadium-export.zip',
          byteSize: 4_000_000_000,
        },
        {
          ...empty,
          id: exportIdOf(5),
          status: 'FAILED',
          requestedAt: requestedAt(5),
          failedAt: T0.toISOString(),
          failureKind: 'TOO_LARGE',
        },
        {
          ...empty,
          id: exportIdOf(4),
          status: 'FAILED',
          requestedAt: requestedAt(4),
          failedAt: T0.toISOString(),
          failureKind: 'ERROR',
        },
        {
          ...empty,
          id: exportIdOf(3),
          status: 'EXPIRED',
          requestedAt: requestedAt(3),
          completedAt: T0.toISOString(),
          expiresAt: daysAfter(7).toISOString(),
          fileName: 'launch-stadium-export.zip',
          byteSize: 1024,
        },
        {
          ...empty,
          id: exportIdOf(2),
          status: 'READY',
          requestedAt: requestedAt(2),
          completedAt: T0.toISOString(),
          expiresAt: readyExpiresAt.toISOString(),
          fileName: 'launch-stadium-export.zip',
          byteSize: 1024,
          downloadPath: `/_bff/exports/${exportIdOf(2)}`,
        },
        {
          ...empty,
          id: exportIdOf(1),
          status: 'PENDING',
          requestedAt: requestedAt(1),
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: exportIdCursor(1) },
    });
  });

  test('完了のまま有効期限を過ぎた記録は、保存の状態を変えずに期限切れと示してパスを持たず、有効期限の前の記録は完了でパスを持つ', async () => {
    const user = await freshExportUser();
    const validUntil = hoursFromNow(1);
    const lapsedAt = hoursFromNow(-1);
    await seed([
      exportRowOf(1, user, readyColumnsOf(lapsedAt)),
      exportRowOf(2, user, readyColumnsOf(validUntil)),
    ]);

    const response = await fetchMyDataExports(
      { first: 20 },
      await sessionOf(user),
    );

    expect(
      response.data?.myDataExports?.nodes.map(
        ({ id, status, expiresAt, downloadPath }) => ({
          id,
          status,
          expiresAt,
          downloadPath,
        }),
      ),
    ).toEqual([
      {
        id: exportIdOf(2),
        status: 'READY',
        expiresAt: validUntil.toISOString(),
        downloadPath: `/_bff/exports/${exportIdOf(2)}`,
      },
      {
        id: exportIdOf(1),
        status: 'EXPIRED',
        expiresAt: lapsedAt.toISOString(),
        downloadPath: null,
      },
    ]);
    expect((await readExportRowsOf(user)).map(({ status }) => status)).toEqual([
      'ready',
      'ready',
    ]);
  });

  test('作成中の状態は、要求の受け付けと生成中のどちらもPENDINGで返す', async () => {
    const user = await freshExportUser();
    await seed([
      exportRowOf(1, user),
      exportRowOf(2, user, { status: 'generating' }),
    ]);

    const response = await fetchMyDataExports(
      { first: 20 },
      await sessionOf(user),
    );

    expect(
      response.data?.myDataExports?.nodes.map(({ status }) => status),
    ).toEqual(['PENDING', 'PENDING']);
  });

  test('要求が無ければ空の一覧と続きの無いpageInfoを返す', async () => {
    const user = await freshExportUser();

    const response = await fetchMyDataExports(
      { first: 20 },
      await sessionOf(user),
    );

    expect(response.data?.myDataExports).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('停止中の利用者も一覧を読める', async () => {
    const user = await freshExportUser(SUSPENDED_COLUMNS);
    await seed([exportRowOf(1, user, failedColumnsOf())]);

    const response = await fetchMyDataExports(
      { first: 20 },
      await sessionOf(user),
    );

    expect(response.data?.myDataExports?.nodes).toHaveLength(1);
  });

  test('件数を省略すると20件ずつ返す', async () => {
    const user = await freshExportUser();
    await seed(Array.from({ length: 21 }, (_, i) => exportRowOf(i + 1, user)));

    const response = await fetchMyDataExportsDefaultPage(await sessionOf(user));

    expect(response.data?.myDataExports?.nodes).toHaveLength(20);
    expect(response.data?.myDataExports?.pageInfo.hasNextPage).toBe(true);
  });
});

function exportIdCursor(index: number): string {
  return encodeCursor({ id: exportIdOf(index) });
}

describe('myDataExports のページング', () => {
  test('firstとafterで20件ずつ新しい順に読み、最後のページで続きが無くなる', async () => {
    const user = await freshExportUser();
    await seed(Array.from({ length: 45 }, (_, i) => exportRowOf(i + 1, user)));
    const session = await sessionOf(user);

    const first = await fetchMyDataExports({ first: 20 }, session);
    const second = await fetchMyDataExports(
      {
        first: 20,
        after: first.data?.myDataExports?.pageInfo.endCursor ?? null,
      },
      session,
    );
    const third = await fetchMyDataExports(
      {
        first: 20,
        after: second.data?.myDataExports?.pageInfo.endCursor ?? null,
      },
      session,
    );

    const idsOf = (response: typeof first) =>
      response.data?.myDataExports?.nodes.map(({ id }) => id);
    expect(idsOf(first)).toEqual(
      Array.from({ length: 20 }, (_, i) => exportIdOf(45 - i)),
    );
    expect(first.data?.myDataExports?.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: exportIdCursor(26),
    });
    expect(idsOf(second)).toEqual(
      Array.from({ length: 20 }, (_, i) => exportIdOf(25 - i)),
    );
    expect(second.data?.myDataExports?.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: exportIdCursor(6),
    });
    expect(idsOf(third)).toEqual(
      Array.from({ length: 5 }, (_, i) => exportIdOf(5 - i)),
    );
    expect(third.data?.myDataExports?.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: exportIdCursor(1),
    });
  });

  test('明示したnullのafterは先頭のページと同じに扱う', async () => {
    const user = await freshExportUser();
    await seed([exportRowOf(1, user)]);

    const response = await fetchMyDataExports(
      { first: 20, after: null },
      await sessionOf(user),
    );

    expect(response.data?.myDataExports?.nodes).toHaveLength(1);
  });

  test.each([21, 100, 0, -1])(
    '件数%iはvalidation_errorで拒否し、一覧を読まない',
    async (first) => {
      const user = await freshExportUser();
      await seed([exportRowOf(1, user)]);

      const response = await fetchMyDataExports(
        { first },
        await sessionOf(user),
      );

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'first',
          message: PAGE_SIZE_MESSAGE,
        }),
      ]);
      expect(response.data?.myDataExports ?? null).toBeNull();
    },
  );

  test.each([
    ['base64urlでない文字列', 'not a cursor!'],
    ['空文字列', ''],
    ['JSONでない値', 'AAAA'],
    ['IDの形でない位置', encodeCursor({ id: 'invalid' })],
    ['小文字のID', encodeCursor({ id: exportIdOf(1).toLowerCase() })],
    ['IDを持たない位置', encodeCursor({ other: exportIdOf(1) })],
  ])('不正なafter(%s)はinvalid_cursorで拒否する', async (_name, after) => {
    const user = await freshExportUser();
    await seed([exportRowOf(1, user)]);

    const response = await fetchMyDataExports(
      { first: 20, after },
      await sessionOf(user),
    );

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});
