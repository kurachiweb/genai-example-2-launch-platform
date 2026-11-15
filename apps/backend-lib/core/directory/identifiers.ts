const DirectoryListingQuery: unique symbol = Symbol.for(
  'directory.DirectoryListingQuery',
);
const DirectoryEntryStore: unique symbol = Symbol.for(
  'directory.DirectoryEntryStore',
);

export const DIRECTORY_PLATFORM_TYPES = Object.freeze({
  DirectoryListingQuery,
  DirectoryEntryStore,
});
