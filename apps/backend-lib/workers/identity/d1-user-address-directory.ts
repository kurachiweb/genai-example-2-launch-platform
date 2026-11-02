import { and, inArray, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { toMatchingKey } from '../../core/email/email-address.ts';
import type {
  UserAddressDirectory,
  UserAddressLookup,
} from '../../core/email/ports.ts';

// D1のバインド変数の上限(100)から、照合キー以外に使う変数の分を残す
const KEYS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1UserAddressDirectory implements UserAddressDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 呼び出し元は「使えない」を受けて削除を見送るため、D1の失敗は例外にせず戻り値で伝える
  async findRegistered(
    addresses: readonly string[],
  ): Promise<UserAddressLookup> {
    const keys = [...new Set(addresses.map(toMatchingKey))];
    try {
      const pages = await Promise.all(
        chunk(keys, KEYS_PER_STATEMENT).map((page) =>
          this.db
            .select({ email: users.email })
            .from(users)
            .where(and(isNull(users.deletedAt), inArray(users.email, page))),
        ),
      );
      return {
        kind: 'available',
        registered: new Set(
          pages.flat().map((row) => toMatchingKey(row.email)),
        ),
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
