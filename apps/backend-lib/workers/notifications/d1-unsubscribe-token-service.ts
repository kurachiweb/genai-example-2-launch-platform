import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type { Database } from '../../../db/client.ts';
import { notificationUnsubscribeTokens } from '../../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import type { KeyedHasher } from '../../core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { unsubscribeTokenKey } from '../../core/notifications/notice-email.ts';
import type {
  UnsubscribeTarget,
  UnsubscribeTokenService,
} from '../../core/notifications/ports.ts';
import {
  isWellFormedUnsubscribeToken,
  UNSUBSCRIBE_LOOKUP_PURPOSE,
  UNSUBSCRIBE_SEED_BYTES,
  UNSUBSCRIBE_TOKEN_PURPOSE,
  unsubscribeTokenSource,
} from '../../core/notifications/unsubscribe-token.ts';

const tokens = notificationUnsubscribeTokens;

// D1のバインド変数の上限(100)から、利用者のIDの一覧と通知種別(4種)の分を見込む
const TARGETS_PER_READ = 90;

// 種の1行は7個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const SEED_ROWS_PER_INSERT = 14;

const BASE64URL_OPTIONS = { alphabet: 'base64url', omitPadding: true } as const;

interface SeedRow {
  readonly id: string;
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly seed: string;
  readonly tokenHash: string;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniqueTargetsOf(
  targets: readonly UnsubscribeTarget[],
): UnsubscribeTarget[] {
  const byKey = new Map(
    targets.map((target) => [
      unsubscribeTokenKey(target),
      { userId: target.userId, topic: target.topic },
    ]),
  );
  return [...byKey.values()];
}

function generateSeed(): string {
  return crypto
    .getRandomValues(new Uint8Array(UNSUBSCRIBE_SEED_BYTES))
    .toBase64(BASE64URL_OPTIONS);
}

@injectable()
export class D1UnsubscribeTokenService implements UnsubscribeTokenService {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.KeyedHasher) private readonly hasher: KeyedHasher,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async tokensFor(
    targets: readonly UnsubscribeTarget[],
    at: Date,
  ): Promise<ReadonlyMap<string, string>> {
    const unique = uniqueTargetsOf(targets);
    const existing = await this.readSeeds(unique);
    const missing = unique.filter(
      (target) => !existing.has(unsubscribeTokenKey(target)),
    );
    const created = await this.createSeeds(missing, at);
    const rows = [...existing.values(), ...created.values()];
    const entries = await Promise.all(
      rows.map(async (row) => {
        const token = await this.refreshedTokenOf(row, at);
        return [unsubscribeTokenKey(row), token] as const;
      }),
    );
    return new Map(entries);
  }

  async resolve(token: string): Promise<UnsubscribeTarget | undefined> {
    if (!isWellFormedUnsubscribeToken(token)) {
      return undefined;
    }
    const lookupHash = await this.hasher.hash(
      UNSUBSCRIBE_LOOKUP_PURPOSE,
      token,
    );
    const [row] = await this.db
      .select({
        userId: tokens.userId,
        topic: tokens.topic,
        tokenHash: tokens.tokenHash,
      })
      .from(tokens)
      .where(eq(tokens.tokenHash, lookupHash))
      .limit(1);
    if (
      row === undefined ||
      !(await this.hasher.verify(
        UNSUBSCRIBE_LOOKUP_PURPOSE,
        token,
        row.tokenHash,
      ))
    ) {
      return undefined;
    }
    return { userId: row.userId, topic: row.topic };
  }

  async deleteAllOf(userId: string): Promise<void> {
    await this.db.delete(tokens).where(eq(tokens.userId, userId));
  }

  private async readSeeds(
    targets: readonly UnsubscribeTarget[],
  ): Promise<ReadonlyMap<string, SeedRow>> {
    const pages = await Promise.all(
      chunk(targets, TARGETS_PER_READ).map((page) =>
        this.db
          .select({
            id: tokens.id,
            userId: tokens.userId,
            topic: tokens.topic,
            seed: tokens.seed,
            tokenHash: tokens.tokenHash,
          })
          .from(tokens)
          .where(
            and(
              inArray(tokens.userId, [
                ...new Set(page.map((target) => target.userId)),
              ]),
              inArray(tokens.topic, [
                ...new Set(page.map((target) => target.topic)),
              ]),
            ),
          ),
      ),
    );
    const requested = new Set(targets.map(unsubscribeTokenKey));
    return new Map(
      pages
        .flat()
        .map((row) => [unsubscribeTokenKey(row), row] as const)
        .filter(([key]) => requested.has(key)),
    );
  }

  // 同時の作成では先に挿入した種だけが残るため、挿入の後に読み直した種からトークンを導出する
  private async createSeeds(
    targets: readonly UnsubscribeTarget[],
    at: Date,
  ): Promise<ReadonlyMap<string, SeedRow>> {
    if (targets.length === 0) {
      return new Map();
    }
    const rows = await Promise.all(
      targets.map(async (target) => {
        const seed = generateSeed();
        const token = await this.derive({ ...target, seed });
        return {
          id: this.ids.generate(),
          userId: target.userId,
          topic: target.topic,
          seed,
          tokenHash: await this.hasher.hash(UNSUBSCRIBE_LOOKUP_PURPOSE, token),
          createdAt: at,
          updatedAt: at,
        };
      }),
    );
    for (const page of chunk(rows, SEED_ROWS_PER_INSERT)) {
      await this.db.insert(tokens).values(page).onConflictDoNothing();
    }
    const stored = await this.readSeeds(targets);
    if (stored.size !== targets.length) {
      throw new Error('配信停止のトークンの種を保存できませんでした');
    }
    return stored;
  }

  // ペッパーを変えると導出するトークンが変わるため、照合用のハッシュを今のトークンのものへ更新する
  private async refreshedTokenOf(row: SeedRow, at: Date): Promise<string> {
    const token = await this.derive(row);
    const lookupHash = await this.hasher.hash(
      UNSUBSCRIBE_LOOKUP_PURPOSE,
      token,
    );
    if (lookupHash !== row.tokenHash) {
      await this.db
        .update(tokens)
        .set({ tokenHash: lookupHash, updatedAt: at })
        .where(and(eq(tokens.id, row.id), eq(tokens.tokenHash, row.tokenHash)));
    }
    return token;
  }

  private derive(input: {
    readonly userId: string;
    readonly topic: NotificationTopic;
    readonly seed: string;
  }): Promise<string> {
    return this.hasher.hash(
      UNSUBSCRIBE_TOKEN_PURPOSE,
      unsubscribeTokenSource(input),
    );
  }
}
