import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { HandleAvailability } from '../../application/identity/ports.ts';

// ハンドルの列は大文字小文字を区別しない照合順序で、退会後に物理削除されていない行も一意制約の対象のため、全行と比べる
@injectable()
export class D1HandleAvailability implements HandleAvailability {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async isAvailable(handle: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, handle))
      .limit(1);
    return row === undefined;
  }
}
