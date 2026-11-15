import type { HandleFormatCheck } from '../../../common-lib/handles/handle-rules.ts';
import { HELP_CATEGORY_OTHER_NAME } from '../../../common-lib/help/help-category-constants.ts';
import {
  HELP_ARTICLE_HANDLE_RULE,
  HELP_BODY_RULE,
  HELP_SUBTITLE_MAX,
  HELP_TITLE_MAX,
  type HelpTextCheck,
} from '../../../common-lib/help/help-input-rules.ts';

export const MOVE_UP_LABEL = '上へ移動';

export const MOVE_DOWN_LABEL = '下へ移動';

export const moveUpName = (name: string): string => `${name}を${MOVE_UP_LABEL}`;

export const moveDownName = (name: string): string =>
  `${name}を${MOVE_DOWN_LABEL}`;

export const helpItemMovedAnnouncement = (
  name: string,
  position: number,
): string => `${name}を${String(position)}番目に移動しました。`;

export const HELP_CATEGORIES_TITLE = 'ヘルプ記事カテゴリ';

const countFormat = new Intl.NumberFormat('ja-JP');

export const helpCategoryDeleteDescription = (articleCount: number): string =>
  `付け替わる記事は${countFormat.format(articleCount)}件です。付け替えた記事は「${HELP_CATEGORY_OTHER_NAME}」の末尾に並びます。`;

export const HELP_CATEGORY_ORDER_EDIT_LABEL = '並び順を変更';

export const HELP_CATEGORY_ORDER_LIST_LABEL = 'ヘルプ記事カテゴリの並び順';

export const HELP_CATEGORY_ORDER_CANCEL_LABEL = 'キャンセル';

export const HELP_ORDER_SAVE_LABEL = '保存';

export const HELP_ORDER_SAVED_MESSAGE = '並び順を保存しました。';

export const HELP_ORDER_OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

export const HELP_ORDER_RELOAD_LABEL = '最新の並びを読み込む';

export const HELP_ARTICLES_TITLE = 'ヘルプ記事';

export const HELP_ARTICLES_DESCRIPTION =
  '下書きを含むすべてのヘルプ記事を、更新日時の新しい順に表示します。';

export const HELP_ARTICLE_CREATE_LABEL = '新規作成';

export const HELP_ARTICLE_ORDER_EDIT_LABEL = '並び順を変更';

export const HELP_ARTICLE_ORDER_VIEW_LABEL = '並び順を見る';

export const HELP_ARTICLE_LIST_CAPTION = 'ヘルプ記事の一覧';

export const HELP_ARTICLE_LIST_COLUMNS = Object.freeze({
  title: 'タイトル',
  handle: 'ハンドル',
  category: 'カテゴリ',
  status: 'ステータス',
  pinned: 'ピン留め',
  creator: '作成者',
  updatedAt: '更新日時',
});

export const HELP_ARTICLE_PINNED_LABEL = 'あり';

export const HELP_ARTICLE_UNPINNED_LABEL = 'なし';

export const HELP_DELETED_AUTHOR_LABEL = '削除済みの管理者';

export const HELP_ARTICLES_EMPTY_MESSAGE = 'ヘルプ記事はまだありません。';

export const HELP_ARTICLES_NO_MATCH_MESSAGE =
  '条件に一致するヘルプ記事はありません。';

export const HELP_CREATOR_FILTER_LABEL = '作成者';

export const HELP_ALL_CREATORS_LABEL = 'すべての作成者';

export const HELP_CATEGORY_FILTER_LABEL = 'カテゴリ';

export const HELP_ALL_CATEGORIES_LABEL = 'すべてのカテゴリ';

export const HELP_STATUS_FILTER_LABEL = 'ステータス';

export const HELP_ALL_STATUSES_LABEL = 'すべてのステータス';

export const HELP_ARTICLE_ORDER_TITLE = 'ヘルプ記事の並び順';

export const HELP_ARTICLE_ORDER_DESCRIPTION =
  'カテゴリごとに、ヘルプトップとフッターに並ぶ記事の順を変更します。ピン留めの記事は、その他の記事より前に並びます。';

export const HELP_ARTICLE_ORDER_CATEGORY_LABEL = 'カテゴリ';

export const HELP_PINNED_ARTICLES_LABEL = 'ピン留めの記事';

export const HELP_OTHER_ARTICLES_LABEL = 'その他の記事';

export const HELP_ARTICLE_ORDER_EMPTY_MESSAGE = '該当する記事はありません。';

export const HELP_ORDER_UNDO_LABEL = '元に戻す';

const helpTextMessagesOf = (
  label: string,
  max: number,
): Readonly<Record<HelpTextCheck, string>> =>
  Object.freeze({
    'forbidden-characters': `${label}に使用できない文字が含まれています。`,
    empty: `${label}を入力してください。`,
    'too-long': `${label}は${String(max)}文字以内で入力してください。`,
  });

export const HELP_TITLE_MESSAGES = helpTextMessagesOf(
  'タイトル',
  HELP_TITLE_MAX,
);

export const HELP_SUBTITLE_MESSAGES = helpTextMessagesOf(
  'サブタイトル',
  HELP_SUBTITLE_MAX,
);

export const HELP_HANDLE_MESSAGES: Readonly<
  Record<HandleFormatCheck, string | undefined>
> = Object.freeze({
  ok: undefined,
  empty: 'ハンドルを入力してください。',
  'too-long': `ハンドルは${String(HELP_ARTICLE_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
  'invalid-characters':
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
});

export const HELP_HANDLE_UNAVAILABLE_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

export const HELP_HANDLE_RELEASES_PREVIOUS_MESSAGE =
  'このハンドルは別の記事の以前のハンドルです。保存すると、その記事の以前のURLは転送されなくなります。';

export const helpPreviousHandleGuidance = (previousHandle: string): string =>
  `以前のハンドル${previousHandle}のURLは、次にハンドルを変更するか、記事を削除するか、他の記事が同じハンドルを設定するまで新しいURLへ転送されます。`;

export const HELP_CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選択してください。';

export const HELP_ARTICLE_FORM_LABELS = Object.freeze({
  title: 'タイトル(必須)',
  subtitle: 'サブタイトル(必須)',
  handle: 'ハンドル(必須)',
  categoryId: 'カテゴリ(必須)',
  pinned: 'ピン留め',
  status: 'ステータス',
  body: `${HELP_BODY_RULE.label}(必須)`,
});

export const HELP_ARTICLE_HANDLE_PREFIX = '/help/';

export const HELP_CATEGORY_PLACEHOLDER = '選択してください';

export const HELP_CATEGORY_MOVE_NOTICE =
  'カテゴリを変えて保存すると、変更先のカテゴリの末尾に並びます。';

export const HELP_PINNED_CHECKBOX_LABEL = 'ピン留めする';

export const HELP_BODY_PLACEHOLDER = '本文をマークダウンで入力してください';

export const HELP_ARTICLE_CREATE_SUBMIT_LABEL = '作成する';

export const HELP_ARTICLE_SAVE_SUBMIT_LABEL = '保存する';

export const HELP_ARTICLE_FORM_CREATE_LABEL = 'ヘルプ記事の作成';

export const HELP_ARTICLE_FORM_EDIT_LABEL = 'ヘルプ記事の編集';

export const HELP_ARTICLES_LINK_LABEL = 'ヘルプ記事の一覧へ';

export const HELP_ARTICLE_CREATED_MESSAGE = 'ヘルプ記事を作成しました。';

export const HELP_ARTICLE_SAVED_MESSAGE = 'ヘルプ記事を保存しました。';

export const HELP_ARTICLE_DELETED_MESSAGE = 'ヘルプ記事を削除しました。';

export const HELP_ARTICLE_NOT_FOUND_MESSAGE =
  'このヘルプ記事は削除されています。';

export const HELP_ARTICLE_OPEN_PUBLIC_LABEL = '公開ページを開く';

export const NEW_TAB_NOTICE = '(新しいタブで開きます)';

export const HELP_ARTICLE_DELETE_LABEL = '削除';

export const helpArticleDeleteTitle = (title: string): string =>
  `ヘルプ記事『${title}』を削除しますか?`;

export const HELP_ARTICLE_DELETE_DESCRIPTION =
  '記事と以前のURLの転送は削除され、元に戻せません。';

export const HELP_ARTICLE_DELETE_CONFIRM_LABEL = '削除';
