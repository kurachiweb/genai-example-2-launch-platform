import { qualifierWindow } from '../../apps/backend-lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../apps/backend-lib/core/time/business-time.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import { type LocalD1Row, sqlStringLiteral } from './local-d1.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';

export interface EndedQualifierInput {
  readonly winnerHandle: string;
  readonly loserHandle: string;
  readonly supporterHandle: string;
  readonly businessDate: string;
}

export interface QualifierSide {
  readonly productId: string;
  readonly launchId: string;
  readonly ownerUserId: string;
}

export interface ResolvedQualifier {
  readonly winner: QualifierSide;
  readonly loser: QualifierSide;
  readonly supporterUserId: string;
}

export interface EndedQualifierIds {
  readonly matchId: string;
  readonly winnerEntryId: string;
  readonly loserEntryId: string;
  readonly upvoteId: string;
}

export interface EndedQualifierWrite {
  readonly businessDate: string;
  readonly now: Date;
  readonly ids: EndedQualifierIds;
}

export interface ListedProductsInput {
  readonly count: number;
  readonly matchDate: string;
  readonly now: Date;
  readonly suffix: string;
  readonly nextId: () => string;
}

export interface ListedProductsOwner {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
}

export interface PlannedListedProduct {
  readonly productId: string;
  readonly launchId: string;
  readonly matchId: string;
  readonly entryId: string;
  readonly decidedEventId: string;
  readonly logoFileId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly websiteUrl: string;
}

export interface ListedProductsPlan {
  readonly owner: ListedProductsOwner;
  readonly products: readonly PlannedListedProduct[];
  readonly matchDate: string;
  readonly now: Date;
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ID_TIME_LENGTH = 10;

const ID_RANDOM_LENGTH = 16;

export const ID_RANDOM_BYTES = 10;

const MAX_ID_TIME = 2 ** 48;

const MINUTE_MS = 60_000;

// 確定のジョブは実行の時刻で終了の日時を過ぎたマッチを選ぶため、作る時点より前の時刻を順に並べる
const STARTED_AGO_MS = 3 * MINUTE_MS;
const UPVOTED_AGO_MS = 2 * MINUTE_MS;
const ENDED_AGO_MS = MINUTE_MS;

const MAX_LISTED_PRODUCTS = 99;

const LISTED_NUMBER_WIDTH = 2;

const SUFFIX_PATTERN = /^[0-9a-z]{4,12}$/u;

// ログインさせない利用者のため、どのパスワードの検証にも一致しない値にする
const UNUSABLE_PASSWORD_HASH = sqlStringLiteral('e2e-fixture-unusable');

const QUALIFIER = sqlStringLiteral('qualifier');

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const timeLiteral = (at: Date): string => integerLiteral(at.getTime());

const valuesOf = (values: readonly string[]): string =>
  `(${values.join(', ')})`;

// IDの形式を検査する照会(サポーターの一覧など)にも通るよう、アプリと同じULIDの形式で採番する
export function fixtureId(at: Date, random: Uint8Array): string {
  const time = at.getTime();
  if (!Number.isSafeInteger(time) || time < 0 || time >= MAX_ID_TIME) {
    throw new RangeError(`IDの時刻は48ビットに収めてください: ${String(time)}`);
  }
  if (random.length !== ID_RANDOM_BYTES) {
    throw new RangeError(
      `IDの乱数は${String(ID_RANDOM_BYTES)}バイトで指定してください: ${String(random.length)}`,
    );
  }
  let timePart = '';
  let remainingTime = time;
  for (let index = 0; index < ID_TIME_LENGTH; index += 1) {
    timePart = `${CROCKFORD_BASE32[remainingTime % 32] ?? ''}${timePart}`;
    remainingTime = Math.floor(remainingTime / 32);
  }
  let randomValue = random.reduce(
    (value, byte) => (value << 8n) | BigInt(byte),
    0n,
  );
  let randomPart = '';
  for (let index = 0; index < ID_RANDOM_LENGTH; index += 1) {
    randomPart = `${CROCKFORD_BASE32[Number(randomValue & 31n)] ?? ''}${randomPart}`;
    randomValue >>= 5n;
  }
  return `${timePart}${randomPart}`;
}

export function endedQualifierLookupSql(input: EndedQualifierInput): string {
  const handles = [input.winnerHandle, input.loserHandle].map(sqlStringLiteral);
  return `SELECT p.handle AS handle, p.id AS product_id, p.user_id AS owner_user_id, l.id AS launch_id, (SELECT id FROM users WHERE handle = ${sqlStringLiteral(input.supporterHandle)} AND deleted_at IS NULL AND status = 'active') AS supporter_user_id FROM products p JOIN product_launches l ON l.product_id = p.id WHERE p.handle IN (${handles.join(', ')}) AND p.deleted_at IS NULL AND l.outcome IS NULL AND l.cancelled_at IS NULL AND l.launch_date = ${sqlStringLiteral(input.businessDate)};`;
}

interface LookupRow extends QualifierSide {
  readonly handle: string;
  readonly supporterUserId: string | null;
}

const lookupRowOf = (row: LocalD1Row): LookupRow => {
  const {
    handle,
    product_id: productId,
    launch_id: launchId,
    owner_user_id: ownerUserId,
    supporter_user_id: supporterUserId,
  } = row;
  if (
    typeof handle !== 'string' ||
    typeof productId !== 'string' ||
    typeof launchId !== 'string' ||
    typeof ownerUserId !== 'string' ||
    (typeof supporterUserId !== 'string' && supporterUserId !== null)
  ) {
    throw new Error(
      `ローンチの照会の結果の形式が正しくありません: ${JSON.stringify(row)}`,
    );
  }
  return { handle, productId, launchId, ownerUserId, supporterUserId };
};

// ハンドルは大文字小文字を区別しない列のため、照会の結果の表記が指定と違っても同じプロダクトとして選ぶ
export function parseEndedQualifierLookup(
  rows: readonly LocalD1Row[],
  input: EndedQualifierInput,
): ResolvedQualifier {
  const lookups = rows.map(lookupRowOf);
  const sideOf = (handle: string): LookupRow => {
    const matched = lookups.filter(
      (row) => row.handle.toLowerCase() === handle.toLowerCase(),
    );
    const [side] = matched;
    if (side === undefined || matched.length > 1) {
      throw new Error(
        `プロダクト(${handle})の${input.businessDate}の未確定のローンチがありません。ローンチ日を書き換えた後の未確定のローンチが1件ずつある必要があります`,
      );
    }
    return side;
  };
  const winner = sideOf(input.winnerHandle);
  const loser = sideOf(input.loserHandle);
  const { supporterUserId } = winner;
  if (supporterUserId === null) {
    throw new Error(`サポーター(${input.supporterHandle})が見つかりません`);
  }
  if (
    supporterUserId === winner.ownerUserId ||
    supporterUserId === loser.ownerUserId
  ) {
    throw new Error(
      `サポーター(${input.supporterHandle})は対戦するプロダクトの投稿者のためUpvoteできません`,
    );
  }
  const sideFields = ({ productId, launchId, ownerUserId }: LookupRow) => ({
    productId,
    launchId,
    ownerUserId,
  });
  return {
    winner: sideFields(winner),
    loser: sideFields(loser),
    supporterUserId,
  };
}

// 開始を記録済みで終了の日時を過ぎた未確定の予選を作り、勝つ側にだけサポーターのUpvoteを入れて側の集計値をUpvoteの記録とそろえる。確定と後続の処理は23:40のジョブに任せる
export function endedQualifierInsertSql(
  resolved: ResolvedQualifier,
  { businessDate, now, ids }: EndedQualifierWrite,
): string {
  const date = sqlStringLiteral(parseBusinessDate(businessDate));
  const nowMs = now.getTime();
  const startsAt = new Date(
    Math.min(
      qualifierWindow(parseBusinessDate(businessDate)).startsAt.getTime(),
      nowMs - STARTED_AGO_MS,
    ),
  );
  const upvotedAt = new Date(nowMs - UPVOTED_AGO_MS);
  const endsAt = new Date(nowMs - ENDED_AGO_MS);
  const created = timeLiteral(now);
  const matchId = sqlStringLiteral(ids.matchId);
  const entryValues = (
    entryId: string,
    slot: number,
    side: QualifierSide,
    tally: readonly [count: string, lastUpvotedAt: string, lastSeq: string],
  ): string =>
    valuesOf([
      sqlStringLiteral(entryId),
      matchId,
      integerLiteral(slot),
      QUALIFIER,
      date,
      sqlStringLiteral(side.launchId),
      sqlStringLiteral(side.productId),
      sqlStringLiteral(side.ownerUserId),
      ...tally,
      created,
      created,
    ]);
  return [
    `INSERT INTO matches (id, kind, match_date, starts_at, ends_at, started_at, created_at, updated_at) VALUES ${valuesOf([matchId, QUALIFIER, date, timeLiteral(startsAt), timeLiteral(endsAt), timeLiteral(startsAt), created, created])};`,
    `INSERT INTO match_entries (id, match_id, slot, match_kind, match_date, launch_id, product_id, owner_user_id, upvote_count, last_upvoted_at, last_upvote_seq, created_at, updated_at) VALUES ${entryValues(ids.winnerEntryId, 1, resolved.winner, ['1', timeLiteral(upvotedAt), '1'])}, ${entryValues(ids.loserEntryId, 2, resolved.loser, ['0', 'NULL', 'NULL'])};`,
    `INSERT INTO match_upvotes (id, match_id, entry_id, user_id, match_date, upvoted_at, seq, created_at, updated_at) VALUES ${valuesOf([sqlStringLiteral(ids.upvoteId), matchId, sqlStringLiteral(ids.winnerEntryId), sqlStringLiteral(resolved.supporterUserId), date, timeLiteral(upvotedAt), '1', created, created])} RETURNING id;`,
  ].join('\n');
}

const listedNumberOf = (index: number): string =>
  String(index + 1).padStart(LISTED_NUMBER_WIDTH, '0');

export function planListedProducts({
  count,
  matchDate,
  now,
  suffix,
  nextId,
}: ListedProductsInput): ListedProductsPlan {
  if (!Number.isInteger(count) || count < 1 || count > MAX_LISTED_PRODUCTS) {
    throw new RangeError(
      `プロダクトの件数は1〜${String(MAX_LISTED_PRODUCTS)}の整数で指定してください: ${String(count)}`,
    );
  }
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new RangeError(
      `識別子の接尾辞は英小文字と数字の4〜12文字で指定してください: ${suffix}`,
    );
  }
  const handle = `e2e-dir-${suffix}`;
  const owner: ListedProductsOwner = {
    id: nextId(),
    pseudonymousId: nextId(),
    handle,
    nickname: `E2Eディレクトリの投稿者${suffix}`,
    email: `${handle}@${TEST_EMAIL_DOMAIN}`,
  };
  const products = Array.from({ length: count }, (_, index) => {
    const number = listedNumberOf(index);
    return {
      productId: nextId(),
      launchId: nextId(),
      matchId: nextId(),
      entryId: nextId(),
      decidedEventId: nextId(),
      logoFileId: nextId(),
      handle: `${handle}-${number}`,
      name: `E2Eディレクトリ${suffix}-${number}`,
      tagline: `E2Eディレクトリのタグライン${suffix}-${number}`,
      websiteUrl: `https://dir-${suffix}.example/${number}`,
    };
  });
  return {
    owner,
    products,
    matchDate: parseBusinessDate(matchDate),
    now,
  };
}

// 掲載の条件(可視の投稿者・可視のプロダクト・勝ちのローンチ・予選の勝ちの記録)だけを満たす最小の行を作る。予選はキックオフのジョブと同じく開始時点で確定した不戦勝にし、対戦相手の行を持たない。確定のイベントを処理済みの形で持たせ、日次のジョブの先頭の掃き出しがイベントを作り直さないため、掲載の記録と索引文書は作られず検索には現れない
export function listedProductsInsertSql({
  owner,
  products,
  matchDate,
  now,
}: ListedProductsPlan): string {
  const created = timeLiteral(now);
  const date = sqlStringLiteral(matchDate);
  const kickoff = timeLiteral(
    qualifierWindow(parseBusinessDate(matchDate)).startsAt,
  );
  const fullTime = timeLiteral(
    qualifierWindow(parseBusinessDate(matchDate)).endsAt,
  );
  const rows = (valuesOfProduct: (product: PlannedListedProduct) => string[]) =>
    products.map((product) => valuesOf(valuesOfProduct(product))).join(', ');
  return [
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES ${valuesOf([sqlStringLiteral(owner.id), sqlStringLiteral(owner.pseudonymousId), sqlStringLiteral(owner.email), UNUSABLE_PASSWORD_HASH, sqlStringLiteral(owner.nickname), sqlStringLiteral(owner.handle), created, created, created, created])};`,
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at) VALUES ${rows(
      (product) => [
        sqlStringLiteral(product.productId),
        sqlStringLiteral(owner.id),
        sqlStringLiteral(PRODUCT_CATEGORY_OTHER_ID),
        sqlStringLiteral(product.handle),
        sqlStringLiteral(product.name),
        sqlStringLiteral(product.tagline),
        sqlStringLiteral(product.websiteUrl),
        sqlStringLiteral(`${product.name}の説明文です。`),
        sqlStringLiteral(product.logoFileId),
        date,
        created,
        created,
      ],
    )};`,
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, created_at, updated_at) VALUES ${rows(
      (product) => [
        sqlStringLiteral(product.launchId),
        sqlStringLiteral(product.productId),
        date,
        sqlStringLiteral('won'),
        kickoff,
        created,
        created,
      ],
    )};`,
    `INSERT INTO matches (id, kind, match_date, starts_at, ends_at, started_at, decided_at, decision, created_at, updated_at) VALUES ${rows(
      (product) => [
        sqlStringLiteral(product.matchId),
        QUALIFIER,
        date,
        kickoff,
        fullTime,
        kickoff,
        kickoff,
        sqlStringLiteral('bye'),
        created,
        created,
      ],
    )};`,
    `INSERT INTO match_events (id, match_id, match_kind, type, occurred_at, status, dispatch_count, last_dispatched_at, completed_at, created_at, updated_at) VALUES ${rows(
      (product) => [
        sqlStringLiteral(product.decidedEventId),
        sqlStringLiteral(product.matchId),
        QUALIFIER,
        sqlStringLiteral('decided'),
        kickoff,
        sqlStringLiteral('completed'),
        '1',
        kickoff,
        kickoff,
        created,
        created,
      ],
    )};`,
    `INSERT INTO match_entries (id, match_id, slot, match_kind, match_date, launch_id, product_id, owner_user_id, result, created_at, updated_at) VALUES ${rows(
      (product) => [
        sqlStringLiteral(product.entryId),
        sqlStringLiteral(product.matchId),
        '1',
        QUALIFIER,
        date,
        sqlStringLiteral(product.launchId),
        sqlStringLiteral(product.productId),
        sqlStringLiteral(owner.id),
        sqlStringLiteral('bye'),
        created,
        created,
      ],
    )} RETURNING id;`,
  ].join('\n');
}
