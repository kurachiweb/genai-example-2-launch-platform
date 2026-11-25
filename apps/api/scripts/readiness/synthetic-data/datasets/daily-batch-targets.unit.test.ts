import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { OBJECT_KEY_PATTERN } from '../../../../common-lib/media/image-variants.ts';
import { USER_SESSION_POLICY } from '../../../../src/domain/auth/session-policy.ts';
import { utcYearsBefore } from '../../../../lib/core/time/utc-calendar.ts';
import { userAt, type EntityContext } from '../entities.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { MAX_STATEMENT_BYTES } from '../sql-writer.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { commentsDataset } from './comments.ts';
import {
  DAILY_BATCH_JOB_COVERAGE,
  DEDICATED_ROWS_PER_JOB,
  MEDIA_FILE_KEY_PREFIX,
  MEDIA_KEY_PREFIX,
  dailyBatchTargetsDataset,
  mediaFileKeyLike,
  orphanOwnerIdOf,
} from './daily-batch-targets.ts';
import { helpArticlesDataset } from './help-articles.ts';
import { matchesDataset } from './matches.ts';
import { moderationDataset } from './moderation.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const BASE_DATE = '2026-11-24';

const BASE_MS = Date.parse('2026-11-24T08:00:00.000Z');

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

const DAY_MS = 86_400_000;

// 4:21の起動の時刻(基準日の0:00から4時間21分後)
const RUN_AT = BASE_MS + (4 * 60 + 21) * MINUTE_MS;

const LOGO_FILE_ID = 'shared-readiness-logo';

const context: DatasetContext = {
  seed: 1,
  baseDate: BASE_DATE,
  logoFileId: LOGO_FILE_ID,
};

const entities = (profile: EntityContext['profile']): EntityContext => ({
  seed: 1,
  baseDate: BASE_DATE,
  profile,
});

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

// media-pipelineの4:21のジョブ(810・820・830)の選択の条件を、実装(backend-lib/workers/media/d1-media-file-store.ts)から写した述語
const JOB_810 = `(erase_requested_at IS NOT NULL OR deleted_at < ${String(RUN_AT - 13 * DAY_MS + 1)} OR (attached_at IS NULL AND created_at < ${String(RUN_AT - DAY_MS)}))`;

const JOB_820 = `(deleted_at IS NULL AND erase_requested_at IS NULL AND (moderation_status = 'undetermined' OR (moderation_status = 'pending' AND created_at < ${String(RUN_AT - HOUR_MS)})))`;

const HAS_REASON =
  'EXISTS (SELECT 1 FROM media_file_quarantine_reasons r WHERE r.file_id = media_files.id)';

const JOB_830 = `(storage = 'images' AND ((location = 'images' AND ${HAS_REASON}) OR (location = 'quarantine' AND NOT ${HAS_REASON})))`;

let db: Database;

let yearOneCounts: Record<string, number>;

beforeAll(() => {
  db = createMigratedDatabase();
  for (const dataset of [
    usersDataset,
    productsDataset,
    matchesDataset,
    commentsDataset,
    moderationDataset,
    dailyBatchTargetsDataset,
  ]) {
    for (const statement of dataset.generate(SMOKE_PROFILE, context)) {
      db.run(statement.text);
    }
  }
});

beforeAll(() => {
  yearOneCounts = countRows(
    dailyBatchTargetsDataset.generate(YEAR_ONE_PROFILE, context),
  );
}, 120_000);

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('dailyBatchTargetsDataset', () => {
  test('利用者と管理者の後に並ぶ', () => {
    expect(dailyBatchTargetsDataset.name).toBe('daily-batch-targets');
    expect(dailyBatchTargetsDataset.dependsOn).toEqual([
      'users',
      'products',
      'matches',
      'moderation',
    ]);
  });

  test('マイグレーション済みのSQLiteへ誤り無く適用でき、外部キーの違反が無い', () => {
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('全ての文が90,000バイト以下で、改行を含まない', () => {
    for (const { text } of dailyBatchTargetsDataset.generate(
      SMOKE_PROFILE,
      context,
    )) {
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
        MAX_STATEMENT_BYTES,
      );
      expect(text.includes('\n')).toBe(false);
    }
  });

  test('同じ種と基準日なら同じ文を出す', () => {
    const take = (): string[] =>
      [...dailyBatchTargetsDataset.generate(SMOKE_PROFILE, context)].map(
        (s) => s.text,
      );

    expect(take()).toEqual(take());
  });
});

describe('ファイルの記録(順序600・810・820・830)', () => {
  test('想定規模では利用者の全員に1件ずつと、保有者の居ない記録1,200件と、専用の行9件を作る', () => {
    expect(yearOneCounts['media_files']).toBe(
      50_000 + 1_200 + 3 * DEDICATED_ROWS_PER_JOB,
    );
  });

  test('全てのファイルの記録のオブジェクトキーが、画像のキャッシュの破棄のメッセージの本文の規則(32桁の16進数)に合う', () => {
    const keys = db
      .query<{ key: string }, []>('SELECT object_key AS key FROM media_files')
      .all()
      .map(({ key }) => key);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !OBJECT_KEY_PATTERN.test(key))).toStrictEqual(
      [],
    );
  });

  test('保有者の居ない記録と専用の行は検証用の規模でも縮小されない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM media_files WHERE object_key LIKE '${mediaFileKeyLike('orphan')}'`,
      ),
    ).toBe(1_200);
    expect(
      scalar(
        `SELECT count(*) FROM media_files WHERE object_key LIKE '${MEDIA_FILE_KEY_PREFIX}08%'`,
      ),
    ).toBe(9);
    expect(
      scalar(
        `SELECT count(*) FROM media_files WHERE object_key LIKE '${mediaFileKeyLike('user')}'`,
      ),
    ).toBe(SMOKE_PROFILE.users);
  });

  test('利用者の全員が1件ずつ持ち、全てのキーが合成の接頭辞で一意で、共通の画像を指さない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM (SELECT owner_id FROM media_files WHERE object_key LIKE '${mediaFileKeyLike('user')}' GROUP BY owner_id HAVING count(*) <> 1)`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM media_files WHERE object_key NOT LIKE '${MEDIA_FILE_KEY_PREFIX}%' OR object_key LIKE '%${LOGO_FILE_ID}%' OR id = '${LOGO_FILE_ID}'`,
      ),
    ).toBe(0);
    expect(
      scalar('SELECT count(DISTINCT object_key) = count(*) FROM media_files'),
    ).toBe(1);
  });

  test('保有者の居ない記録の保有者は利用者の行が無く、IDが全ての合成の利用者のIDより後に並ぶ', () => {
    expect(
      scalar(
        `SELECT count(*) FROM media_files f WHERE f.object_key LIKE '${mediaFileKeyLike('orphan')}' AND EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id)`,
      ),
    ).toBe(0);
    const allUsers = Array.from(
      { length: YEAR_ONE_PROFILE.users },
      (_, i) => userAt(entities(YEAR_ONE_PROFILE), i).id,
    ).toSorted();
    const maxUserId = allUsers.at(-1) ?? '';
    for (const index of [0, 1, 599, 1_199]) {
      expect(
        orphanOwnerIdOf(entities(YEAR_ONE_PROFILE), index) > maxUserId,
      ).toBe(true);
    }
    expect(
      scalar(
        `SELECT count(DISTINCT owner_id) FROM media_files WHERE object_key LIKE '${mediaFileKeyLike('orphan')}'`,
      ),
    ).toBe(1_200);
  });

  test('保有者の居ない記録は、保有者単位の物理削除の上限(1,000件)での打ち切りを起こす件数がある', () => {
    expect(
      scalar(
        `SELECT count(*) FROM media_files f WHERE f.owner_kind = 'user' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id)`,
      ),
    ).toBeGreaterThan(1_000);
  });

  test('合成のファイル(利用者の全員の分と保有者の居ない分)はmedia-pipelineの810・820・830の条件に当たらない', () => {
    const synthetic = `(object_key LIKE '${mediaFileKeyLike('user')}' OR object_key LIKE '${mediaFileKeyLike('orphan')}')`;

    for (const job of [JOB_810, JOB_820, JOB_830]) {
      expect(
        scalar(
          `SELECT count(*) FROM media_files WHERE ${synthetic} AND ${job}`,
        ),
      ).toBe(0);
    }
    expect(
      scalar(
        `SELECT count(*) FROM media_files WHERE ${synthetic} AND (attached_at IS NULL OR stored_at IS NULL OR moderation_status <> 'passed' OR storage <> 'images' OR location <> 'images' OR deleted_at IS NOT NULL OR erase_requested_at IS NOT NULL)`,
      ),
    ).toBe(0);
  });

  test.each([
    ['810', JOB_810, [JOB_820, JOB_830]],
    ['820', JOB_820, [JOB_810, JOB_830]],
    ['830', JOB_830, [JOB_810, JOB_820]],
  ] as const)(
    '%sの専用の行は3件で、存在する合成の利用者の持ち物であり、自分のジョブの条件だけに当たる',
    (job, own, others) => {
      const dedicated = `object_key LIKE '${mediaFileKeyLike(job)}'`;

      expect(
        scalar(`SELECT count(*) FROM media_files WHERE ${dedicated}`),
      ).toBe(DEDICATED_ROWS_PER_JOB);
      expect(
        scalar(
          `SELECT count(*) FROM media_files f WHERE ${dedicated} AND owner_kind = 'user' AND EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id)`,
        ),
      ).toBe(DEDICATED_ROWS_PER_JOB);
      expect(
        scalar(
          `SELECT count(*) FROM media_files WHERE ${dedicated} AND ${own}`,
        ),
      ).toBe(DEDICATED_ROWS_PER_JOB);
      for (const other of others) {
        expect(
          scalar(
            `SELECT count(*) FROM media_files WHERE ${dedicated} AND ${other}`,
          ),
        ).toBe(0);
      }
    },
  );

  test('専用の行は保有者の居ないファイルの削除(順序600)に先に消されない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM media_files f WHERE f.object_key LIKE '${MEDIA_FILE_KEY_PREFIX}08%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id)`,
      ),
    ).toBe(0);
  });
});

describe('期限切れの認証情報(順序110・200)', () => {
  const idleBoundary = RUN_AT - USER_SESSION_POLICY.idleSeconds * 1000;

  test('利用者のセッション・認証系トークン・ログインの待ち・多要素認証の保留は全て期限切れの条件に当たる', () => {
    expect(
      scalar(
        `SELECT count(*) FROM user_sessions WHERE NOT (last_used_at <= ${String(idleBoundary)} OR absolute_expires_at <= ${String(RUN_AT)})`,
      ),
    ).toBe(0);
    expect(scalar('SELECT count(*) FROM user_sessions')).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM user_auth_tokens WHERE expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(scalar('SELECT count(*) FROM user_auth_tokens')).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM user_login_challenges WHERE expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM user_totp_credentials WHERE enabled_at IS NOT NULL OR pending_expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(
      scalar('SELECT count(*) FROM user_totp_credentials'),
    ).toBeGreaterThan(0);
  });

  test('管理者のセッション・認証系トークン・ログインの待ち・多要素認証の保留も期限切れで、管理者の行を参照する', () => {
    expect(
      scalar(
        `SELECT count(*) FROM admin_sessions WHERE NOT (last_used_at <= ${String(RUN_AT - 14 * DAY_MS)} OR absolute_expires_at <= ${String(RUN_AT)})`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM admin_auth_tokens WHERE expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM admin_login_challenges WHERE expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM admin_totp_credentials WHERE enabled_at IS NOT NULL OR pending_expires_at > ${String(RUN_AT)}`,
      ),
    ).toBe(0);
    expect(scalar('SELECT count(*) FROM admin_sessions')).toBeGreaterThan(0);
  });

  test('想定規模では管理者の対象ごとの1回の上限(500件)を超えて残りが出る件数を作る', () => {
    for (const table of [
      'admin_sessions',
      'admin_auth_tokens',
      'admin_login_challenges',
    ]) {
      expect(yearOneCounts[table]).toBeGreaterThan(500);
    }
  });
});

describe('保持期間を過ぎた行(順序210・300・410)', () => {
  test('監査ログは3年以上前の行を、対象の行とともに作り、現在の監査ログとは別に数える', () => {
    const boundary = utcYearsBefore(new Date(RUN_AT), 3).getTime();

    const expired = scalar(
      `SELECT count(*) FROM admin_audit_logs WHERE occurred_at <= ${String(boundary)}`,
    ) as number;
    expect(expired).toBeGreaterThan(0);
    expect(scalar('SELECT count(*) FROM admin_audit_logs')).toBe(
      SMOKE_PROFILE.auditLogs + expired,
    );
    expect(
      scalar(
        `SELECT count(*) FROM admin_audit_log_targets t JOIN admin_audit_logs l ON l.id = t.log_id WHERE l.occurred_at <= ${String(boundary)}`,
      ),
    ).toBeGreaterThan(0);
  });

  test('未ログインの問い合わせは完了(対応済・却下)から14日以上経った行で、カテゴリが存在する', () => {
    expect(scalar('SELECT count(*) FROM guest_inquiries')).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM guest_inquiries WHERE status NOT IN ('resolved', 'rejected') OR status_changed_at > ${String(RUN_AT - 14 * DAY_MS)}`,
      ),
    ).toBe(0);
    expect(
      scalar(
        "SELECT count(*) FROM guest_inquiries WHERE email NOT LIKE '%.example'",
      ),
    ).toBe(0);
  });

  test('決済履歴は7年以上前に記録された行で、仮名化IDは合成の利用者のものではない', () => {
    const boundary = utcYearsBefore(new Date(RUN_AT), 7).getTime();

    expect(scalar('SELECT count(*) FROM payment_records')).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM payment_records WHERE recorded_at > ${String(boundary)} OR occurred_at > ${String(boundary)}`,
      ),
    ).toBe(0);
  });

  test('想定規模では監査ログ・問い合わせ・決済履歴が、1回の上限(500件×20回=10,000件)を超えて残りが出る件数ある', () => {
    expect(yearOneCounts['guest_inquiries']).toBeGreaterThan(10_000);
    expect(yearOneCounts['payment_records']).toBeGreaterThan(10_000);
    expect(yearOneCounts['admin_audit_logs']).toBeGreaterThan(10_000);
  });
});

describe('保持期間を過ぎた行と匿名化の対象(順序500・1400・1910・2010)', () => {
  test('Ultrasの知らせは処理を終えてから30日以上経った行で、利用者の行を参照する', () => {
    expect(scalar('SELECT count(*) FROM ultras_notices')).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM ultras_notices WHERE status NOT IN ('requested', 'skipped') OR finished_at IS NULL OR finished_at > ${String(RUN_AT - 30 * DAY_MS)}`,
      ),
    ).toBe(0);
  });

  test('措置の記録は3年以上前に記録された行で、通知は依頼待ちではない', () => {
    const boundary = utcYearsBefore(new Date(RUN_AT), 3).getTime();

    expect(scalar('SELECT count(*) FROM moderation_actions')).toBeGreaterThan(
      0,
    );
    expect(
      scalar(
        `SELECT count(*) FROM moderation_actions WHERE occurred_at > ${String(boundary)} OR notice_status = 'pending'`,
      ),
    ).toBe(0);
  });

  test('論理削除したコメントは論理削除から13日目の業務日付に収まり、匿名化されておらず、14日の期限の通知の対象にならない', () => {
    const total = scalar(
      'SELECT count(*) FROM launch_comments WHERE deleted_at IS NOT NULL',
    ) as number;

    expect(total).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM launch_comments WHERE deleted_at IS NOT NULL AND (anonymized_at IS NOT NULL OR deleted_at < ${String(BASE_MS - 13 * DAY_MS)} OR deleted_at >= ${String(BASE_MS - 12 * DAY_MS)} OR body = '')`,
      ),
    ).toBe(0);
  });

  test('完了から14日以上経った案件の未ログインの通報を作り、現在の案件の一覧の完了の日時とは別に数える', () => {
    expect(
      scalar(
        `SELECT count(*) FROM reports r JOIN report_cases c ON c.id = r.case_id WHERE r.reporter_user_id IS NULL AND c.closed_at <= ${String(RUN_AT - 14 * DAY_MS)}`,
      ),
    ).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM report_cases WHERE closed_at IS NOT NULL AND closed_at <= ${String(RUN_AT - 14 * DAY_MS)} AND status NOT IN ('resolved', 'rejected')`,
      ),
    ).toBe(0);
  });

  test('想定規模では、日次の1回の上限を超えて残りが出る件数を作る', () => {
    expect(yearOneCounts['ultras_notices']).toBeGreaterThan(10_000);
    expect(yearOneCounts['moderation_actions']).toBeGreaterThan(5_000);
    expect(yearOneCounts['launch_comments']).toBeGreaterThan(5_000);
    expect(yearOneCounts['report_cases']).toBeGreaterThan(10_000);
  });
});

describe('データベースの中で完結するジョブの対象(順序900・1100・1110・1600・2100)', () => {
  test('メールの送信済みの記録は14日より前、抑止記録は期限切れか、1年より前で利用者に紐づかないもの', () => {
    expect(
      scalar(
        `SELECT count(*) FROM email_send_records WHERE sent_at >= ${String(RUN_AT - 14 * DAY_MS)}`,
      ),
    ).toBe(0);
    expect(scalar('SELECT count(*) FROM email_send_records')).toBeGreaterThan(
      0,
    );
    expect(
      scalar(
        `SELECT count(*) FROM email_suppressions WHERE NOT ((expires_at IS NOT NULL AND expires_at <= ${String(RUN_AT)}) OR (last_event_at < ${String(RUN_AT - 365 * DAY_MS)} AND expires_at IS NULL))`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM email_suppressions s WHERE EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = s.address)`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM email_suppressions WHERE last_event_at < ${String(RUN_AT - 365 * DAY_MS)}`,
      ),
    ).toBeGreaterThan(0);
  });

  test('想定規模では、利用者に紐づかない抑止記録が1日の上限(90件×20ページ=1,800件)を超える', () => {
    expect(yearOneCounts['email_suppressions']).toBeGreaterThan(1_800);
  });

  test('滞ったマッチイベントは配信から1時間以上経った未完了で、確定のイベントが既にあるマッチを重ねない', () => {
    const stale = scalar(
      `SELECT count(*) FROM match_events WHERE status = 'pending' AND last_dispatched_at < ${String(RUN_AT - HOUR_MS)}`,
    ) as number;

    expect(stale).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM match_events WHERE status = 'pending' AND completed_at IS NOT NULL`,
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM (SELECT match_id, type FROM match_events GROUP BY match_id, type HAVING count(*) > 1)',
      ),
    ).toBe(0);
  });

  test('滞った未完了のイベントは、実行の時点から2日以内の確定のマッチを新たに作らない(確定のイベントが無いマッチを足さない)', () => {
    expect(
      scalar(
        `SELECT count(*) FROM matches m WHERE m.decided_at >= ${String(RUN_AT - 2 * DAY_MS)} AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.type = 'decided')`,
      ),
    ).toBe(0);
  });

  test('完了から30日を過ぎたイベントと、その処理の完了の記録を作る', () => {
    const old = scalar(
      `SELECT count(*) FROM match_events WHERE status = 'completed' AND completed_at < ${String(RUN_AT - 30 * DAY_MS)}`,
    ) as number;

    expect(old).toBe(6);
    expect(
      scalar(
        `SELECT count(*) FROM match_event_handler_runs r JOIN match_events e ON e.id = r.event_id WHERE e.completed_at < ${String(RUN_AT - 30 * DAY_MS)}`,
      ),
    ).toBeGreaterThan(0);
  });

  test('想定規模では、滞ったイベントが1回の上限(100件)を超え、完了済みの古いイベントが1回の上限(5,000件)を超える', () => {
    expect(yearOneCounts['match_events']).toBeGreaterThan(5_000 + 100);
    expect(yearOneCounts['match_event_handler_runs']).toBeGreaterThan(5_000);
  });

  test('開始日を過ぎた未決済の広告の申込と、400日より前に終わった表示停止の区間を作る', () => {
    expect(
      scalar(
        `SELECT count(*) FROM sponsorships WHERE state = 'pending_payment' AND starts_on < '${BASE_DATE}'`,
      ),
    ).toBeGreaterThan(0);
    expect(
      scalar(
        `SELECT count(*) FROM sponsorship_display_stops WHERE ended_at < ${String(RUN_AT - 400 * DAY_MS)}`,
      ),
    ).toBeGreaterThan(0);
  });

  test('想定規模では、未決済の申込が1回の上限(500件×20回)を超え、表示停止の区間が上限(500件)を超える', () => {
    expect(yearOneCounts['sponsorships']).toBeGreaterThan(10_000);
    expect(yearOneCounts['sponsorship_display_stops']).toBeGreaterThan(500);
  });

  test('データエクスポートは、期限切れの完了だけを作り、作成中の記録(2110の失敗の確定がメールとwarningを起こす)は作らない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM data_exports WHERE status = 'ready' AND expires_at <= ${String(RUN_AT)}`,
      ),
    ).toBeGreaterThan(0);
    expect(
      scalar(`SELECT count(*) FROM data_exports WHERE status <> 'ready'`),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM data_exports WHERE object_key IS NOT NULL AND object_key NOT LIKE '${MEDIA_KEY_PREFIX}%'`,
      ),
    ).toBe(0);
  });

  test('想定規模では、データエクスポートの期限切れが1回の上限(100件×10回=1,000件)を超える', () => {
    expect(yearOneCounts['data_exports']).toBeGreaterThan(1_000);
  });
});

describe('4:21の全ジョブの分類(DAILY_BATCH_JOB_COVERAGE)', () => {
  const DOC = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'docs',
    'GUIDES',
    'service',
    'overview',
    '007-daily-timeline.md',
  );

  const timelineJobs = (): { order: number; name: string }[] => {
    const text = readFileSync(DOC, 'utf8');
    const section = text.slice(
      text.indexOf('### 日次バッチ(4:21)の内容'),
      text.indexOf('### 23:40'),
    );
    return [...section.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`/gmu)].map(
      (match) => ({ order: Number(match[1]), name: match[2] ?? '' }),
    );
  };

  test('日次タイムラインの4:21の表の全ジョブが、順序とともに、ちょうど1回ずつ分類されている', () => {
    const jobs = timelineJobs();

    expect(jobs.length).toBeGreaterThanOrEqual(30);
    expect(
      DAILY_BATCH_JOB_COVERAGE.map(({ order, name }) => ({ order, name })),
    ).toEqual(jobs);
  });

  test('対象を作らないジョブ(対象外・行が不要)は理由を持ち、作るジョブは対象のテーブルを挙げる', () => {
    for (const job of DAILY_BATCH_JOB_COVERAGE) {
      if (job.kind === 'targets') {
        expect(job.tables.length).toBeGreaterThan(0);
      } else {
        expect(job.reason.length).toBeGreaterThan(10);
      }
    }
  });

  test('作るジョブの対象のテーブルは、検証用の規模の出力(ヘルプ記事の索引文書を含む)が実際に行を作るテーブルである', () => {
    const counts = countRows([
      ...dailyBatchTargetsDataset.generate(SMOKE_PROFILE, context),
      ...helpArticlesDataset.generate(SMOKE_PROFILE, context),
    ]);

    for (const job of DAILY_BATCH_JOB_COVERAGE) {
      if (job.kind === 'targets') {
        for (const table of job.tables) {
          expect(counts[table] ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  test('外部API・メール・Queueによる合成データの削除を起こすジョブは、対象外にして理由を残す', () => {
    const excluded = DAILY_BATCH_JOB_COVERAGE.filter(
      ({ kind }) => kind === 'excluded',
    ).map(({ order }) => order);

    expect(excluded).toEqual([
      100, 120, 400, 1000, 1010, 1300, 1500, 1700, 2000, 2110,
    ]);
  });

  test('2110は、失敗の確定ごとにメールの依頼とwarningを起こすことを理由に対象外にしている', () => {
    const job = DAILY_BATCH_JOB_COVERAGE.find(({ order }) => order === 2110);

    expect(job?.kind).toBe('excluded');
    expect(job?.kind === 'excluded' ? job.reason : '').toContain('メール');
    expect(job?.kind === 'excluded' ? job.reason : '').toContain('warning');
  });
});
