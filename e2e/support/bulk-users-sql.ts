import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';

export interface BulkUserSeed {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly email: string;
  readonly nickname: string;
  readonly handle: string;
}

export interface BulkUserSeedInput {
  readonly suffix: string;
  readonly index: number;
  readonly id: string;
  readonly pseudonymousId: string;
}

export interface RegisteredUserRow {
  readonly userId: string;
  readonly passwordHash: string;
  readonly disposableEmailStatus: string | null;
  readonly disposableEmailCheckedAt: number | null;
}

export type BulkUserTemplate = Omit<RegisteredUserRow, 'userId'>;

// RFC 5737が文書用に予約した3つの範囲(192.0.2.0/24・198.51.100.0/24・203.0.113.0/24)。ネットワーク・ブロードキャストのアドレスを除く1〜254を使う
const DOCUMENTATION_RANGES = Object.freeze([
  '192.0.2',
  '198.51.100',
  '203.0.113',
] as const);

const HOSTS_PER_RANGE = 254;

export const BULK_CLIENT_IP_POOL_SIZE =
  DOCUMENTATION_RANGES.length * HOSTS_PER_RANGE;

// 1回のD1の実行へ渡すINSERT文の行数。実行はSQL全体を1つのコマンドライン引数で受けるため、全員を1つのSQLにすると人数が多いときに引数の長さの上限を超える
export const BULK_USERS_CHUNK_SIZE = 50;

const SUFFIX_PATTERN = /^[0-9a-z]{8}$/u;

const INDEX_DIGITS = 3;

const MAX_INDEX = 10 ** INDEX_DIGITS - 1;

// apps/apiのinfrastructure/auth/pbkdf2-password-hasher.tsの保存の形式`pbkdf2-sha512$<反復回数>$<ソルト>$<導出の値>`(base64url)の形だけを確かめる。値の写しは持たない
const PASSWORD_HASH_PATTERN =
  /^pbkdf2-sha512\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u;

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

// IPアドレス単位の制限は実行をまたいで残るため、呼び出し側が実行ごとに選ぶ開始位置から並べ、同じ実行の中では上限まで重ならない
export function clientIpOf(index: number, offset: number): string {
  if (!isNonNegativeInteger(index) || !isNonNegativeInteger(offset)) {
    throw new RangeError(
      `番号と開始位置は0以上の整数で指定してください: ${String(index)}, ${String(offset)}`,
    );
  }
  const position = (offset + index) % BULK_CLIENT_IP_POOL_SIZE;
  const range = DOCUMENTATION_RANGES[Math.floor(position / HOSTS_PER_RANGE)];
  return `${range ?? ''}.${String((position % HOSTS_PER_RANGE) + 1)}`;
}

// ハンドルは登録で生成する初期ハンドルと同じ12文字の英小文字と数字にする
export function bulkUserSeed({
  suffix,
  index,
  id,
  pseudonymousId,
}: BulkUserSeedInput): BulkUserSeed {
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new RangeError(
      `接尾辞は8桁の英小文字と数字で指定してください: ${suffix}`,
    );
  }
  if (!isNonNegativeInteger(index) || index > MAX_INDEX) {
    throw new RangeError(
      `番号は0〜${String(MAX_INDEX)}の整数で指定してください: ${String(index)}`,
    );
  }
  const number = String(index).padStart(INDEX_DIGITS, '0');
  return {
    id,
    pseudonymousId,
    email: `e2e-bulk-${suffix}-${number}@${TEST_EMAIL_DOMAIN}`,
    nickname: `E2E一括${suffix.slice(0, 4)}-${number}`,
    handle: `b${suffix}${number}`,
  };
}

export function passwordHashLookupSql(email: string): string {
  return `SELECT id, password_hash, disposable_email_status, disposable_email_checked_at FROM users WHERE email = ${sqlStringLiteral(email)} AND deleted_at IS NULL;`;
}

const isNullOr = (value: unknown, type: 'string' | 'number'): boolean =>
  value === null || typeof value === type;

export function parsePasswordHashLookup(
  rows: readonly LocalD1Row[],
  email: string,
): RegisteredUserRow {
  const [row] = rows;
  if (
    rows.length !== 1 ||
    typeof row?.id !== 'string' ||
    typeof row.password_hash !== 'string' ||
    !PASSWORD_HASH_PATTERN.test(row.password_hash) ||
    !isNullOr(row.disposable_email_status, 'string') ||
    !isNullOr(row.disposable_email_checked_at, 'number')
  ) {
    throw new Error(
      `ローカルのD1に、パスワードのハッシュを持つ利用者${email}が見つかりません`,
    );
  }
  return {
    userId: row.id,
    passwordHash: row.password_hash,
    disposableEmailStatus: row.disposable_email_status as string | null,
    disposableEmailCheckedAt: row.disposable_email_checked_at as number | null,
  };
}

const integerLiteral = (value: number): string => String(Math.trunc(value));

const chunksOf = <T>(items: readonly T[], size: number): readonly T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, chunk) =>
    items.slice(chunk * size, (chunk + 1) * size),
  );

// 1人目の行(登録とメールアドレスの確認の後)のパスワードのハッシュと使い捨てメールアドレスの判定を写し、確認済み・規約の同意済み・有効の利用者にする。確認と同意の日時は作成と同時刻にする。戻り値は1回のD1の実行ごとのSQLで、1つのSQLは最大BULK_USERS_CHUNK_SIZE行を作る
export function bulkUsersInsertSqls(
  seeds: readonly BulkUserSeed[],
  template: BulkUserTemplate,
  now: Date,
): readonly string[] {
  if (seeds.length === 0) {
    throw new RangeError('投入する利用者が1人もありません');
  }
  if (!PASSWORD_HASH_PATTERN.test(template.passwordHash)) {
    throw new TypeError('パスワードのハッシュが保存の形式ではありません');
  }
  const at = integerLiteral(now.getTime());
  const hash = sqlStringLiteral(template.passwordHash);
  const status =
    template.disposableEmailStatus === null
      ? 'NULL'
      : sqlStringLiteral(template.disposableEmailStatus);
  const checkedAt =
    template.disposableEmailCheckedAt === null
      ? 'NULL'
      : integerLiteral(template.disposableEmailCheckedAt);
  return chunksOf(seeds, BULK_USERS_CHUNK_SIZE).map((chunk) => {
    const values = chunk
      .map(
        (seed) =>
          `(${[
            sqlStringLiteral(seed.id),
            sqlStringLiteral(seed.pseudonymousId),
            sqlStringLiteral(seed.email),
            hash,
            sqlStringLiteral(seed.nickname),
            sqlStringLiteral(seed.handle),
            at,
            at,
            status,
            checkedAt,
            at,
            at,
          ].join(', ')})`,
      )
      .join(', ');
    return `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, disposable_email_status, disposable_email_checked_at, created_at, updated_at) VALUES ${values} RETURNING id;`;
  });
}

export function parseBulkUsersInsert(
  rows: readonly LocalD1Row[],
  seeds: readonly BulkUserSeed[],
): void {
  const created = new Set(rows.map((row) => row.id));
  if (seeds.some(({ id }) => !created.has(id))) {
    throw new Error(
      `ローカルのD1に作れた利用者は${String(created.size)}人で、期待は${String(seeds.length)}人です`,
    );
  }
}
