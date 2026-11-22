import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../apps/common-lib/reporting/report-rules.ts';
import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import {
  openReportCaseIdSql,
  parseOpenReportCaseId,
  parseReportCaseState,
  parseReportFixtureInsert,
  parseReportFixtureLookup,
  planReportFixture,
  reportCaseStateSql,
  type ReportFixtureRequest,
  reportFixtureInsertSql,
  reportFixtureLookupSql,
  type ResolvedReportFixture,
} from './report-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const NOW = new Date('2026-11-22T03:00:00.000Z');

const OWNER_ID = 'U1';

const OWNER_HANDLE = 'e2e-report-owner';

const REPORTER_ID = 'U2';

const REPORTER_HANDLE = 'e2e-report-reporter';

const REPORTER_EMAIL = `${REPORTER_HANDLE}@test.example`;

const COMMENTER_ID = 'U3';

const PRODUCT_ID = 'P1';

const PRODUCT_HANDLE = 'e2e-report-product';

const LAUNCH_ID = 'L1';

const COMMENT_ID = 'C1';

const GUEST_CONTACT = 'e2e-report-guest@test.example';

const REASON = 'E2Eの通報の理由です。';

let db: Database;

let idCount = 0;

const nextId = (): string => {
  idCount += 1;
  return `ID${String(idCount).padStart(4, '0')}`;
};

const queryRows = (sql: string): LocalD1Row[] =>
  db.query<Record<string, unknown>, []>(sql).all();

// 複数の文を順に実行し、RETURNINGの行を文の順につなげて返す(ローカルのD1の実行結果と同じ形)
const executeAll = (sql: string): LocalD1Row[] =>
  sql
    .split('\n')
    .flatMap((statement) =>
      db.query<Record<string, unknown>, []>(statement).all(),
    );

const insertUser = (
  id: string,
  handle: string,
  columns: { readonly status?: string; readonly deletedAt?: number } = {},
): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, status, email_verified_at, terms_agreed_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'x', ?, ?, ?, 1, 1, 1, 1, ?)`,
    [
      id,
      `p-${id}`,
      `${handle}@test.example`,
      id,
      handle,
      columns.status ?? 'active',
      columns.deletedAt ?? null,
    ],
  );
};

const insertProduct = (
  id: string,
  handle: string,
  columns: { readonly deletedAt?: number } = {},
): void => {
  db.run(
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 'タグライン', 'https://report.example', '説明', 'LOGO', '2026-11-21', 1, 1, ?)`,
    [
      id,
      OWNER_ID,
      PRODUCT_CATEGORY_OTHER_ID,
      handle,
      `名称${id}`,
      columns.deletedAt ?? null,
    ],
  );
};

const insertComment = (
  id: string,
  columns: {
    readonly authorUserId?: string | null;
    readonly deletedAt?: number;
  } = {},
): void => {
  db.run(
    `INSERT INTO launch_comments (id, product_id, launch_id, root_id, depth, author_user_id, body, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, ?, '本文', 1, 1, ?)`,
    [
      id,
      PRODUCT_ID,
      LAUNCH_ID,
      id,
      columns.authorUserId === undefined ? COMMENTER_ID : columns.authorUserId,
      columns.deletedAt ?? null,
    ],
  );
};

const insertCategory = (id: string, name: string): void => {
  db.run(
    `INSERT INTO report_categories (id, name, system_default, created_at, updated_at) VALUES (?, ?, 0, 1, 1)`,
    [id, name],
  );
};

const resolve = (request: ReportFixtureRequest): ResolvedReportFixture =>
  parseReportFixtureLookup(queryRows(reportFixtureLookupSql(request)), request);

const guestInfringementOnProduct: ReportFixtureRequest = {
  target: { kind: 'product', productHandle: PRODUCT_HANDLE },
  categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
  reporter: { kind: 'guest', contactEmail: GUEST_CONTACT },
};

const guestOtherOnProduct: ReportFixtureRequest = {
  target: { kind: 'product', productHandle: PRODUCT_HANDLE },
  categoryName: REPORT_CATEGORY_OTHER_NAME,
  reporter: { kind: 'guest', contactEmail: null },
};

const memberOtherOnComment: ReportFixtureRequest = {
  target: { kind: 'comment', commentId: COMMENT_ID },
  categoryName: REPORT_CATEGORY_OTHER_NAME,
  reporter: { kind: 'member', email: REPORTER_EMAIL },
};

const submit = (
  request: ReportFixtureRequest,
  now: Date = NOW,
  reason: string = REASON,
) => {
  const plan = planReportFixture({
    resolved: resolve(request),
    reason,
    now,
    nextId,
  });
  return {
    plan,
    created: parseReportFixtureInsert(
      executeAll(reportFixtureInsertSql(plan)),
      plan,
    ),
  };
};

beforeEach(async () => {
  idCount = 0;
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
  insertUser(OWNER_ID, OWNER_HANDLE);
  insertUser(REPORTER_ID, REPORTER_HANDLE);
  insertUser(COMMENTER_ID, 'e2e-report-commenter');
  insertProduct(PRODUCT_ID, PRODUCT_HANDLE);
  db.run(
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, created_at, updated_at) VALUES (?, ?, '2026-11-21', 'won', 1, 1, 1)`,
    [LAUNCH_ID, PRODUCT_ID],
  );
  insertComment(COMMENT_ID);
});

afterEach(() => {
  db.close();
});

describe('reportFixtureLookupSql・parseReportFixtureLookup', () => {
  test('プロダクトはハンドルから、自身のID・所有者・自身のプロダクトとして読む', () => {
    expect(resolve(guestInfringementOnProduct)).toStrictEqual({
      targetKind: 'product',
      targetId: PRODUCT_ID,
      targetOwnerUserId: OWNER_ID,
      productId: PRODUCT_ID,
      categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
      categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      reporterUserId: null,
      contactEmail: GUEST_CONTACT,
    });
  });

  test('コメントはIDから、投稿者を所有者に、コメントのプロダクトを対象のプロダクトとして読み、通報者の利用者をメールアドレスから読む', () => {
    expect(resolve(memberOtherOnComment)).toStrictEqual({
      targetKind: 'comment',
      targetId: COMMENT_ID,
      targetOwnerUserId: COMMENTER_ID,
      productId: PRODUCT_ID,
      categoryId: REPORT_CATEGORY_OTHER_ID,
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporterUserId: REPORTER_ID,
      contactEmail: null,
    });
  });

  test('利用者はハンドルから、自身を所有者にしてプロダクトを持たない形で読む', () => {
    expect(
      resolve({
        target: { kind: 'user', userHandle: OWNER_HANDLE },
        categoryName: REPORT_CATEGORY_OTHER_NAME,
        reporter: { kind: 'guest', contactEmail: null },
      }),
    ).toStrictEqual({
      targetKind: 'user',
      targetId: OWNER_ID,
      targetOwnerUserId: OWNER_ID,
      productId: null,
      categoryId: REPORT_CATEGORY_OTHER_ID,
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporterUserId: null,
      contactEmail: null,
    });
  });

  test('ハンドル・カテゴリ名・メールアドレスの大文字と小文字を区別せず、追加したカテゴリも登録の名前で読む', () => {
    insertCategory('CAT1', 'Spam');

    expect(
      resolve({
        target: { kind: 'user', userHandle: OWNER_HANDLE.toUpperCase() },
        categoryName: 'SPAM',
        reporter: { kind: 'member', email: REPORTER_EMAIL.toUpperCase() },
      }),
    ).toMatchObject({
      targetId: OWNER_ID,
      categoryId: 'CAT1',
      categoryName: 'Spam',
      reporterUserId: REPORTER_ID,
    });
  });

  test('削除された対象・投稿者の無いコメントは見つからない', () => {
    insertProduct('P2', 'e2e-report-deleted', { deletedAt: 1 });
    insertUser('U4', 'e2e-report-withdrawn', { deletedAt: 1 });
    insertComment('C2', { deletedAt: 1 });
    insertComment('C3', { authorUserId: null });

    for (const target of [
      { kind: 'product', productHandle: 'e2e-report-deleted' },
      { kind: 'product', productHandle: 'e2e-report-missing' },
      { kind: 'user', userHandle: 'e2e-report-withdrawn' },
      { kind: 'comment', commentId: 'C2' },
      { kind: 'comment', commentId: 'C3' },
    ] as const) {
      expect(() => resolve({ ...guestInfringementOnProduct, target })).toThrow(
        `通報の対象(${JSON.stringify(target)})が見つかりません。削除されていない対象を指定してください`,
      );
    }
  });

  test('カテゴリが無ければ失敗する', () => {
    expect(() =>
      resolve({ ...guestInfringementOnProduct, categoryName: '存在しない' }),
    ).toThrow('通報カテゴリ(存在しない)が見つかりません');
  });

  test('通報者の利用者が無い・退会済み・停止中なら失敗する', () => {
    insertUser('U5', 'e2e-report-suspended', { status: 'suspended' });

    for (const email of [
      'e2e-report-missing@test.example',
      'e2e-report-suspended@test.example',
    ]) {
      expect(() =>
        resolve({
          ...memberOtherOnComment,
          reporter: { kind: 'member', email },
        }),
      ).toThrow(
        `通報者の利用者(${email})が見つかりません。退会・停止していない利用者を指定してください`,
      );
    }
  });

  test('未ログインの権利侵害の通報に連絡先が無ければ、受け付けで拒否される組み合わせのため失敗する', () => {
    expect(() =>
      resolve({
        ...guestInfringementOnProduct,
        reporter: { kind: 'guest', contactEmail: null },
      }),
    ).toThrow('未ログインの権利侵害の通報には連絡先のメールアドレスが要ります');
  });

  test('権利侵害以外の未ログインの通報に連絡先を指定すると、受け付けで捨てられる値のため失敗する', () => {
    expect(() =>
      resolve({
        ...guestOtherOnProduct,
        reporter: { kind: 'guest', contactEmail: GUEST_CONTACT },
      }),
    ).toThrow(
      '権利侵害以外の未ログインの通報は受け付けで連絡先を捨てるため、連絡先を指定しないでください',
    );
  });

  test('ログイン中の通報者が対象の投稿者自身なら、受け付けで拒否される通報のため失敗する', () => {
    insertComment('C4', { authorUserId: REPORTER_ID });

    for (const target of [
      { kind: 'user', userHandle: REPORTER_HANDLE },
      { kind: 'product', productHandle: PRODUCT_HANDLE },
      { kind: 'comment', commentId: 'C4' },
    ] as const) {
      const email =
        target.kind === 'product'
          ? `${OWNER_HANDLE}@test.example`
          : REPORTER_EMAIL;
      expect(() =>
        resolve({
          ...memberOtherOnComment,
          target,
          reporter: { kind: 'member', email },
        }),
      ).toThrow(
        `通報者の利用者(${email})は対象(${JSON.stringify(target)})の投稿者自身です。本人のコンテンツは受け付けで拒否されるため、他の利用者を指定してください`,
      );
    }
  });

  test('引用符を含む値も文字列のリテラルとして照会する', () => {
    const handle = "it's'; DROP TABLE products; --";

    expect(
      queryRows(
        reportFixtureLookupSql({
          ...guestInfringementOnProduct,
          target: { kind: 'product', productHandle: handle },
        }),
      ),
    ).toEqual([]);
    expect(queryRows('SELECT id FROM products')).toEqual([{ id: PRODUCT_ID }]);
  });

  test('照会の結果の形式が違えば失敗する', () => {
    expect(() =>
      parseReportFixtureLookup(
        [{ target_id: 1, owner_user_id: OWNER_ID, product_id: null }],
        guestInfringementOnProduct,
      ),
    ).toThrow('通報の対象の照会の結果の形式が正しくありません');
  });
});

describe('planReportFixture', () => {
  test('通報と案件のIDを割り当て、権利侵害のカテゴリのときだけ権利侵害の起点を持たせる', () => {
    const infringement = planReportFixture({
      resolved: resolve(guestInfringementOnProduct),
      reason: REASON,
      now: NOW,
      nextId,
    });
    const other = planReportFixture({
      resolved: resolve(memberOtherOnComment),
      reason: REASON,
      now: NOW,
      nextId,
    });

    expect(infringement).toMatchObject({
      reportId: 'ID0001',
      newCaseId: 'ID0002',
      reason: REASON,
      infringement: true,
      at: NOW,
    });
    expect(other).toMatchObject({
      reportId: 'ID0003',
      newCaseId: 'ID0004',
      infringement: false,
    });
  });

  test('理由が空白だけ・上限を超えると、受け付けで拒否される値のため失敗する', () => {
    const resolved = resolve(guestInfringementOnProduct);

    expect(() =>
      planReportFixture({ resolved, reason: ' 　', now: NOW, nextId }),
    ).toThrow('通報の理由は空白以外の1〜1000文字で指定してください');
    expect(() =>
      planReportFixture({
        resolved,
        reason: 'あ'.repeat(1001),
        now: NOW,
        nextId,
      }),
    ).toThrow('通報の理由は空白以外の1〜1000文字で指定してください');
  });
});

describe('reportFixtureInsertSql・parseReportFixtureInsert', () => {
  test('未完了の案件が無ければ、受け付けと同じ形の未対応の案件と、受付時点のカテゴリ名を持つ通報を作る', () => {
    const { plan, created } = submit(guestInfringementOnProduct);

    expect(created).toStrictEqual({
      reportId: plan.reportId,
      caseId: plan.newCaseId,
      aggregated: false,
    });
    expect(
      queryRows(
        'SELECT id, target_kind, target_id, target_owner_user_id, product_id, target_detached_at, status, status_changed_at, last_reported_at, infringement_reported_at, closed_at, resolution, poster_notice_status, created_at, updated_at FROM report_cases',
      ),
    ).toStrictEqual([
      {
        id: plan.newCaseId,
        target_kind: 'product',
        target_id: PRODUCT_ID,
        target_owner_user_id: OWNER_ID,
        product_id: PRODUCT_ID,
        target_detached_at: null,
        status: 'open',
        status_changed_at: NOW.getTime(),
        last_reported_at: NOW.getTime(),
        infringement_reported_at: NOW.getTime(),
        closed_at: null,
        resolution: null,
        poster_notice_status: 'none',
        created_at: NOW.getTime(),
        updated_at: NOW.getTime(),
      },
    ]);
    expect(
      queryRows(
        'SELECT id, case_id, reporter_user_id, contact_email, category_id, category_name, reason, reported_at, outcome_notice_status, deleted_at FROM reports',
      ),
    ).toStrictEqual([
      {
        id: plan.reportId,
        case_id: plan.newCaseId,
        reporter_user_id: null,
        contact_email: GUEST_CONTACT,
        category_id: REPORT_CATEGORY_INFRINGEMENT_ID,
        category_name: REPORT_CATEGORY_INFRINGEMENT_NAME,
        reason: REASON,
        reported_at: NOW.getTime(),
        outcome_notice_status: 'none',
        deleted_at: null,
      },
    ]);
  });

  test('同じ対象の未完了の案件があれば、その案件へ集約して最後の受付日時を進め、権利侵害の起点は最初のまま残す', () => {
    const first = submit(guestInfringementOnProduct);
    const later = new Date(NOW.getTime() + 60_000);

    const second = submit(guestOtherOnProduct, later);
    const third = submit(
      guestInfringementOnProduct,
      new Date(NOW.getTime() + 120_000),
    );

    expect(second.created).toStrictEqual({
      reportId: second.plan.reportId,
      caseId: first.plan.newCaseId,
      aggregated: true,
    });
    expect(third.created.caseId).toBe(first.plan.newCaseId);
    expect(
      queryRows(
        'SELECT id, last_reported_at, infringement_reported_at FROM report_cases',
      ),
    ).toStrictEqual([
      {
        id: first.plan.newCaseId,
        last_reported_at: NOW.getTime() + 120_000,
        infringement_reported_at: NOW.getTime(),
      },
    ]);
    expect(
      queryRows(
        `SELECT COUNT(*) AS count FROM reports WHERE case_id = '${first.plan.newCaseId}'`,
      ),
    ).toStrictEqual([{ count: 3 }]);
  });

  test('権利侵害でない通報から始まった案件は、後の権利侵害の通報の日時を起点にする', () => {
    const first = submit(guestOtherOnProduct);
    const later = new Date(NOW.getTime() + 60_000);

    submit(guestInfringementOnProduct, later);

    expect(
      queryRows(
        `SELECT infringement_reported_at FROM report_cases WHERE id = '${first.plan.newCaseId}'`,
      ),
    ).toStrictEqual([{ infringement_reported_at: later.getTime() }]);
  });

  test('同じ対象の案件が完了済みなら、新しい案件を作る', () => {
    const first = submit(memberOtherOnComment);
    db.run(
      `UPDATE report_cases SET status = 'rejected', closed_at = 1 WHERE id = ?`,
      [first.plan.newCaseId],
    );

    const second = submit(memberOtherOnComment);

    expect(second.created).toStrictEqual({
      reportId: second.plan.reportId,
      caseId: second.plan.newCaseId,
      aggregated: false,
    });
    expect(
      queryRows('SELECT id, status FROM report_cases ORDER BY id'),
    ).toStrictEqual([
      { id: first.plan.newCaseId, status: 'rejected' },
      { id: second.plan.newCaseId, status: 'open' },
    ]);
  });

  test('引用符を含む理由も文字列のリテラルとして保存する', () => {
    const reason = "it's'; DROP TABLE reports; --";

    submit(memberOtherOnComment, NOW, reason);

    expect(queryRows('SELECT reason FROM reports')).toStrictEqual([{ reason }]);
  });

  test('作った通報の行が返らなければ失敗する', () => {
    const plan = planReportFixture({
      resolved: resolve(guestInfringementOnProduct),
      reason: REASON,
      now: NOW,
      nextId,
    });

    expect(() => parseReportFixtureInsert([], plan)).toThrow(
      `通報(${plan.reportId})を作れませんでした: []`,
    );
    expect(() =>
      parseReportFixtureInsert([{ id: 'other', case_id: 'X' }], plan),
    ).toThrow(`通報(${plan.reportId})を作れませんでした`);
  });
});

describe('reportCaseStateSql・parseReportCaseState', () => {
  test('案件の状態と対象と、論理削除されていない通報を受付の順に読む', () => {
    const first = submit(guestInfringementOnProduct);
    const second = submit(
      {
        ...guestInfringementOnProduct,
        reporter: { kind: 'member', email: REPORTER_EMAIL },
        categoryName: REPORT_CATEGORY_OTHER_NAME,
      },
      new Date(NOW.getTime() + 60_000),
    );
    const third = submit(
      guestInfringementOnProduct,
      new Date(NOW.getTime() + 120_000),
    );
    db.run(`UPDATE reports SET deleted_at = 1 WHERE id = ?`, [
      third.plan.reportId,
    ]);
    const caseId = first.plan.newCaseId;

    expect(
      parseReportCaseState(queryRows(reportCaseStateSql(caseId)), caseId),
    ).toStrictEqual({
      caseId,
      status: 'open',
      targetKind: 'product',
      targetId: PRODUCT_ID,
      targetOwnerUserId: OWNER_ID,
      productId: PRODUCT_ID,
      infringementReported: true,
      reports: [
        {
          reportId: first.plan.reportId,
          reporterUserId: null,
          contactEmail: GUEST_CONTACT,
          categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
          categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
        },
        {
          reportId: second.plan.reportId,
          reporterUserId: REPORTER_ID,
          contactEmail: null,
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: REPORT_CATEGORY_OTHER_NAME,
        },
      ],
    });
  });

  test('案件が無ければ失敗し、結果の形式が違えば失敗する', () => {
    expect(() =>
      parseReportCaseState(queryRows(reportCaseStateSql("x'y")), "x'y"),
    ).toThrow("ローカルのD1に通報の案件(x'y)がありません");
    expect(() => parseReportCaseState([{ status: 1 }], 'C')).toThrow(
      '通報の案件の照会の結果の形式が正しくありません',
    );
  });
});

describe('openReportCaseIdSql・parseOpenReportCaseId', () => {
  const findOpen = (target: ReportFixtureRequest['target']): string =>
    parseOpenReportCaseId(queryRows(openReportCaseIdSql(target)), target);

  test('受け付けと同じ対象の解決で、プロダクトとユーザーはハンドルから、コメントはIDから未完了の案件を引く', () => {
    const product = submit(guestOtherOnProduct);
    const comment = submit(memberOtherOnComment);
    const user = submit({
      target: { kind: 'user', userHandle: OWNER_HANDLE },
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporter: { kind: 'member', email: REPORTER_EMAIL },
    });

    expect(
      findOpen({
        kind: 'product',
        productHandle: PRODUCT_HANDLE.toUpperCase(),
      }),
    ).toBe(product.created.caseId);
    expect(findOpen({ kind: 'comment', commentId: COMMENT_ID })).toBe(
      comment.created.caseId,
    );
    expect(findOpen({ kind: 'user', userHandle: OWNER_HANDLE })).toBe(
      user.created.caseId,
    );
  });

  test('完了した案件は引かず、同じ対象に作り直した未完了の案件を引く', () => {
    const first = submit(memberOtherOnComment);
    db.run(
      `UPDATE report_cases SET status = 'rejected', closed_at = 1 WHERE id = ?`,
      [first.created.caseId],
    );
    const { target } = memberOtherOnComment;

    expect(() => findOpen(target)).toThrow(
      `対象(${JSON.stringify(target)})の未完了の通報の案件が1件ではありません: []`,
    );

    const second = submit(memberOtherOnComment);

    expect(findOpen(target)).toBe(second.created.caseId);
  });

  test('引用符を含む値も文字列のリテラルとして照会し、結果の形式が違えば失敗する', () => {
    const target = { kind: 'product', productHandle: "x'y" } as const;

    expect(() => findOpen(target)).toThrow(
      '未完了の通報の案件が1件ではありません',
    );
    expect(() => parseOpenReportCaseId([{ id: 1 }], target)).toThrow(
      '未完了の通報の案件が1件ではありません',
    );
  });
});
