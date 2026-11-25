import { COMMENT_MAX_GRAPHEMES } from '../../../../common-lib/engagement/engagement-rules.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../common-lib/product/product-category-constants.ts';
import {
  PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  PRODUCT_NAME_MAX_GRAPHEMES,
  PRODUCT_TAGLINE_MAX_GRAPHEMES,
} from '../../../../common-lib/product/product-input-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  HEADLINE_MAX_GRAPHEMES,
  PROFILE_WEBSITES_MAX,
  WEBSITE_NAME_MAX_GRAPHEMES,
} from '../../../../common-lib/profile/profile-input-rules.ts';
import { launchComments } from '../../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../../db/schema/engagement/product-ratings.ts';
import { userFollows } from '../../../../db/schema/follow/user-follows.ts';
import { inquiryMessages } from '../../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../../db/schema/inquiry/member-inquiries.ts';
import { productLaunches } from '../../../../db/schema/product/product-launches.ts';
import { products } from '../../../../db/schema/product/products.ts';
import { userProfileWebsites } from '../../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../../db/schema/profile/user-profiles.ts';
import {
  addBusinessDays,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import { markdownBodyOf, plainTextOf } from '../document-text.ts';
import {
  DEFAULT_LOGO_FILE_ID,
  adminAt,
  baseInstantOf,
  launchOf,
  productAt,
  userAt,
  type EntityContext,
} from '../entities.ts';
import { deterministicUlid } from '../random.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

// 上限のある項目は上限まで、上限の無い項目(件数)は、データエクスポートの生成の負荷を測るのに足りる固定の件数にする。どの規模でも縮小しない(件数は利用者・プロダクトの数が上限になる評価とフォローを除く)
export const EXPORT_HEAVY_USER_COUNTS = Object.freeze({
  products: 20,
  comments: 500,
  ratings: 500,
  follows: 500,
  inquiries: 3,
  messagesPerInquiry: 20,
});

const DAY_MS = 86_400_000;

const MINUTE_MS = 60_000;

const INQUIRY_CATEGORY_ID = '01JC0000000000000000000000';

const FIRST_LAUNCH_OFFSET_DAYS = 3;

const CHAT_MESSAGE_MAX_GRAPHEMES = 1_000;

const PRODUCT_AGE_DAYS = 20;

const COMMENT_AGE_DAYS = 10;

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
  ...(context.logoFileId === undefined
    ? {}
    : { logoFileId: context.logoFileId }),
});

const exportUserIdOf = (
  entities: EntityContext,
  context: DatasetContext,
): string =>
  context.exportUserId ?? userAt(entities, entities.profile.users - 1).id;

const numberOf = (index: number): string => String(index + 1).padStart(2, '0');

// 同じ出力を2回適用しても、既にある行を壊さず重複させない
function* ignoringConflicts(
  statements: Iterable<SqlStatement>,
): Generator<SqlStatement> {
  for (const statement of statements) {
    yield {
      ...statement,
      text: statement.text.replace(/;$/u, ' ON CONFLICT DO NOTHING;'),
    };
  }
}

// 既存の利用者のプロフィール・ウェブサイトは、行が既にあっても上限まで入れた値で上書きする
function* upserting(
  statements: Iterable<SqlStatement>,
  conflict: string,
  assignments: string,
  insertedRows: number,
): Generator<SqlStatement> {
  for (const statement of statements) {
    yield {
      ...statement,
      text: statement.text.replace(
        /;$/u,
        ` ON CONFLICT(${conflict}) DO UPDATE SET ${assignments};`,
      ),
      insertedRows,
    };
  }
}

function* profileStatements(
  entities: EntityContext,
  userId: string,
  at: Date,
): Generator<SqlStatement> {
  const row: SqlRow = {
    id: deterministicUlid(at, `${String(entities.seed)}:export-profile`),
    userId,
    headline: plainTextOf(HEADLINE_MAX_GRAPHEMES, '上限の見出し: '),
    bioMarkdown: markdownBodyOf(BIO_MAX_GRAPHEMES),
    createdAt: at,
    updatedAt: at,
  };
  yield* upserting(
    insertStatements(userProfiles, [row]),
    'user_id',
    'headline = excluded.headline, bio_markdown = excluded.bio_markdown, updated_at = excluded.updated_at',
    0,
  );
  const websites = Array.from(
    { length: PROFILE_WEBSITES_MAX },
    (_, position): SqlRow => ({
      id: deterministicUlid(
        at,
        `${String(entities.seed)}:export-website:${String(position)}`,
      ),
      userId,
      position,
      name: plainTextOf(
        WEBSITE_NAME_MAX_GRAPHEMES,
        `サイト${numberOf(position)}: `,
      ),
      url: `https://synthetic-export-${numberOf(position)}.example`,
      createdAt: at,
      updatedAt: at,
    }),
  );
  yield* upserting(
    insertStatements(userProfileWebsites, websites),
    'user_id, position',
    'name = excluded.name, url = excluded.url, updated_at = excluded.updated_at',
    1,
  );
}

interface ExportProduct {
  readonly id: string;
  readonly launchId: string;
  readonly createdAt: Date;
}

function exportProductsOf(
  entities: EntityContext,
  userId: string,
  base: number,
): { rows: SqlRow[]; launches: SqlRow[]; planned: ExportProduct[] } {
  const createdAt = new Date(base - PRODUCT_AGE_DAYS * DAY_MS);
  const businessBase = parseBusinessDate(entities.baseDate);
  const rows: SqlRow[] = [];
  const launches: SqlRow[] = [];
  const planned: ExportProduct[] = [];
  for (let index = 0; index < EXPORT_HEAVY_USER_COUNTS.products; index += 1) {
    const key = `${String(entities.seed)}:export-product:${String(index)}`;
    const id = deterministicUlid(createdAt, key);
    const launchId = deterministicUlid(createdAt, `${key}:launch`);
    const launchDate = addBusinessDays(
      businessBase,
      FIRST_LAUNCH_OFFSET_DAYS + index,
    );
    rows.push({
      id,
      userId,
      categoryId: PRODUCT_CATEGORY_OTHER_ID,
      handle: `synthetic-export-p-${numberOf(index)}`,
      name: plainTextOf(
        PRODUCT_NAME_MAX_GRAPHEMES,
        `上限のプロダクト${numberOf(index)}: `,
      ),
      tagline: plainTextOf(
        PRODUCT_TAGLINE_MAX_GRAPHEMES,
        `上限のキャッチコピー${numberOf(index)}: `,
      ),
      websiteUrl: `https://synthetic-export-product-${numberOf(index)}.example`,
      descriptionMarkdown: markdownBodyOf(PRODUCT_DESCRIPTION_MAX_GRAPHEMES),
      logoFileId: entities.logoFileId ?? DEFAULT_LOGO_FILE_ID,
      latestLaunchDate: launchDate,
      createdAt,
      updatedAt: createdAt,
    });
    launches.push({
      id: launchId,
      productId: id,
      launchDate,
      createdAt,
      updatedAt: createdAt,
    });
    planned.push({ id, launchId, createdAt });
  }
  return { rows, launches, planned };
}

function* commentRows(
  entities: EntityContext,
  userId: string,
  base: number,
): Generator<SqlRow> {
  const { products: productCount } = entities.profile;
  for (let index = 0; index < EXPORT_HEAVY_USER_COUNTS.comments; index += 1) {
    const targetIndex = (index * 7 + 5) % productCount;
    const createdAt = new Date(
      base - COMMENT_AGE_DAYS * DAY_MS + index * MINUTE_MS,
    );
    const id = deterministicUlid(
      createdAt,
      `${String(entities.seed)}:export-comment:${String(index)}`,
    );
    yield {
      id,
      productId: productAt(entities, targetIndex).id,
      launchId: launchOf(entities, targetIndex).id,
      parentId: null,
      rootId: id,
      depth: 1,
      authorUserId: userId,
      body: plainTextOf(
        COMMENT_MAX_GRAPHEMES,
        `上限のコメント${String(index + 1)}: `,
      ),
      createdAt,
      updatedAt: createdAt,
    };
  }
}

function* ratingRows(
  entities: EntityContext,
  userId: string,
  base: number,
): Generator<SqlRow> {
  const count = Math.min(
    EXPORT_HEAVY_USER_COUNTS.ratings,
    entities.profile.products,
  );
  for (let index = 0; index < count; index += 1) {
    const createdAt = new Date(base - 5 * DAY_MS + index * MINUTE_MS);
    yield {
      id: deterministicUlid(
        createdAt,
        `${String(entities.seed)}:export-rating:${String(index)}`,
      ),
      productId: productAt(entities, index).id,
      userId,
      score: (index % 5) + 1,
      createdAt,
      updatedAt: createdAt,
    };
  }
}

function* followRows(
  entities: EntityContext,
  userId: string,
  base: number,
): Generator<SqlRow> {
  const count = Math.min(
    EXPORT_HEAVY_USER_COUNTS.follows,
    entities.profile.users - 1,
  );
  for (let index = 0; index < count; index += 1) {
    const createdAt = new Date(base - 3 * DAY_MS + index * MINUTE_MS);
    yield {
      id: deterministicUlid(
        createdAt,
        `${String(entities.seed)}:export-follow:${String(index)}`,
      ),
      followerId: userId,
      followeeId: userAt(entities, index).id,
      createdAt,
      updatedAt: createdAt,
    };
  }
}

function inquiryRowsOf(
  entities: EntityContext,
  userId: string,
  base: number,
): { inquiries: SqlRow[]; messages: SqlRow[] } {
  const inquiries: SqlRow[] = [];
  const messages: SqlRow[] = [];
  const adminId = adminAt(entities, 0).id;
  for (let index = 0; index < EXPORT_HEAVY_USER_COUNTS.inquiries; index += 1) {
    const startedAt = base - (7 - index) * DAY_MS;
    const inquiryId = deterministicUlid(
      new Date(startedAt),
      `${String(entities.seed)}:export-inquiry:${String(index)}`,
    );
    const lastAt = new Date(
      startedAt + (EXPORT_HEAVY_USER_COUNTS.messagesPerInquiry - 1) * MINUTE_MS,
    );
    inquiries.push({
      id: inquiryId,
      userId,
      categoryId: INQUIRY_CATEGORY_ID,
      status: 'open',
      statusChangedAt: new Date(startedAt),
      lastMessageAt: lastAt,
      createdAt: new Date(startedAt),
      updatedAt: lastAt,
    });
    for (
      let position = 0;
      position < EXPORT_HEAVY_USER_COUNTS.messagesPerInquiry;
      position += 1
    ) {
      const at = new Date(startedAt + position * MINUTE_MS);
      const fromAdmin = position % 2 === 1;
      messages.push({
        id: deterministicUlid(
          at,
          `${String(entities.seed)}:export-message:${String(index)}:${String(position)}`,
        ),
        inquiryId,
        senderKind: fromAdmin ? 'admin' : 'user',
        adminId: fromAdmin ? adminId : null,
        body: plainTextOf(
          CHAT_MESSAGE_MAX_GRAPHEMES,
          `上限のメッセージ${String(position + 1)}: `,
        ),
        createdAt: at,
      });
    }
  }
  return { inquiries, messages };
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  const userId = exportUserIdOf(entities, context);
  const base = baseInstantOf(context.baseDate).getTime();
  const exportProducts = exportProductsOf(entities, userId, base);
  const inquiry = inquiryRowsOf(entities, userId, base);
  yield* profileStatements(entities, userId, new Date(base - 30 * DAY_MS));
  yield* ignoringConflicts(insertStatements(products, exportProducts.rows));
  yield* ignoringConflicts(
    insertStatements(productLaunches, exportProducts.launches),
  );
  yield* ignoringConflicts(
    insertStatements(launchComments, commentRows(entities, userId, base)),
  );
  yield* ignoringConflicts(
    insertStatements(productRatings, ratingRows(entities, userId, base)),
  );
  yield* ignoringConflicts(
    insertStatements(userFollows, followRows(entities, userId, base)),
  );
  yield* ignoringConflicts(
    insertStatements(memberInquiries, inquiry.inquiries),
  );
  yield* ignoringConflicts(insertStatements(inquiryMessages, inquiry.messages));
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  return {
    exportHeavyUserId: [
      exportUserIdOf(entityContextOf(profile, context), context),
    ],
  };
}

export const exportHeavyUserDataset: SyntheticDataset = {
  name: 'export-heavy-user',
  dependsOn: ['users', 'products', 'moderation'],
  generate,
  samples,
};
