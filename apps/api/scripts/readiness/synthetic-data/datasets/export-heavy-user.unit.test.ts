import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { COMMENT_MAX_GRAPHEMES } from '../../../../common-lib/engagement/engagement-rules.ts';
import {
  PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  PRODUCT_NAME_MAX_GRAPHEMES,
  PRODUCT_TAGLINE_MAX_GRAPHEMES,
} from '../../../../common-lib/product/product-input-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  HEADLINE_MAX_GRAPHEMES,
  PROFILE_WEBSITES_MAX,
} from '../../../../common-lib/profile/profile-input-rules.ts';
import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { userAt, type EntityContext } from '../entities.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import {
  MAX_STATEMENT_BYTES,
  type DatasetContext,
  type SqlStatement,
} from '../sql-writer.ts';
import { commentsDataset } from './comments.ts';
import {
  EXPORT_HEAVY_USER_COUNTS,
  exportHeavyUserDataset,
} from './export-heavy-user.ts';
import { matchesDataset } from './matches.ts';
import { moderationDataset } from './moderation.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const BASE_DATE = '2026-11-24';

const EXISTING_USER_ID = '01JCDEFGHJKMNPQRSTVWXYZ012';

const context: DatasetContext = { seed: 1, baseDate: BASE_DATE };

const entities: EntityContext = {
  seed: 1,
  baseDate: BASE_DATE,
  profile: SMOKE_PROFILE,
};

const syntheticExportUserId = userAt(entities, SMOKE_PROFILE.users - 1).id;

let db: Database;

const apply = (
  dataset: {
    generate(
      p: typeof SMOKE_PROFILE,
      c: DatasetContext,
    ): Iterable<SqlStatement>;
  },
  c: DatasetContext = context,
): void => {
  for (const statement of dataset.generate(SMOKE_PROFILE, c)) {
    db.run(statement.text);
  }
};

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

beforeEach(() => {
  db = createMigratedDatabase();
  for (const dataset of [
    usersDataset,
    productsDataset,
    matchesDataset,
    commentsDataset,
    moderationDataset,
  ]) {
    apply(dataset);
  }
});

afterEach(() => {
  db.close();
});

describe('exportHeavyUserDataset(既定は合成の利用者)', () => {
  test('利用者・プロダクトの後に並び、名前はexport-heavy-userになる', () => {
    expect(exportHeavyUserDataset.name).toBe('export-heavy-user');
    expect(exportHeavyUserDataset.dependsOn).toEqual([
      'users',
      'products',
      'moderation',
    ]);
  });

  test('最後の合成の利用者に結び付き、利用者の行は作らず、外部キーの違反が無い', () => {
    const statements = [
      ...exportHeavyUserDataset.generate(SMOKE_PROFILE, context),
    ];
    apply(exportHeavyUserDataset);

    expect(statements.some((s) => s.table === 'users')).toBe(false);
    expect(
      scalar(
        `SELECT count(*) FROM products WHERE user_id = '${syntheticExportUserId}' AND handle LIKE 'synthetic-export-p-%'`,
      ),
    ).toBe(EXPORT_HEAVY_USER_COUNTS.products);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('プロフィールの見出し・自己紹介・ウェブサイトが上限の文字数・件数になる', () => {
    apply(exportHeavyUserDataset);

    const profile = db
      .query<{ headline: string; bio: string }, [string]>(
        'SELECT headline, bio_markdown AS bio FROM user_profiles WHERE user_id = ?',
      )
      .get(syntheticExportUserId);
    expect(countGraphemes(profile?.headline ?? '')).toBe(
      HEADLINE_MAX_GRAPHEMES,
    );
    expect(countGraphemes(profile?.bio ?? '')).toBe(BIO_MAX_GRAPHEMES);
    expect(
      scalar(
        `SELECT count(*) FROM user_profile_websites WHERE user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(PROFILE_WEBSITES_MAX);
    expect(
      scalar(
        `SELECT count(*) FROM user_profile_websites WHERE url NOT LIKE 'https://%.example'`,
      ),
    ).toBe(0);
    expect(scalar('SELECT count(*) FROM user_profiles')).toBe(
      SMOKE_PROFILE.users,
    );
  });

  test('プロダクトの名前・キャッチコピー・説明が上限の文字数で、全てローンチを持つ', () => {
    apply(exportHeavyUserDataset);

    const rows = db
      .query<{ name: string; tagline: string; description: string }, [string]>(
        `SELECT name, tagline, description_markdown AS description FROM products WHERE user_id = ? AND handle LIKE 'synthetic-export-p-%'`,
      )
      .all(syntheticExportUserId);
    expect(rows).toHaveLength(EXPORT_HEAVY_USER_COUNTS.products);
    for (const row of rows) {
      expect(countGraphemes(row.name)).toBe(PRODUCT_NAME_MAX_GRAPHEMES);
      expect(countGraphemes(row.tagline)).toBe(PRODUCT_TAGLINE_MAX_GRAPHEMES);
      expect(countGraphemes(row.description)).toBe(
        PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
      );
    }
    expect(
      scalar(
        `SELECT count(*) FROM products p WHERE p.user_id = '${syntheticExportUserId}' AND p.handle LIKE 'synthetic-export-p-%' AND NOT EXISTS (SELECT 1 FROM product_launches l WHERE l.product_id = p.id)`,
      ),
    ).toBe(0);
  });

  test('コメントが上限の文字数で、評価・フォロー・問い合わせの記録を作る', () => {
    apply(exportHeavyUserDataset);

    expect(
      scalar(
        `SELECT count(*) FROM launch_comments WHERE author_user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(EXPORT_HEAVY_USER_COUNTS.comments);
    const bodies = db
      .query<{ body: string }, [string]>(
        'SELECT body FROM launch_comments WHERE author_user_id = ?',
      )
      .all(syntheticExportUserId);
    for (const { body } of bodies) {
      expect(countGraphemes(body)).toBe(COMMENT_MAX_GRAPHEMES);
    }
    expect(
      scalar(
        `SELECT count(*) FROM product_ratings WHERE user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(Math.min(EXPORT_HEAVY_USER_COUNTS.ratings, SMOKE_PROFILE.products));
    expect(
      scalar(
        `SELECT count(*) FROM user_follows WHERE follower_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(Math.min(EXPORT_HEAVY_USER_COUNTS.follows, SMOKE_PROFILE.users - 1));
    expect(
      scalar(
        `SELECT count(*) FROM member_inquiries WHERE user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(EXPORT_HEAVY_USER_COUNTS.inquiries);
    expect(
      scalar(
        `SELECT count(*) FROM inquiry_messages m JOIN member_inquiries i ON i.id = m.inquiry_id WHERE i.user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(
      EXPORT_HEAVY_USER_COUNTS.inquiries *
        EXPORT_HEAVY_USER_COUNTS.messagesPerInquiry,
    );
  });

  test('全ての文が90,000バイト以下で改行を含まない', () => {
    for (const { text } of exportHeavyUserDataset.generate(
      YEAR_ONE_PROFILE,
      context,
    )) {
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
        MAX_STATEMENT_BYTES,
      );
      expect(text.includes('\n')).toBe(false);
    }
  });

  test('同じ種と基準日なら同じ文を出し、見本に利用者のIDを残す', () => {
    const take = (): string[] =>
      [...exportHeavyUserDataset.generate(SMOKE_PROFILE, context)].map(
        (s) => s.text,
      );

    expect(take()).toEqual(take());
    expect(exportHeavyUserDataset.samples?.(SMOKE_PROFILE, context)).toEqual({
      exportHeavyUserId: [syntheticExportUserId],
    });
  });
});

describe('exportHeavyUserDataset(既存の利用者へ結び付ける)', () => {
  const withExisting: DatasetContext = {
    ...context,
    exportUserId: EXISTING_USER_ID,
  };

  beforeEach(() => {
    db.run(
      `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, terms_agreed_at, created_at, updated_at) VALUES ('${EXISTING_USER_ID}', 'e0e0e0e0-0000-4000-8000-000000000000', 'existing@readiness.example', 'x', '既存', 'existing-user', 0, 0, 0)`,
    );
  });

  test('渡したIDの利用者に全てを結び付け、合成の最後の利用者には何も付けない', () => {
    apply(exportHeavyUserDataset, withExisting);

    expect(
      scalar(
        `SELECT count(*) FROM products WHERE user_id = '${EXISTING_USER_ID}' AND handle LIKE 'synthetic-export-p-%'`,
      ),
    ).toBe(EXPORT_HEAVY_USER_COUNTS.products);
    expect(
      scalar(
        `SELECT count(*) FROM launch_comments WHERE author_user_id = '${syntheticExportUserId}'`,
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM user_profile_websites WHERE user_id = '${EXISTING_USER_ID}'`,
      ),
    ).toBe(PROFILE_WEBSITES_MAX);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('既存の利用者のプロフィールが既にあっても上書きで上限の文字数にでき、2回適用しても重複しない', () => {
    db.run(
      `INSERT INTO user_profiles (id, user_id, headline, created_at, updated_at) VALUES ('01JCDEFGHJKMNPQRSTVWXYZ0AA', '${EXISTING_USER_ID}', '古い', 0, 0)`,
    );

    apply(exportHeavyUserDataset, withExisting);
    apply(exportHeavyUserDataset, withExisting);

    const profile = db
      .query<{ headline: string }, [string]>(
        'SELECT headline FROM user_profiles WHERE user_id = ?',
      )
      .get(EXISTING_USER_ID);
    expect(countGraphemes(profile?.headline ?? '')).toBe(
      HEADLINE_MAX_GRAPHEMES,
    );
    expect(
      scalar(
        `SELECT count(*) FROM user_profile_websites WHERE user_id = '${EXISTING_USER_ID}'`,
      ),
    ).toBe(PROFILE_WEBSITES_MAX);
    expect(
      scalar(
        `SELECT count(*) FROM product_ratings WHERE user_id = '${EXISTING_USER_ID}'`,
      ),
    ).toBe(Math.min(EXPORT_HEAVY_USER_COUNTS.ratings, SMOKE_PROFILE.products));
  });

  test('見本には渡した利用者のIDを残す', () => {
    expect(
      exportHeavyUserDataset.samples?.(SMOKE_PROFILE, withExisting),
    ).toEqual({
      exportHeavyUserId: [EXISTING_USER_ID],
    });
  });
});
