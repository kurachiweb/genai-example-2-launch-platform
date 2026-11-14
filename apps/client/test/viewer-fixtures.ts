import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import type { ClientViewerQuery } from '../src/graphql/generated/graphql.ts';

export const VIEWER_NICKNAME = 'ピッチの作り手';

export const VIEWER_HANDLE = 'pitch_maker';

type SignedInViewer = NonNullable<ClientViewerQuery['viewer']>;

export const signedInViewerQuery = (
  overrides: Partial<SignedInViewer> = {},
): ClientViewerQuery => ({
  viewer: {
    id: '01JC0VIEWER0000000000000000',
    handle: VIEWER_HANDLE,
    nickname: VIEWER_NICKNAME,
    emailVerified: true,
    status: 'ACTIVE',
    totpEnabled: false,
    ...overrides,
  },
});

export const viewerResult = (
  data: ClientViewerQuery,
): GraphQLResult<ClientViewerQuery> => ({ ok: true, data });
