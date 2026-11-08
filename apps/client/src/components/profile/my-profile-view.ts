import type { ClientMyProfileQuery } from '../../graphql/generated/graphql.ts';

export type MyProfileView = ClientMyProfileQuery['myProfile'];

export type MyProfileWebsiteView = MyProfileView['websites'][number];
