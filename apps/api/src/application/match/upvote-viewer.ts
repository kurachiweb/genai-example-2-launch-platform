import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { UpvoteViewer } from '../../domain/match/upvote-plan.ts';

export function upvoteViewerOf(
  user: CurrentUser | undefined,
): UpvoteViewer | null {
  if (user === undefined) {
    return null;
  }
  const account = user.user;
  return {
    userId: account.id,
    emailVerified: account.emailVerifiedAt !== null,
    writable: account.status === 'active' && account.deletedAt === null,
  };
}
