import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import type {
  AdminRole,
  AdminViewerQuery,
} from '../src/graphql/generated/graphql.ts';

export const ADMIN_NICKNAME = '運営の担当';

type SignedInAdmin = NonNullable<AdminViewerQuery['adminViewer']>;

export const GUEST_ADMIN_QUERY: AdminViewerQuery = Object.freeze({
  adminViewer: null,
});

export const signedInAdminQuery = (
  overrides: Partial<SignedInAdmin> = {},
): AdminViewerQuery => ({
  adminViewer: {
    id: '01JC0ADMIN000000000000000000',
    nickname: ADMIN_NICKNAME,
    title: 'サポート担当',
    email: 'operator@admin.example',
    role: 'VIEWER',
    avatar: null,
    remainingRecoveryCodes: 10,
    ...overrides,
  },
});

export const adminWithRole = (role: AdminRole): AdminViewerQuery =>
  signedInAdminQuery({ role });

export const adminViewerResult = (
  data: AdminViewerQuery,
): GraphQLResult<AdminViewerQuery> => ({ ok: true, data });
