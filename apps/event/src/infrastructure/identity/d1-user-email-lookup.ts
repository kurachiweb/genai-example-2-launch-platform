import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { UserEmailLookup } from '../../application/identity/ports.ts';

@injectable()
export class D1UserEmailLookup implements UserEmailLookup {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findEmail(userId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return row?.email;
  }
}
