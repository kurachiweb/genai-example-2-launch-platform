import type {
  DirectoryItemMetric,
  DirectoryListInsert,
  DirectorySection,
} from '../components/directory/directory-section-types.ts';

// ディレクトリの置き場所ごとに並べる区画の登録箇所。各specが自分の区画を追記する
export const DIRECTORY_PAGE_SECTIONS: readonly DirectorySection[] =
  Object.freeze([]);

// ディレクトリの一覧の項目の間に指定の件数ごとに差し込む区画の登録箇所。各specが自分の差し込みを追記する
export const DIRECTORY_LIST_INSERTS: readonly DirectoryListInsert[] =
  Object.freeze([]);

// ディレクトリの一覧の項目に添えるプロダクトごとの値の登録箇所。各specが自分の値を追記する
export const DIRECTORY_ITEM_METRICS: readonly DirectoryItemMetric[] =
  Object.freeze([]);
