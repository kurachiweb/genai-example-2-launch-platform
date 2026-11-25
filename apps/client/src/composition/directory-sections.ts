import { CommentCountMetric } from '../components/engagement/comment-count-metric.tsx';
import { GoldListInsert } from '../components/sponsorship/gold-list-insert.tsx';
import { GoldListPlacement } from '../components/sponsorship/gold-list-placement.tsx';
import { LegendPlacement } from '../components/sponsorship/legend-placement.tsx';
import { SilverPlacement } from '../components/sponsorship/silver-placement.tsx';
import type {
  DirectoryItemMetric,
  DirectoryListInsert,
  DirectorySection,
} from '../components/directory/directory-section-types.ts';

// ディレクトリの置き場所ごとに並べる区画の登録箇所。各specが自分の区画を追記する
export const DIRECTORY_PAGE_SECTIONS: readonly DirectorySection[] =
  Object.freeze([
    {
      id: 'sponsorship.legend',
      placement: 'banner',
      order: 10,
      component: LegendPlacement,
    },
    {
      id: 'sponsorship.gold',
      placement: 'aside',
      order: 10,
      component: GoldListPlacement,
    },
    {
      id: 'sponsorship.silver',
      placement: 'bottom',
      order: 10,
      component: SilverPlacement,
    },
  ]);

// ディレクトリの一覧の項目の間に指定の件数ごとに差し込む区画の登録箇所。各specが自分の差し込みを追記する
export const DIRECTORY_LIST_INSERTS: readonly DirectoryListInsert[] =
  Object.freeze([
    {
      id: 'sponsorship.gold-insert',
      order: 10,
      every: 2,
      component: GoldListInsert,
    },
  ]);

// ディレクトリの一覧の項目に添えるプロダクトごとの値の登録箇所。各specが自分の値を追記する
export const DIRECTORY_ITEM_METRICS: readonly DirectoryItemMetric[] =
  Object.freeze([
    { key: 'comments', order: 10, component: CommentCountMetric },
  ]);
