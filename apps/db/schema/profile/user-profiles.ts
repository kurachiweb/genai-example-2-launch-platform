import { snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

export const userProfiles = snakeCase.table('user_profiles', {
  id: ulidPrimaryKey(),
  userId: text()
    .notNull()
    .unique()
    .references(() => users.id),
  headline: text(),
  bioMarkdown: text(),
  // media_filesの行は保有者と別の時期に物理削除されるため、削除の順に縛られないよう外部キーにしない
  avatarFileId: text(),
  ...timestamps(),
});
