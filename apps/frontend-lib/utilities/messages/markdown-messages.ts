export const READ_MORE_LABEL = '続きを読む';

export const COLLAPSE_LABEL = '折りたたむ';

export const TASK_ITEM_CHECKED_LABEL = '完了';

export const TASK_ITEM_UNCHECKED_LABEL = '未完了';

export const FORMAT_TOOLBAR_LABEL = '書式';

export const HEADING_ACTION_LABEL = '見出し';

export const BOLD_ACTION_LABEL = '太字';

export const ITALIC_ACTION_LABEL = '斜体';

export const LINK_ACTION_LABEL = 'リンク';

export const BULLET_LIST_ACTION_LABEL = '箇条書き';

export const ORDERED_LIST_ACTION_LABEL = '番号付きリスト';

export const BLOCKQUOTE_ACTION_LABEL = '引用';

export const INLINE_CODE_ACTION_LABEL = 'コード';

export const CODE_BLOCK_ACTION_LABEL = 'コードブロック';

export const TABLE_ACTION_LABEL = '表';

export const STRIKETHROUGH_ACTION_LABEL = '取り消し線';

export const WRITE_TAB_LABEL = '書く';

export const PREVIEW_TAB_LABEL = 'プレビュー';

export const PREVIEW_EMPTY_MESSAGE = 'プレビューする内容がありません。';

export const EDITOR_LOADING_LABEL = 'エディタを読み込んでいます';

export const EDITOR_LOAD_FAILED_MESSAGE = 'エディタを読み込めませんでした。';

// サーバー側の描画とブラウザで同じ文言にするため、利用者のロケールによらず日本語の3桁区切りにする
const countFormat = new Intl.NumberFormat('ja-JP');

export const formatCount = (count: number): string => countFormat.format(count);

export const lengthOverLimitAnnouncement = (max: number): string =>
  `文字数が上限の${formatCount(max)}文字を超えています。`;

export const LENGTH_WITHIN_LIMIT_ANNOUNCEMENT =
  '文字数が上限以内に戻りました。';

export const EDITOR_KEYBOARD_HINT =
  'リストの項目の階層を下げる操作と表の次のセルへの移動はCtrl+]、階層を上げる操作と表の前のセルへの移動はCtrl+[で行います(macOSではCtrlの代わりにCommand)。';

export const LINK_DIALOG_TITLE = 'リンクの設定';

export const LINK_URL_LABEL = 'URL';

export const LINK_APPLY_LABEL = '設定';

export const LINK_REMOVE_LABEL = 'リンクを解除';

export const LINK_CANCEL_LABEL = 'キャンセル';

export const LINK_URL_FORMAT_ERROR =
  '"https://"・"http://"・"mailto:"で始まるURLか、"#"で始まるページ内のリンクを入力してください。';
