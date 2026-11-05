import { inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  InquirerProfile,
  InquirerProfiles,
} from '../../application/inquiry/ports.ts';

const IDS_PER_STATEMENT = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 利用者のプロフィール画像は後続の機能が持つため、画像はnullで返し、画像付きの実装は束縛の差し替えで与える
// 退会済みの問い合わせの詳細にも送った利用者を表示するため、論理削除した利用者も返す
@injectable()
export class D1InquirerProfiles implements InquirerProfiles {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findMany(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, InquirerProfile>> {
    const results = await Promise.all(
      chunk([...new Set(userIds)], IDS_PER_STATEMENT).map((part) =>
        this.db
          .select({
            userId: users.id,
            nickname: users.nickname,
            handle: users.handle,
          })
          .from(users)
          .where(inArray(users.id, part)),
      ),
    );
    return new Map(
      results
        .flat()
        .map(
          ({ userId, nickname, handle }) =>
            [userId, { userId, nickname, handle, avatarFileId: null }] as const,
        ),
    );
  }
}
