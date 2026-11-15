import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import {
  toolbar,
  type ToolbarFeatureConfig,
} from '@milkdown/crepe/feature/toolbar';
import type { Ctx } from '@milkdown/kit/ctx';
import { indentPlugin } from '@milkdown/kit/plugin/indent';
import { uploadPlugin } from '@milkdown/kit/plugin/upload';
import {
  headingKeymap,
  listItemKeymap,
  wrapInHeadingInputRule,
} from '@milkdown/kit/preset/commonmark';
import { tableKeymap } from '@milkdown/kit/preset/gfm';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose, $shortcut } from '@milkdown/kit/utils';

import {
  BOLD_ACTION_LABEL,
  INLINE_CODE_ACTION_LABEL,
  ITALIC_ACTION_LABEL,
  LINK_ACTION_LABEL,
  STRIKETHROUGH_ACTION_LABEL,
} from '../../../utilities/messages/markdown-messages.ts';

import { configureFileTransferGuard } from './file-transfer-guard.ts';
import {
  configureInitialDocument,
  forbiddenNodeNormalizer,
} from './forbidden-node-normalizer.ts';
import { headingInputRule } from './heading-input-rule.ts';

export interface EditorFeatureOptions {
  readonly placeholder: string;
  readonly requestLink: () => void;
}

const LINK_TOOLBAR_GROUP = 'function';

const LINK_TOOLBAR_ITEM = 'link';

const LINK_SHORTCUT = 'Mod-k';

// 選択時のツールバーのリンクの項目は、Crepeのリンクのツールチップ(名前の無いボタンを持つため組み込まない)を開くため、リンクのダイアログの要求に差し替える
const replaceLinkItem =
  (
    requestLink: () => void,
  ): NonNullable<ToolbarFeatureConfig['buildToolbar']> =>
  (groups) => {
    const group = groups.getGroup(LINK_TOOLBAR_GROUP);
    const items = [...group.group.items];
    group.clear();
    for (const { key, ...item } of items) {
      group.addItem(
        key,
        key === LINK_TOOLBAR_ITEM
          ? {
              ...item,
              onRun: () => {
                requestLink();
              },
            }
          : item,
      );
    }
  };

const toolbarConfigOf = (requestLink: () => void): ToolbarFeatureConfig => ({
  boldLabel: BOLD_ACTION_LABEL,
  italicLabel: ITALIC_ACTION_LABEL,
  strikethroughLabel: STRIKETHROUGH_ACTION_LABEL,
  codeLabel: INLINE_CODE_ACTION_LABEL,
  linkLabel: LINK_ACTION_LABEL,
  buildToolbar: replaceLinkItem(requestLink),
});

const linkShortcutOf = (requestLink: () => void) =>
  $shortcut(() => ({
    [LINK_SHORTCUT]: () => {
      requestLink();
      return true;
    },
  }));

const SINK_SHORTCUT = 'Mod-]';

const LIFT_SHORTCUT = 'Mod-[';

// Tabキーで編集領域から抜けられるよう、リストの階層と表のセルの移動をMod-]・Mod-[だけに割り当て、見出しレベル1の割り当てを外す
const configureKeymaps = (ctx: Ctx): void => {
  ctx.update(headingKeymap.key, (keymap) => ({
    ...keymap,
    TurnIntoH1: { ...keymap.TurnIntoH1, shortcuts: [] },
  }));
  ctx.update(listItemKeymap.key, (keymap) => ({
    ...keymap,
    SinkListItem: { ...keymap.SinkListItem, shortcuts: [SINK_SHORTCUT] },
    LiftListItem: { ...keymap.LiftListItem, shortcuts: [LIFT_SHORTCUT] },
  }));
  ctx.update(tableKeymap.key, (keymap) => ({
    ...keymap,
    NextCell: { ...keymap.NextCell, shortcuts: [SINK_SHORTCUT] },
    PrevCell: { ...keymap.PrevCell, shortcuts: [LIFT_SHORTCUT] },
  }));
};

const BRACKET_KEYS: ReadonlySet<string> = new Set(['[', ']']);

const isBracketShortcut = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  BRACKET_KEYS.has(event.key);

// macOSのブラウザはCommand+[・Command+]を戻る・進むに割り当てている。リストや表の外で割り当てが処理しない時も、入力中のページから離れないよう既定の動作を止める。ProseMirrorの処理の後に呼ばれるよう、編集領域の要素に後から聞き手を加える
const bracketShortcutGuard = $prose(
  () =>
    new Plugin({
      view: (view) => {
        const onKeyDown = (event: KeyboardEvent): void => {
          if (isBracketShortcut(event)) {
            event.preventDefault();
          }
        };
        view.dom.addEventListener('keydown', onKeyDown);
        return {
          destroy: () => {
            view.dom.removeEventListener('keydown', onKeyDown);
          },
        };
      },
    }),
);

// 見出しレベル1の入力規則・字下げ(Tabキー)・ファイルからの画像の挿入を外す。作成前の取り外しは同期的に終わる
const removeForbiddenPlugins = (builder: CrepeBuilder): void => {
  void builder.editor.remove([
    wrapInHeadingInputRule,
    indentPlugin,
    uploadPlugin,
  ]);
};

export function addEditorFeatures(
  builder: CrepeBuilder,
  { placeholder: placeholderText, requestLink }: EditorFeatureOptions,
): CrepeBuilder {
  builder
    .addFeature(placeholder, { text: placeholderText, mode: 'doc' })
    .addFeature(cursor)
    .addFeature(toolbar, toolbarConfigOf(requestLink));
  removeForbiddenPlugins(builder);
  builder.editor
    .config(configureKeymaps)
    .config(configureInitialDocument)
    .config(configureFileTransferGuard)
    .use(headingInputRule)
    .use(forbiddenNodeNormalizer)
    .use(bracketShortcutGuard)
    .use(linkShortcutOf(requestLink));
  return builder;
}
