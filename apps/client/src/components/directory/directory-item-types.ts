import type { ClientDirectoryQuery } from '../../graphql/generated/graphql.ts';

export type DirectoryItemData =
  ClientDirectoryQuery['directory']['items'][number];

export type DirectoryWinData = DirectoryItemData['win'];

export type DirectoryAwardData = DirectoryItemData['awards'][number];
