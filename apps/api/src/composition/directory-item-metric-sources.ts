import type { DirectoryItemMetricRegistration } from '../application/directory/item-metric-sources.ts';
import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';

// ディレクトリの一覧の項目にプロダクトごとの値を加える機能が、登録をここへ追記する
export const DIRECTORY_ITEM_METRIC_SOURCES: readonly DirectoryItemMetricRegistration[] =
  [
    {
      name: 'engagement.comment-count',
      order: 10,
      key: 'comments',
      source: ENGAGEMENT_TYPES.CommentCountMetricSource,
    },
  ];
