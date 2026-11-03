import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../core/admin/ports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';

// D1のバインド変数の上限。状態の条件は値を埋め込み、識別子だけで上限を使う
const IDS_PER_STATEMENT = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1AdminDirectory implements AdminDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findProfiles(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AdminProfileView>> {
    const results = await Promise.all(
      chunk([...new Set(ids)], IDS_PER_STATEMENT).map((part) =>
        this.db
          .select({
            id: admins.id,
            nickname: admins.nickname,
            title: admins.title,
            avatarFileId: admins.avatarFileId,
          })
          .from(admins)
          .where(
            and(
              inArray(admins.id, part),
              eq(admins.status, 'active').inlineParams(),
            ),
          ),
      ),
    );
    return new Map(
      results
        .flat()
        .flatMap(({ id, nickname, title, avatarFileId }) =>
          nickname === null
            ? []
            : [[id, { id, nickname, title, avatarFileId }] as const],
        ),
    );
  }
}
