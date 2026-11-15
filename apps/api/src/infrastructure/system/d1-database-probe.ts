import { sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { DatabaseProbe } from '../../application/system/system-status-query.ts';

const logger = getAppLogger(['api', 'infrastructure', 'system']);

@injectable()
export class D1DatabaseProbe implements DatabaseProbe {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly database: Database,
  ) {}

  async isReachable(): Promise<boolean> {
    try {
      await this.database.run(sql`select 1`);
      return true;
    } catch (error) {
      logger.warn('データベースに到達できません', { error });
      return false;
    }
  }
}
