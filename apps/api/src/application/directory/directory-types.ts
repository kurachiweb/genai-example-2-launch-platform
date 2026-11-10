// backend-lib/core/directoryのDIRECTORY_PLATFORM_TYPESも同じdirectory.の接頭辞を使うため、メンバーの名前を重ねない
const LaunchHighlightsReader: unique symbol = Symbol.for(
  'directory.LaunchHighlightsReader',
);

const ItemMetricSources: unique symbol = Symbol.for(
  'directory.ItemMetricSources',
);

const ItemMetricsReader: unique symbol = Symbol.for(
  'directory.ItemMetricsReader',
);

const DirectoryReader: unique symbol = Symbol.for('directory.DirectoryReader');

const DirectoryCategoryReader: unique symbol = Symbol.for(
  'directory.DirectoryCategoryReader',
);

export const DIRECTORY_TYPES = Object.freeze({
  DirectoryReader,
  DirectoryCategoryReader,
  LaunchHighlightsReader,
  ItemMetricSources,
  ItemMetricsReader,
});
