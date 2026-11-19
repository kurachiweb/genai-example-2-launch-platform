import type { ApiKeyScopes } from '../../../../common-lib/public-api/api-key-rules.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type {
  ApiKeyRecord,
  ApiKeySecretGenerator,
  ApiKeyStore,
  NewApiKey,
  PublicApiRateLimits,
} from '../ports.ts';

export const USER_ID = '01JC0APKEYVSER000000000001';

export const OTHER_USER_ID = '01JC0APKEYVSER000000000002';

// 偽のストアが保存の時点で停止中・退会済みとして扱う利用者
export const UNAVAILABLE_USER_ID = '01JC0APKEYVSER000000000003';

export const ISSUE_LIMIT = 3;

export const RETRY_AFTER_SECONDS = 1800;

export const READ_WRITE_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'read',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'read',
  productDescriptions: 'read_write',
});

export const currentUserOf = (userId: string = USER_ID): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JC0APKEYSESS0N0000000001',
  },
  user: {
    id: userId,
    pseudonymousId: '01JC0APKEYPSEVD00000000001',
    status: 'active',
    emailVerifiedAt: null,
    deletedAt: null,
    email: 'alice@mail.example',
    nickname: 'アリス',
    handle: 'alice',
  },
});

export interface StoredKey extends ApiKeyRecord {
  readonly keyHash: string;
}

export const storedKeyOf = (overrides: Partial<StoredKey> = {}): StoredKey => ({
  id: '01JC0APKEY0000000000000001',
  userId: USER_ID,
  name: '既存のキー',
  scopes: READ_WRITE_SCOPES,
  createdAt: new Date('2026-11-10T00:00:00.000Z'),
  keyHash: 'hash-of-existing',
  ...overrides,
});

export interface FakeApiKeyStore extends ApiKeyStore {
  readonly rows: StoredKey[];
  readonly inserted: NewApiKey[];
}

const isBefore = (
  row: StoredKey,
  before: { readonly createdAt: Date; readonly id: string } | undefined,
): boolean =>
  before === undefined ||
  row.createdAt.getTime() < before.createdAt.getTime() ||
  (row.createdAt.getTime() === before.createdAt.getTime() &&
    row.id < before.id);

const byNewest = (left: StoredKey, right: StoredKey): number =>
  right.createdAt.getTime() - left.createdAt.getTime() ||
  right.id.localeCompare(left.id);

const toRecord = (row: StoredKey): ApiKeyRecord => ({
  id: row.id,
  userId: row.userId,
  name: row.name,
  scopes: row.scopes,
  createdAt: row.createdAt,
});

export function createFakeApiKeyStore(
  initial: readonly StoredKey[] = [],
): FakeApiKeyStore {
  const rows: StoredKey[] = [...initial];
  const inserted: NewApiKey[] = [];
  const indexOf = (userId: string, keyId: string): number =>
    rows.findIndex((row) => row.id === keyId && row.userId === userId);
  return {
    rows,
    inserted,
    findByHash: () => {
      throw new Error('テストでは使わない');
    },
    findForOwner: (userId, keyId) => {
      const row = rows[indexOf(userId, keyId)];
      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },
    listByUser: (userId, { limit, before }) =>
      Promise.resolve(
        rows
          .filter((row) => row.userId === userId && isBefore(row, before))
          .toSorted(byNewest)
          .slice(0, limit)
          .map(toRecord),
      ),
    insert: (key) => {
      inserted.push(key);
      if (key.userId === UNAVAILABLE_USER_ID) {
        return Promise.resolve('account-unavailable');
      }
      rows.push({
        id: key.id,
        userId: key.userId,
        name: key.name,
        scopes: key.scopes,
        createdAt: key.at,
        keyHash: key.keyHash,
      });
      return Promise.resolve('saved');
    },
    update: (input) => {
      const index = indexOf(input.userId, input.keyId);
      const row = rows[index];
      if (row === undefined) {
        return Promise.resolve('not-found');
      }
      rows[index] = { ...row, name: input.name, scopes: input.scopes };
      return Promise.resolve('updated');
    },
    delete: (userId, keyId) => {
      const index = indexOf(userId, keyId);
      if (index === -1) {
        return Promise.resolve(false);
      }
      rows.splice(index, 1);
      return Promise.resolve(true);
    },
  };
}

export const generatedSequenceOf = (count: number): string =>
  String(count).padStart(43, '0');

export interface FakeSecretGenerator extends ApiKeySecretGenerator {
  readonly generated: string[];
}

export function createFakeSecretGenerator(): FakeSecretGenerator {
  const generated: string[] = [];
  return {
    generated,
    generate: () => {
      const sequence = generatedSequenceOf(generated.length + 1);
      const plain = generatedPlainOf(generated.length + 1);
      generated.push(plain);
      return Promise.resolve({ plain, hash: `hash-of-${sequence}` });
    },
  };
}

export interface IssueCall {
  readonly userId: string;
  readonly now: Date;
}

export interface FakeRateLimits extends PublicApiRateLimits {
  readonly issueCalls: IssueCall[];
}

// 利用者ごとに発行の規則の上限を超えた呼び出しを429にする
export function createFakeRateLimits(): FakeRateLimits {
  const issueCalls: IssueCall[] = [];
  return {
    issueCalls,
    consumeIssue: (userId, now) => {
      issueCalls.push({ userId, now });
      const used = issueCalls.filter((call) => call.userId === userId).length;
      if (used > ISSUE_LIMIT) {
        return Promise.reject(
          new AppError({
            kind: 'rate_limited',
            code: 'rate_limit_exceeded',
            message:
              '操作が集中しています。しばらく待ってから再度お試しください。',
            retryAfterSeconds: RETRY_AFTER_SECONDS,
          }),
        );
      }
      return Promise.resolve();
    },
    consumeRequest: () => {
      throw new Error('テストでは使わない');
    },
  };
}

export const newKeyIdOf = (count: number): string =>
  `01JC0APKEYNEW${String(count).padStart(13, '0')}`;

export function createSequentialIds(): IdGenerator {
  let count = 0;
  return {
    generate: () => {
      count += 1;
      return newKeyIdOf(count);
    },
  };
}

export const generatedPlainOf = (count: number): string =>
  `lsk_${generatedSequenceOf(count)}`;
