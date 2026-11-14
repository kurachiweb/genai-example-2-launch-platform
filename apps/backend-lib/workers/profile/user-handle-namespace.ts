import { isNull } from 'drizzle-orm';

import { users } from '../../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import {
  defineHandleNamespace,
  type HandleNamespace,
} from '../handles/handle-namespace.ts';

export const USER_HANDLE_NAMESPACE: HandleNamespace = defineHandleNamespace({
  name: 'user',
  rule: USER_HANDLE_RULE,
  current: {
    table: users,
    ownerId: users.id,
    handle: users.handle,
    activeCondition: isNull(users.deletedAt),
  },
  previous: {
    table: userPreviousHandles,
    ownerId: userPreviousHandles.ownerId,
    handle: userPreviousHandles.handle,
    deletedAt: userPreviousHandles.deletedAt,
  },
});
