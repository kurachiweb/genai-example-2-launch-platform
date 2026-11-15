import {
  type AdminAccountManagement,
  toAdminAccountView,
} from '../../../../application/admin/admin-account-management.ts';
import type { AdminInvitation } from '../../../../application/admin/admin-invitation.ts';
import type { AdminProfile } from '../../../../application/admin/admin-profile.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import type { AdminRequestMeta } from '../../../../application/admin/ports.ts';
import { requireAdmin, requireSelfOrRole } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  CHANGE_ADMIN_ROLE_ARGS,
  DELETE_ADMIN_ARGS,
  INVITE_ADMIN_ARGS,
  RESEND_ADMIN_INVITATION_ARGS,
  UPDATE_ADMIN_PROFILE_ARGS,
} from './inputs.ts';
import {
  type AdminAccountSource,
  adminAccountStoreOf,
  adminOnly,
  adminRequestMetaOf,
  avatarOf,
  toAdminAccountSource,
} from './resolver-support.ts';

const accountManagement = (context: GraphQLContext): AdminAccountManagement =>
  context.resolve<AdminAccountManagement>(ADMIN_TYPES.AdminAccountManagement);

const invitation = (context: GraphQLContext): AdminInvitation =>
  context.resolve<AdminInvitation>(ADMIN_TYPES.AdminInvitation);

const withReason = (reason: string | undefined) =>
  reason === undefined ? {} : { reason };

// 招待と再送のユースケースは結果を返さないため、書き込んだ招待中の管理者の行を読んで応答の形にする
async function readInvitedAccount(
  context: GraphQLContext,
  find: { readonly id: string } | { readonly email: string },
  meta: AdminRequestMeta,
): Promise<AdminAccountSource> {
  const store = adminAccountStoreOf(context);
  const admin =
    'id' in find
      ? await store.findById(find.id)
      : await store.findByEmail(find.email);
  if (admin === undefined) {
    throw new Error('招待した管理者を読み込めませんでした');
  }
  return toAdminAccountSource(toAdminAccountView(admin, meta.now));
}

// 削除・再送の可否は対象のロールと状態で決まるため、ロール不足の拒否だけを先に行い、対象による判定はユースケースに任せる
export const accountResolvers = {
  Query: {
    adminAccounts: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const current = await requireAdmin(context, 'viewer');
        const accounts = await accountManagement(context).list(
          current,
          adminRequestMetaOf(context),
        );
        return accounts.map(toAdminAccountSource);
      },
    ),
  },
  AdminAccount: {
    avatar: (
      parent: AdminAccountSource,
      _args: unknown,
      context: GraphQLContext,
    ) => avatarOf(parent, context),
  },
  Mutation: {
    inviteAdmin: adminOnly(
      withValidatedArgs(
        INVITE_ADMIN_ARGS,
        async (_parent: unknown, { email, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          const meta = adminRequestMetaOf(context);
          await invitation(context).invite(
            current,
            { email, ...withReason(reason) },
            meta,
          );
          return readInvitedAccount(context, { email }, meta);
        },
      ),
    ),
    resendAdminInvitation: adminOnly(
      withValidatedArgs(
        RESEND_ADMIN_INVITATION_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          const meta = adminRequestMetaOf(context);
          await invitation(context).resend(
            current,
            { adminId: id, ...withReason(reason) },
            meta,
          );
          return readInvitedAccount(context, { id }, meta);
        },
      ),
    ),
    deleteAdmin: adminOnly(
      withValidatedArgs(
        DELETE_ADMIN_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          await accountManagement(context).delete(
            current,
            { adminId: id, ...withReason(reason) },
            adminRequestMetaOf(context),
          );
          return true;
        },
      ),
    ),
    changeAdminRole: adminOnly(
      withValidatedArgs(
        CHANGE_ADMIN_ROLE_ARGS,
        async (_parent: unknown, { id, role, reason }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          const changed = await accountManagement(context).changeRole(
            current,
            { adminId: id, role, ...withReason(reason) },
            adminRequestMetaOf(context),
          );
          return toAdminAccountSource(changed);
        },
      ),
    ),
    updateAdminProfile: adminOnly(
      withValidatedArgs(
        UPDATE_ADMIN_PROFILE_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireSelfOrRole(
            context,
            input.id,
            'super_admin',
          );
          const updated = await context
            .resolve<AdminProfile>(ADMIN_TYPES.AdminProfile)
            .update(
              current,
              {
                adminId: input.id,
                nickname: input.nickname,
                title: input.title,
                avatarFileId: input.avatarFileId,
              },
              adminRequestMetaOf(context),
            );
          return toAdminAccountSource(updated);
        },
      ),
    ),
  },
} satisfies Resolvers;
