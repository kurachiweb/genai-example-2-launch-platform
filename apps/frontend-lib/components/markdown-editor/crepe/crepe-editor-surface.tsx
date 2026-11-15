import './crepe-theme.css';

import { CrepeBuilder } from '@milkdown/crepe/builder';
import { EditorStatus, editorViewCtx } from '@milkdown/kit/core';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose, replaceAll } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import {
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type {
  EditorAction,
  EditorController,
  EditorSurfaceProps,
} from '../editor-controller.ts';
import { cjkRemarkPlugins } from './cjk-remark-plugins.ts';
import {
  configureEditableAccessibility,
  type EditableAccessibility,
  updateEditableAccessibility,
} from './editor-accessibility.ts';
import {
  activeEditorActions,
  applyEditorLink,
  currentEditorLink,
  isSameActionSet,
  runEditorAction,
} from './editor-commands.ts';
import { addEditorFeatures } from './editor-features.ts';
import { taskItemStatePlugin } from './task-item-state.ts';

const activeActionsPlugin = (
  notify: (active: ReadonlySet<EditorAction>) => void,
) =>
  $prose(
    (ctx) =>
      new Plugin({
        view: (view) => {
          let previous = activeEditorActions(ctx, view.state);
          notify(previous);
          return {
            update: (updated) => {
              const next = activeEditorActions(ctx, updated.state);
              if (!isSameActionSet(previous, next)) {
                previous = next;
                notify(next);
              }
            },
          };
        },
      }),
  );

const controllerOf = (builder: CrepeBuilder): EditorController => ({
  run: (action) => {
    builder.editor.action((ctx) => {
      runEditorAction(ctx, action);
    });
  },
  currentLink: () => builder.editor.action(currentEditorLink),
  applyLink: (href) => {
    builder.editor.action((ctx) => {
      applyEditorLink(ctx, href);
    });
  },
  replaceMarkdown: (markdown) => {
    builder.editor.action(replaceAll(markdown));
  },
  readMarkdown: () => builder.getMarkdown(),
  focus: () => {
    builder.editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
  },
});

const accessibilityOf = ({
  editableId,
  labelledBy,
  describedBy,
  invalid,
  disabled,
}: EditorSurfaceProps): EditableAccessibility => ({
  editableId,
  labelledBy,
  describedBy,
  invalid,
  disabled,
});

const applyLatestState = (
  builder: CrepeBuilder,
  props: EditorSurfaceProps,
): void => {
  builder.setReadonly(props.disabled);
  builder.editor.action(updateEditableAccessibility(accessibilityOf(props)));
};

interface CreationFailure {
  readonly error: unknown;
}

// Milkdownのマウントは作成の拒否をコンソールへ出すだけで、拒否された編集領域の破棄は作成中の状態が終わるのを待ち続けるため、拒否を通知し、その後の破棄を省く
const observeCreation = (
  builder: CrepeBuilder,
  onCreationFailed: (error: unknown) => void,
): CrepeBuilder => {
  const create = builder.create.bind(builder);
  const destroy = builder.destroy.bind(builder);
  let failed = false;
  builder.create = async () => {
    try {
      return await create();
    } catch (error) {
      failed = true;
      onCreationFailed(error);
      throw error;
    }
  };
  builder.destroy = () =>
    failed ? Promise.resolve(builder.editor) : destroy();
  return builder;
};

function EditorMount(props: EditorSurfaceProps): ReactElement {
  const latestPropsRef = useRef(props);
  const builderRef = useRef<CrepeBuilder | undefined>(undefined);
  const [creationFailure, setCreationFailure] = useState<CreationFailure>();
  const { editableId, labelledBy, describedBy, invalid, disabled } = props;

  useLayoutEffect(() => {
    latestPropsRef.current = props;
  });

  // 編集領域は1度だけ作り、通知の関数や属性の指定は作成後も最新の値を読む。作成が拒否された編集領域は、作成の途中で登録した通知を後から届けても入力欄へ伝えない
  useEditor((root) => {
    const initial = latestPropsRef.current;
    let rejected = false;
    const notify = (send: (latest: EditorSurfaceProps) => void): void => {
      if (!rejected) {
        send(latestPropsRef.current);
      }
    };
    const builder = new CrepeBuilder({
      root,
      defaultValue: initial.initialValue,
    });
    addEditorFeatures(builder, {
      placeholder: initial.placeholder,
      requestLink: () => {
        notify((latest) => {
          latest.onRequestLink();
        });
      },
    });
    builder.editor
      .config(configureEditableAccessibility(accessibilityOf(initial)))
      .use([...cjkRemarkPlugins])
      .use(taskItemStatePlugin)
      .use(
        activeActionsPlugin((active) => {
          notify((latest) => {
            latest.onActiveActionsChange(active);
          });
        }),
      );
    builder.setReadonly(initial.disabled);
    builder.on((listener) => {
      listener
        .mounted(() => {
          notify((latest) => {
            applyLatestState(builder, latest);
            latest.onReady(controllerOf(builder));
          });
        })
        .markdownUpdated((_, markdown) => {
          notify((latest) => {
            latest.onMarkdownChange(markdown);
          });
        })
        .blur(() => {
          notify((latest) => {
            latest.onBlur();
          });
        });
    });
    builderRef.current = builder;
    return observeCreation(builder, (error) => {
      rejected = true;
      if (builderRef.current === builder) {
        setCreationFailure({ error });
      }
    });
  }, []);

  useEffect(() => {
    const builder = builderRef.current;
    if (builder?.editor.status !== EditorStatus.Created) {
      return;
    }
    applyLatestState(builder, latestPropsRef.current);
  }, [editableId, labelledBy, describedBy, invalid, disabled]);

  // 作成の拒否を描画の失敗として投げ、読み込みの境界に失敗の表示と再試行を任せる
  if (creationFailure !== undefined) {
    throw creationFailure.error;
  }

  return <Milkdown />;
}

export default function CrepeEditorSurface(
  props: EditorSurfaceProps,
): ReactElement {
  return (
    <MilkdownProvider>
      <EditorMount {...props} />
    </MilkdownProvider>
  );
}
