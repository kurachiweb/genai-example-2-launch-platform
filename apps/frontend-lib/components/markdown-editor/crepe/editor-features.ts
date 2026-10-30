import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import {
  toolbar,
  type ToolbarFeatureConfig,
} from '@milkdown/crepe/feature/toolbar';
import { $shortcut } from '@milkdown/kit/utils';

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
  boldLabel: '太字',
  italicLabel: '斜体',
  strikethroughLabel: '取り消し線',
  codeLabel: 'コード',
  linkLabel: 'リンク',
  buildToolbar: replaceLinkItem(requestLink),
});

const linkShortcutOf = (requestLink: () => void) =>
  $shortcut(() => ({
    [LINK_SHORTCUT]: () => {
      requestLink();
      return true;
    },
  }));

export function addEditorFeatures(
  builder: CrepeBuilder,
  { placeholder: placeholderText, requestLink }: EditorFeatureOptions,
): CrepeBuilder {
  builder
    .addFeature(placeholder, { text: placeholderText, mode: 'doc' })
    .addFeature(cursor)
    .addFeature(toolbar, toolbarConfigOf(requestLink));
  builder.editor.use(linkShortcutOf(requestLink));
  return builder;
}
