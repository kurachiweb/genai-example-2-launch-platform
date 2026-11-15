import type { ClientPublicProfileQuery } from '../../graphql/generated/graphql.ts';

export type PublicProfileView = Extract<
  NonNullable<ClientPublicProfileQuery['publicProfile']>,
  { readonly __typename: 'PublicProfile' }
>;

export type PublicProfileWebsiteView = PublicProfileView['websites'][number];
