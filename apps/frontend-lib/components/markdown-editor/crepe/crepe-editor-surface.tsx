import './crepe-theme.css';

import { CrepeBuilder } from '@milkdown/crepe/builder';
import { EditorStatus, editorViewCtx } from '@milkdown/kit/core';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose, replaceAll } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { type ReactElement, useEffect, useLayoutEffect, useRef } from 'react';

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

function EditorMount(props: EditorSurfaceProps): ReactElement {
  const latestPropsRef = useRef(props);
  const builderRef = useRef<CrepeBuilder | undefined>(undefined);
  const { editableId, labelledBy, describedBy, invalid, disabled } = props;

  useLayoutEffect(() => {
    latestPropsRef.current = props;
  });

  // 編集領域は1度だけ作り、通知の関数や属性の指定は作成後も最新の値を読む
  useEditor((root) => {
    const initial = latestPropsRef.current;
    const builder = new CrepeBuilder({
      root,
      defaultValue: initial.initialValue,
    });
    addEditorFeatures(builder, {
      placeholder: initial.placeholder,
      requestLink: () => {
        latestPropsRef.current.onRequestLink();
      },
    });
    builder.editor
      .config(configureEditableAccessibility(accessibilityOf(initial)))
      .use([...cjkRemarkPlugins])
      .use(taskItemStatePlugin)
      .use(
        activeActionsPlugin((active) => {
          latestPropsRef.current.onActiveActionsChange(active);
        }),
      );
    builder.setReadonly(initial.disabled);
    builder.on((listener) => {
      listener
        .mounted(() => {
          applyLatestState(builder, latestPropsRef.current);
          latestPropsRef.current.onReady(controllerOf(builder));
        })
        .markdownUpdated((_, markdown) => {
          latestPropsRef.current.onMarkdownChange(markdown);
        })
        .blur(() => {
          latestPropsRef.current.onBlur();
        });
    });
    builderRef.current = builder;
    return builder;
  }, []);

  useEffect(() => {
    const builder = builderRef.current;
    if (builder?.editor.status !== EditorStatus.Created) {
      return;
    }
    applyLatestState(builder, latestPropsRef.current);
  }, [editableId, labelledBy, describedBy, invalid, disabled]);

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
