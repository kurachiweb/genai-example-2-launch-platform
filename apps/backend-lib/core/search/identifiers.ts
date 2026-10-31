const TargetCatalog: unique symbol = Symbol.for('search.TargetCatalog');
const SourceProvider: unique symbol = Symbol.for('search.SourceProvider');
const IndexStore: unique symbol = Symbol.for('search.IndexStore');
const RefreshRequester: unique symbol = Symbol.for('search.RefreshRequester');
const KeywordExtractor: unique symbol = Symbol.for('search.KeywordExtractor');
const RefreshHandler: unique symbol = Symbol.for('search.RefreshHandler');
const ReextractionJob: unique symbol = Symbol.for('search.ReextractionJob');

export const SEARCH_TYPES = Object.freeze({
  TargetCatalog,
  SourceProvider,
  IndexStore,
  RefreshRequester,
  KeywordExtractor,
  RefreshHandler,
  ReextractionJob,
});
