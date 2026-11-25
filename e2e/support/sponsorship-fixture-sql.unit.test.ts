import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import {
  FIXTURE_DAILY_UNIT_AMOUNTS,
  launchKickOffSql,
  launchLossSql,
  paidSponsorshipInsertSql,
  type PaidSponsorshipPlan,
  parseLaunchKickOff,
  parseLaunchLoss,
  parsePaidSponsorshipInsert,
  parseSponsorProduct,
  planPaidSponsorship,
  type SponsorProduct,
  sponsorProductSql,
} from './sponsorship-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const NOW = new Date('2026-11-18T20:00:00.000Z');

const TODAY = '2026-11-18';

const YESTERDAY = '2026-11-17';

const FUTURE_LAUNCH_DATE = '2026-11-25';

const OWNER_ID = 'U1';

const PRODUCT_ID = 'P1';

const LAUNCH_ID = 'L1';

const HANDLE = 'e2e-sponsor-product';

const PRODUCT: SponsorProduct = {
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  launchId: LAUNCH_ID,
};

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

const insertUser = (id: string): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, 1, 1, 1, 1)`,
    [id, `p-${id}`, `${id}@test.example`, id, `user-${id}`],
  );
};

const insertProduct = (
  id: string,
  handle: string,
  columns: { readonly deletedAt?: number } = {},
): void => {
  db.run(
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 'タグライン', 'https://sponsor.example', '説明', 'LOGO', ?, 1, 1, ?)`,
    [
      id,
      OWNER_ID,
      PRODUCT_CATEGORY_OTHER_ID,
      handle,
      `名称${id}`,
      FUTURE_LAUNCH_DATE,
      columns.deletedAt ?? null,
    ],
  );
};

const insertLaunch = (
  id: string,
  productId: string,
  columns: {
    readonly launchDate?: string;
    readonly outcome?: string;
    readonly cancelledAt?: number;
  } = {},
): void => {
  db.run(
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, cancelled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      id,
      productId,
      columns.launchDate ?? FUTURE_LAUNCH_DATE,
      columns.outcome ?? null,
      columns.outcome === undefined ? null : 1,
      columns.cancelledAt ?? null,
    ],
  );
};

const planOf = (
  overrides: Partial<Parameters<typeof planPaidSponsorship>[0]> = {},
): PaidSponsorshipPlan =>
  planPaidSponsorship({
    product: PRODUCT,
    tier: 'gold',
    startsOn: TODAY,
    endsOn: '2026-11-24',
    now: NOW,
    nextId,
    ...overrides,
  });

beforeEach(async () => {
  idCount = 0;
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
  insertUser(OWNER_ID);
  insertProduct(PRODUCT_ID, HANDLE);
  insertLaunch(LAUNCH_ID, PRODUCT_ID);
});

afterEach(() => {
  db.close();
});

describe('sponsorProductSql・parseSponsorProduct', () => {
  test('ハンドルからプロダクト・投稿者・未確定のローンチのIDを読む', () => {
    insertLaunch('L0', PRODUCT_ID, {
      launchDate: '2026-11-01',
      outcome: 'lost',
    });

    expect(
      parseSponsorProduct(queryRows(sponsorProductSql(HANDLE)), HANDLE),
    ).toEqual(PRODUCT);
  });

  test('ハンドルの大文字と小文字を区別しない', () => {
    const handle = HANDLE.toUpperCase();

    expect(
      parseSponsorProduct(queryRows(sponsorProductSql(handle)), handle),
    ).toEqual(PRODUCT);
  });

  test('削除したプロダクトと、未確定のローンチが無いプロダクトは見つからない', () => {
    insertProduct('P2', 'e2e-deleted', { deletedAt: 1 });
    insertLaunch('L2', 'P2');
    insertProduct('P3', 'e2e-canceled');
    insertLaunch('L3', 'P3', { cancelledAt: 1 });

    for (const handle of ['e2e-deleted', 'e2e-canceled', 'e2e-missing']) {
      expect(() =>
        parseSponsorProduct(queryRows(sponsorProductSql(handle)), handle),
      ).toThrow(
        `プロダクト(${handle})の未確定のローンチが見つかりません。画面で登録したプロダクトのハンドルを指定してください`,
      );
    }
  });

  test('引用符を含むハンドルも文字列のリテラルとして照会する', () => {
    const handle = "it's'; DROP TABLE products; --";

    expect(queryRows(sponsorProductSql(handle))).toEqual([]);
    expect(queryRows('SELECT id FROM products')).toEqual([{ id: PRODUCT_ID }]);
  });

  test('照会の結果の形式が違えば失敗する', () => {
    expect(() =>
      parseSponsorProduct(
        [{ product_id: 'P1', owner_user_id: 1, launch_id: 'L1' }],
        HANDLE,
      ),
    ).toThrow('プロダクトの照会の結果の形式が正しくありません');
  });
});

describe('launchKickOffSql・parseLaunchKickOff', () => {
  const kickOff = { launchDate: YESTERDAY, today: TODAY, now: NOW };

  test('未確定のローンチのローンチ日とプロダクトの最新のローンチ日を過去の日にする', () => {
    const rows = executeAll(launchKickOffSql(PRODUCT, kickOff));

    expect(() => {
      parseLaunchKickOff(rows, PRODUCT);
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT launch_date, outcome, cancelled_at, updated_at FROM product_launches WHERE id = '${LAUNCH_ID}'`,
      ),
    ).toEqual([
      {
        launch_date: YESTERDAY,
        outcome: null,
        cancelled_at: null,
        updated_at: NOW.getTime(),
      },
    ]);
    expect(
      queryRows(
        `SELECT latest_launch_date FROM products WHERE id = '${PRODUCT_ID}'`,
      ),
    ).toEqual([{ latest_launch_date: YESTERDAY }]);
  });

  test('照会の後に確定・取消になったローンチは書き換えず、失敗する', () => {
    db.run(
      `UPDATE product_launches SET cancelled_at = 1 WHERE id = '${LAUNCH_ID}'`,
    );

    const rows = executeAll(launchKickOffSql(PRODUCT, kickOff));

    expect(() => {
      parseLaunchKickOff(rows, PRODUCT);
    }).toThrow(
      `プロダクト(${PRODUCT_ID})の未確定のローンチ(${LAUNCH_ID})のローンチ日を書き換えられませんでした`,
    );
    expect(
      queryRows(
        `SELECT latest_launch_date FROM products WHERE id = '${PRODUCT_ID}'`,
      ),
    ).toEqual([{ latest_launch_date: FUTURE_LAUNCH_DATE }]);
  });

  test('ローンチ日は今日より前の業務日付でなければ失敗する', () => {
    for (const launchDate of [TODAY, '2026-11-19']) {
      expect(() =>
        launchKickOffSql(PRODUCT, { ...kickOff, launchDate }),
      ).toThrow(
        `キックオフ済みにするローンチ日は今日(${TODAY})より前の日付で指定してください: ${launchDate}`,
      );
    }
    for (const launchDate of ['2026-11-1', '2026-02-30']) {
      expect(() =>
        launchKickOffSql(PRODUCT, { ...kickOff, launchDate }),
      ).toThrow(
        `業務日付はYYYY-MM-DDの実在する日付で指定してください: ${launchDate}`,
      );
    }
  });
});

describe('launchLossSql・parseLaunchLoss', () => {
  const decision = { today: TODAY, now: NOW };

  const kickOffLaunch = (): void => {
    db.run(
      `UPDATE product_launches SET launch_date = '${YESTERDAY}' WHERE id = '${LAUNCH_ID}'`,
    );
  };

  test('キックオフ済みの未確定のローンチを敗北で確定させ、確定の日時を記録する', () => {
    kickOffLaunch();

    const rows = executeAll(launchLossSql(PRODUCT, decision));

    expect(() => {
      parseLaunchLoss(rows, PRODUCT);
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT launch_date, outcome, decided_at, cancelled_at, updated_at FROM product_launches WHERE id = '${LAUNCH_ID}'`,
      ),
    ).toEqual([
      {
        launch_date: YESTERDAY,
        outcome: 'lost',
        decided_at: NOW.getTime(),
        cancelled_at: null,
        updated_at: NOW.getTime(),
      },
    ]);
  });

  test('キックオフ前・確定済み・取消済みのローンチは書き換えず、失敗する', () => {
    const states = [
      () => undefined,
      () => {
        kickOffLaunch();
        db.run(
          `UPDATE product_launches SET outcome = 'won', decided_at = 1 WHERE id = '${LAUNCH_ID}'`,
        );
      },
      () => {
        kickOffLaunch();
        db.run(
          `UPDATE product_launches SET cancelled_at = 1 WHERE id = '${LAUNCH_ID}'`,
        );
      },
    ];
    for (const arrange of states) {
      db.run(
        `UPDATE product_launches SET launch_date = '${FUTURE_LAUNCH_DATE}', outcome = NULL, decided_at = NULL, cancelled_at = NULL WHERE id = '${LAUNCH_ID}'`,
      );
      arrange();
      const before = queryRows(
        `SELECT outcome, decided_at, updated_at FROM product_launches WHERE id = '${LAUNCH_ID}'`,
      );

      const rows = executeAll(launchLossSql(PRODUCT, decision));

      expect(() => {
        parseLaunchLoss(rows, PRODUCT);
      }).toThrow(
        `プロダクト(${PRODUCT_ID})のキックオフ済みの未確定のローンチ(${LAUNCH_ID})を敗北で確定できませんでした`,
      );
      expect(
        queryRows(
          `SELECT outcome, decided_at, updated_at FROM product_launches WHERE id = '${LAUNCH_ID}'`,
        ),
      ).toEqual(before);
    }
  });

  test('今日は実在する業務日付でなければ失敗する', () => {
    expect(() =>
      launchLossSql(PRODUCT, { ...decision, today: '2026-02-30' }),
    ).toThrow(
      '業務日付はYYYY-MM-DDの実在する日付で指定してください: 2026-02-30',
    );
  });
});

describe('planPaidSponsorship', () => {
  test('期間の日数とティアの単価から合計を求め、申込・購入・決済の記録のIDを採番する', () => {
    expect(planOf()).toEqual({
      sponsorshipId: 'ID0001',
      purchaseId: 'ID0002',
      paymentRecordId: 'ID0003',
      productId: PRODUCT_ID,
      ownerUserId: OWNER_ID,
      tier: 'gold',
      startsOn: TODAY,
      endsOn: '2026-11-24',
      days: 7,
      unitAmount: FIXTURE_DAILY_UNIT_AMOUNTS.gold,
      amountTotal: FIXTURE_DAILY_UNIT_AMOUNTS.gold * 7,
      now: NOW,
    });
  });

  test('単価は料金表の1日あたりの価格(セント)にする', () => {
    expect(FIXTURE_DAILY_UNIT_AMOUNTS).toEqual({
      legend: 2_000,
      gold: 800,
      silver: 300,
    });
    expect(
      planOf({ tier: 'legend', startsOn: TODAY, endsOn: TODAY }),
    ).toMatchObject({ days: 1, amountTotal: 2_000 });
    expect(
      planOf({ tier: 'silver', startsOn: '2026-12-30', endsOn: '2027-01-02' }),
    ).toMatchObject({ days: 4, amountTotal: 1_200 });
  });

  test('期間は1〜366日の実在する日付でなければ失敗する', () => {
    expect(() => planOf({ startsOn: TODAY, endsOn: YESTERDAY })).toThrow(
      `掲載期間は開始日から1〜366日の範囲で指定してください: ${TODAY}〜${YESTERDAY}`,
    );
    expect(() => planOf({ startsOn: TODAY, endsOn: '2027-11-19' })).toThrow(
      `掲載期間は開始日から1〜366日の範囲で指定してください: ${TODAY}〜2027-11-19`,
    );
    expect(() =>
      planOf({ startsOn: TODAY, endsOn: '2027-11-18' }),
    ).not.toThrow();
    expect(() => planOf({ startsOn: '2026-11-31' })).toThrow(
      '業務日付はYYYY-MM-DDの実在する日付で指定してください: 2026-11-31',
    );
  });
});

describe('paidSponsorshipInsertSql・parsePaidSponsorshipInsert', () => {
  test('決済済みの申込と、それに対応する決済済みの購入の行を作る', () => {
    const plan = planOf();

    const rows = executeAll(paidSponsorshipInsertSql(plan));

    expect(() => {
      parsePaidSponsorshipInsert(rows, plan);
    }).not.toThrow();
    const at = NOW.getTime();
    expect(
      queryRows(
        `SELECT id, user_id, product_id, tier, starts_on, ends_on, days, state, purchase_id, payment_record_id, amount_total, paid_at, terminated_at, start_notice, end_notice, termination_notice, stop_refund_status, termination_refund_status, product_deleted_at, created_at, updated_at, deleted_at FROM sponsorships`,
      ),
    ).toEqual([
      {
        id: plan.sponsorshipId,
        user_id: OWNER_ID,
        product_id: PRODUCT_ID,
        tier: 'gold',
        starts_on: TODAY,
        ends_on: '2026-11-24',
        days: 7,
        state: 'paid',
        purchase_id: plan.purchaseId,
        payment_record_id: plan.paymentRecordId,
        amount_total: 5_600,
        paid_at: at,
        terminated_at: null,
        start_notice: 'none',
        end_notice: 'none',
        termination_notice: 'none',
        stop_refund_status: 'none',
        termination_refund_status: 'none',
        product_deleted_at: null,
        created_at: at,
        updated_at: at,
        deleted_at: null,
      },
    ]);
    expect(
      queryRows(
        `SELECT id, user_id, kind, target_id, related_id, exclusivity_key, status, price_lookup_key, unit_amount, quantity, amount_total, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, reflected_at, summary_json FROM payment_purchases`,
      ),
    ).toEqual([
      {
        id: plan.purchaseId,
        user_id: OWNER_ID,
        kind: 'sponsorship',
        target_id: plan.sponsorshipId,
        related_id: plan.sponsorshipId,
        exclusivity_key: `sponsorship:${plan.sponsorshipId}`,
        status: 'fulfilled',
        price_lookup_key: 'sponsorship_gold_daily',
        unit_amount: 800,
        quantity: 7,
        amount_total: 5_600,
        stripe_checkout_session_id: `cs_test_e2e_sponsorship_${plan.sponsorshipId}`,
        stripe_payment_intent_id: `pi_test_e2e_sponsorship_${plan.sponsorshipId}`,
        paid_at: at,
        reflected_at: at,
        summary_json: JSON.stringify({
          itemName: 'スポンサー広告(Gold)',
          quantityLabel: '7日間',
          serviceTiming: '選んだ掲載期間',
          additionalNotes: [],
        }),
      },
    ]);
  });

  test('同じプロダクト・ティアの決済済みの申込と期間が重なれば、申込も購入も作らずに失敗する', () => {
    executeAll(paidSponsorshipInsertSql(planOf()));
    const overlapping = planOf({
      startsOn: '2026-11-24',
      endsOn: '2026-11-30',
    });

    const rows = executeAll(paidSponsorshipInsertSql(overlapping));

    expect(() => {
      parsePaidSponsorshipInsert(rows, overlapping);
    }).toThrow(
      `プロダクト(${PRODUCT_ID})のGoldの決済済みの申込(2026-11-24〜2026-11-30)を作れませんでした。同じプロダクト・ティアの決済済みの申込と期間が重なっていないか確かめてください`,
    );
    expect(queryRows('SELECT COUNT(*) AS count FROM sponsorships')).toEqual([
      { count: 1 },
    ]);
    expect(
      queryRows('SELECT COUNT(*) AS count FROM payment_purchases'),
    ).toEqual([{ count: 1 }]);
  });

  test('別のティアや、重ならない期間なら同じプロダクトにも作れる', () => {
    executeAll(paidSponsorshipInsertSql(planOf()));

    for (const plan of [
      planOf({ tier: 'silver' }),
      planOf({ startsOn: '2026-11-25', endsOn: '2026-11-25' }),
    ]) {
      expect(() => {
        parsePaidSponsorshipInsert(
          executeAll(paidSponsorshipInsertSql(plan)),
          plan,
        );
      }).not.toThrow();
    }
  });
});
