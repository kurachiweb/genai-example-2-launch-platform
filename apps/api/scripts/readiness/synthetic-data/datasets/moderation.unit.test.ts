import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { commentsDataset } from './comments.ts';
import { matchesDataset } from './matches.ts';
import {
  ADMIN_COUNT,
  AUDIT_RETENTION_YEARS,
  moderationDataset,
} from './moderation.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const BASE_DATE = '2026-11-24';

const BASE_MS = Date.parse('2026-11-24T08:00:00.000Z');

const DAY_MS = 86_400_000;

const context: DatasetContext = { seed: 1, baseDate: BASE_DATE };

const countRows = (
  statements: Iterable<SqlStatement>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const statement of statements) {
    counts[statement.table] =
      (counts[statement.table] ?? 0) + statement.insertedRows;
  }
  return counts;
};

let db: Database;

let yearOneStatements: readonly SqlStatement[];

beforeAll(() => {
  db = createMigratedDatabase();
  for (const dataset of [
    usersDataset,
    productsDataset,
    matchesDataset,
    commentsDataset,
    moderationDataset,
  ]) {
    for (const statement of dataset.generate(SMOKE_PROFILE, context)) {
      db.run(statement.text);
    }
  }
});

beforeAll(() => {
  yearOneStatements = [
    ...moderationDataset.generate(YEAR_ONE_PROFILE, context),
  ];
}, 120_000);

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('moderationDataset', () => {
  test('利用者・プロダクト・コメントの後に並ぶ', () => {
    expect(moderationDataset.name).toBe('moderation');
    expect(moderationDataset.dependsOn).toEqual([
      'users',
      'products',
      'comments',
    ]);
  });

  test('想定規模で通報の案件5,000件・監査ログ10万件と管理者を作る', () => {
    const counts = countRows(yearOneStatements);

    expect(counts['admins']).toBe(ADMIN_COUNT);
    expect(counts['report_cases']).toBe(5_000);
    expect(counts['admin_audit_logs']).toBe(100_000);
    expect(counts['reports']).toBeGreaterThanOrEqual(5_000);
    expect(counts['admin_audit_log_targets']).toBeGreaterThan(50_000);
  });

  test('マイグレーション済みのSQLiteへ誤り無く適用でき、外部キーの違反が無い', () => {
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(scalar('SELECT count(*) FROM report_cases')).toBe(
      SMOKE_PROFILE.reportCases,
    );
    expect(scalar('SELECT count(*) FROM admin_audit_logs')).toBe(
      SMOKE_PROFILE.auditLogs,
    );
  });

  test('全ての案件が1件以上の通報を持ち、最後の通報の日時が案件と一致する', () => {
    expect(
      scalar(
        'SELECT count(*) FROM report_cases c WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.case_id = c.id)',
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM report_cases c WHERE c.last_reported_at <> (SELECT max(reported_at) FROM reports r WHERE r.case_id = c.id)',
      ),
    ).toBe(0);
  });

  test('案件は3種類の対象を持ち、対象は重ならず、対象の行が存在する', () => {
    const kinds = db
      .query<{ kind: string }, []>(
        'SELECT DISTINCT target_kind AS kind FROM report_cases ORDER BY 1',
      )
      .all()
      .map((row) => row.kind);

    expect(kinds).toEqual(['comment', 'product', 'user']);
    expect(
      scalar(
        'SELECT count(*) FROM (SELECT 1 FROM report_cases GROUP BY target_kind, target_id HAVING count(*) > 1)',
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM report_cases c WHERE (c.target_kind = 'product' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.target_id)) OR (c.target_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.target_id)) OR (c.target_kind = 'comment' AND NOT EXISTS (SELECT 1 FROM launch_comments l WHERE l.id = c.target_id))`,
      ),
    ).toBe(0);
  });

  test('想定規模の案件の状態は未対応が最も多く、完了した案件が含まれる', () => {
    const counts = new Map<string, number>();
    const rows = yearOneStatements
      .filter((statement) => statement.table === 'report_cases')
      .map(
        (statement) =>
          /'(open|in_progress|resolved|rejected)', \d+, \d+/u.exec(
            statement.text,
          )?.[1] ?? '?',
      );
    for (const status of rows) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    expect(counts.get('open') ?? 0).toBeGreaterThan(2_500);
    expect(counts.get('in_progress') ?? 0).toBeGreaterThan(0);
    expect(counts.get('resolved') ?? 0).toBeGreaterThan(0);
    expect(counts.get('rejected') ?? 0).toBeGreaterThan(0);
    expect(counts.has('?')).toBe(false);
  });

  test('完了した案件は基準日の14日以内に完了し、通知は依頼待ちにしない(4:21のジョブの対象にしない)', () => {
    expect(
      scalar(
        `SELECT count(*) FROM report_cases WHERE closed_at IS NOT NULL AND closed_at <= ${String(BASE_MS - 14 * DAY_MS)}`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM report_cases WHERE poster_notice_status = 'pending'`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM reports WHERE outcome_notice_status = 'pending'`,
      ),
    ).toBe(0);
  });

  test('通報の宛先のメールアドレスのドメインは.exampleだけ', () => {
    const domains = db
      .query<{ domain: string }, []>(
        `SELECT DISTINCT substr(contact_email, instr(contact_email, '@') + 1) AS domain FROM reports WHERE contact_email IS NOT NULL`,
      )
      .all()
      .map((row) => row.domain);

    for (const domain of domains) {
      expect(domain.endsWith('.example')).toBe(true);
    }
  });

  test('監査ログは登録済みの操作種別・対象の種類・理由・詳細の鍵に従い、保持期間(3年)の内に収まる', () => {
    const rows = db
      .query<
        {
          action: string;
          targetKind: string | null;
          reason: string | null;
          detail: string;
          occurredAt: number;
          targets: number;
        },
        []
      >(
        'SELECT action, target_kind AS targetKind, reason, detail, occurred_at AS occurredAt, (SELECT count(*) FROM admin_audit_log_targets t WHERE t.log_id = l.id) AS targets FROM admin_audit_logs l',
      )
      .all();

    expect(rows).toHaveLength(SMOKE_PROFILE.auditLogs);
    for (const row of rows) {
      const definition = AUDIT_ACTIONS.find((a) => a.name === row.action);
      expect(definition).toBeDefined();
      expect(row.targetKind).toBe(definition?.targetKind ?? null);
      expect(row.targets).toBe(definition?.targetKind === null ? 0 : 1);
      expect(Object.keys(JSON.parse(row.detail) as object).toSorted()).toEqual(
        [...(definition?.detailKeys ?? [])].toSorted(),
      );
      if (definition?.reason === 'required') {
        expect(row.reason).not.toBeNull();
      }
      if (definition?.reason === 'none') {
        expect(row.reason).toBeNull();
      }
      expect(row.occurredAt).toBeLessThan(BASE_MS);
      expect(BASE_MS - row.occurredAt).toBeLessThan(
        AUDIT_RETENTION_YEARS * 365 * DAY_MS,
      );
    }
  });

  test('監査ログの操作者は作った管理者のいずれかで、想定規模では複数の操作種別を使う', () => {
    expect(
      scalar(
        'SELECT count(*) FROM admin_audit_logs WHERE operator_admin_id NOT IN (SELECT id FROM admins)',
      ),
    ).toBe(0);
    expect(scalar('SELECT count(DISTINCT action) FROM admin_audit_logs')).toBe(
      Math.min(SMOKE_PROFILE.auditLogs, AUDIT_ACTIONS.length),
    );
  });

  test('管理者はログインできない合成の管理者で、メールアドレスは.exampleだけ', () => {
    expect(scalar('SELECT count(*) FROM admins')).toBe(ADMIN_COUNT);
    expect(
      scalar(
        "SELECT count(*) FROM admins WHERE email NOT LIKE '%@readiness.example'",
      ),
    ).toBe(0);
    expect(scalar("SELECT count(*) FROM admins WHERE status <> 'active'")).toBe(
      0,
    );
  });

  test('同じ種と基準日なら同じ文を出し、種が違えば変わる', () => {
    const take = (seed: number): string[] =>
      [
        ...moderationDataset.generate(SMOKE_PROFILE, {
          seed,
          baseDate: BASE_DATE,
        }),
      ].map((s) => s.text);

    expect(take(1)).toEqual(take(1));
    expect(take(2)).not.toEqual(take(1));
  });
});
