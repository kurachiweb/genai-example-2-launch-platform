import { eq, isNotNull, sql, type SQL } from 'drizzle-orm';

import { notDeleted } from '../_shared/columns.ts';
import { users } from './users.ts';

export { DISPOSABLE_EMAIL_STATUSES, USER_STATUSES } from './users.ts';

export function visibleUsers(): SQL {
  return sql`(${notDeleted(users.deletedAt)} and ${eq(users.status, 'active')})`;
}

export function verifiedUsers(): SQL {
  return sql`(${visibleUsers()} and ${isNotNull(users.emailVerifiedAt)})`;
}
