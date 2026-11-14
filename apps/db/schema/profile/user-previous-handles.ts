import { snakeCase } from 'drizzle-orm/sqlite-core';

import { previousHandleColumns } from '../handles/previous-handle-columns.ts';
import { users } from '../identity/users.ts';

export const userPreviousHandles = snakeCase.table(
  'user_previous_handles',
  previousHandleColumns({
    ownerColumnName: 'user_id',
    references: () => users.id,
  }),
);
