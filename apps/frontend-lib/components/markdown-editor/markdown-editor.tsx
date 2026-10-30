import { ClientOnly } from '@tanstack/react-router';
import {
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { cn } from '../../utilities/class-names.ts';
import {
  EDITOR_KEYBOARD_HINT,
  PREVIEW_EMPTY_MESSAGE,
  PREVIEW_TAB_LABEL,
  WRITE_TAB_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import { MarkdownContent } from '../markdown/markdown-content.tsx';
import { useRenderedMarkdown } from '../markdown/use-rendered-markdown.ts';
import { Tabs } from '../ui/tabs/tabs.tsx';
import { TabsContent } from '../ui/tabs/tabs-content.tsx';
import { TabsList } from '../ui/tabs/tabs-list.tsx';
import { TabsTrigger } from '../ui/tabs/tabs-trigger.tsx';
import type { EditorAction, EditorController } from './editor-controller.ts';
import { EditorLoadBoundary } from './editor-load-boundary.tsx';
import { EditorPlaceholder } from './editor-placeholder.tsx';
import { MarkdownLengthCounter } from './markdown-length-counter.tsx';
import { MarkdownLinkDialog } from './markdown-link-dialog.tsx';
import { MarkdownToolbar } from './markdown-toolbar.tsx';

export interface MarkdownEditorFocusTarget {
  focus(): void;
}

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onValueChange: (markdown: string) => void;
  readonly onBlur: () => void;
  // FormFieldが渡すref。AppFormがエラーの欄へフォーカスを移す時に使う
  readonly ref?: Ref<MarkdownEditorFocusTarget>;
  // 表示しているラベルの要素のID(FormFieldが子へ渡すlabelId)
  readonly labelId: string;
  readonly describedById?: string | undefined;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly maxGraphemes: number;
  readonly placeholder: string;
  // 表示場所と同じ描画の指定(本文の識別子は'preview'を推奨)
  readonly preview: MarkdownRenderOptions;
  readonly className?: string;
}

type EditorTab = 'write' | 'preview';

const VALUE_CHANGE_INTERVAL_MS = 150;

const NO_ACTIVE_ACTIONS: ReadonlySet<EditorAction> = new Set();

const NO_RETRY = (): void => undefined;

// 編集領域の直列化は文書の末尾に改行を1つ付ける。文書の末尾の改行はマークダウンの意味を変えないため、フォームへ渡す値と比べる値からは除き、見た目どおりの文字数で数えて検証させる
const withoutTrailingNewline = (markdown: string): string =>
  markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown;

export function MarkdownEditor({
  value,
  onValueChange,
  onBlur,
  ref,
  labelId,
  describedById,
  invalid = false,
  disabled = false,
  maxGraphemes,
  placeholder,
  preview,
  className,
}: MarkdownEditorProps) {
  const id = useId();
  const editableId = `${id}-editable`;
  const hintId = `${id}-hint`;
  const [tab, setTab] = useState<EditorTab>('write');
  const [controller, setController] = useState<EditorController>();
  const [activeActions, setActiveActions] = useState(NO_ACTIVE_ACTIONS);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const controllerRef = useRef<EditorController | undefined>(undefined);
  const pendingFocusRef = useRef(false);
  // フォームへ最後に渡した値。外部からの置き換えと、編集領域が送り返した同じ値を見分ける
  const sentValueRef = useRef(value);
  // 編集領域の内容として最後に知った値。記法の正規化だけの違いをフォームへ渡さないために比べる
  const surfaceMarkdownRef = useRef<string | undefined>(undefined);
  const pendingValueRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSentAtRef = useRef(0);
  const callbacksRef = useRef({ onValueChange, onBlur });

  useEffect(() => {
    callbacksRef.current = { onValueChange, onBlur };
  });

  const isBlank = trimWhiteSpace(value) === '';
  const needsRendered = controller === undefined || tab === 'preview';
  const rendered = useRenderedMarkdown(needsRendered ? value : '', preview);

  const cancelPendingValue = (): void => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    pendingValueRef.current = undefined;
  };

  const sendValue = (markdown: string): void => {
    cancelPendingValue();
    if (markdown === withoutTrailingNewline(sentValueRef.current)) {
      return;
    }
    sentValueRef.current = markdown;
    lastSentAtRef.current = performance.now();
    callbacksRef.current.onValueChange(markdown);
  };

  const handleMarkdownChange = (serialized: string): void => {
    const markdown = withoutTrailingNewline(serialized);
    if (markdown === surfaceMarkdownRef.current) {
      return;
    }
    surfaceMarkdownRef.current = markdown;
    const wait =
      lastSentAtRef.current + VALUE_CHANGE_INTERVAL_MS - performance.now();
    if (wait <= 0) {
      sendValue(markdown);
      return;
    }
    pendingValueRef.current = markdown;
    timerRef.current ??= setTimeout(() => {
      timerRef.current = undefined;
      if (pendingValueRef.current !== undefined) {
        sendValue(pendingValueRef.current);
      }
    }, wait);
  };

  // 編集領域の変更の通知は入力が止まってから遅れて届くため、フォーカスを外した時は編集領域から最新の値を読んで検証の前に渡す
  const handleBlur = (): void => {
    const serialized = controllerRef.current?.readMarkdown();
    const latest =
      serialized === undefined ? undefined : withoutTrailingNewline(serialized);
    if (latest !== undefined && latest !== surfaceMarkdownRef.current) {
      surfaceMarkdownRef.current = latest;
      sendValue(latest);
    } else if (pendingValueRef.current !== undefined) {
      sendValue(pendingValueRef.current);
    }
    callbacksRef.current.onBlur();
  };

  const handleReady = (next: EditorController): void => {
    controllerRef.current = next;
    surfaceMarkdownRef.current = withoutTrailingNewline(next.readMarkdown());
    setController(next);
  };

  // 失敗で破棄された編集領域の制御器は操作の度に例外を投げるため、失敗を受けたら手放し、読み込み前と同じ状態に戻す
  const handleSurfaceFailure = (): void => {
    controllerRef.current = undefined;
    surfaceMarkdownRef.current = undefined;
    setController(undefined);
    setActiveActions(NO_ACTIVE_ACTIONS);
    setLinkDialogOpen(false);
  };

  const requestFocus = (): void => {
    pendingFocusRef.current = true;
    setTab('write');
    setFocusRequest((count) => count + 1);
  };

  const requestLink = (): void => {
    if (!disabled && controllerRef.current !== undefined) {
      setLinkDialogOpen(true);
    }
  };

  useImperativeHandle(ref, () => ({ focus: requestFocus }), []);

  useEffect(() => {
    if (
      controller === undefined ||
      withoutTrailingNewline(value) ===
        withoutTrailingNewline(sentValueRef.current)
    ) {
      return;
    }
    cancelPendingValue();
    sentValueRef.current = value;
    controller.replaceMarkdown(value);
    surfaceMarkdownRef.current = withoutTrailingNewline(
      controller.readMarkdown(),
    );
  }, [value, controller]);

  useEffect(() => {
    if (
      !pendingFocusRef.current ||
      controller === undefined ||
      tab !== 'write'
    ) {
      return;
    }
    pendingFocusRef.current = false;
    controller.focus();
  }, [focusRequest, controller, tab]);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
    },
    [],
  );

  const loadingPlaceholder = (
    <EditorPlaceholder
      state="loading"
      rendered={isBlank ? undefined : rendered}
      placeholder={placeholder}
      onRetry={NO_RETRY}
    />
  );

  return (
    <div
      data-slot="markdown-editor"
      className={cn(
        'rounded-md border border-input bg-card text-card-foreground',
        invalid && 'border-destructive',
        className,
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next === 'preview' ? 'preview' : 'write');
        }}
        className="gap-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-input px-2 py-1.5">
          <TabsList variant="line">
            <TabsTrigger value="write">{WRITE_TAB_LABEL}</TabsTrigger>
            <TabsTrigger value="preview">{PREVIEW_TAB_LABEL}</TabsTrigger>
          </TabsList>
          <MarkdownToolbar
            controller={controller}
            activeActions={activeActions}
            controlsId={editableId}
            disabled={disabled}
            inactive={tab === 'preview'}
            onRequestLink={requestLink}
          />
        </div>
        {/* 書く側の編集領域は、プレビューの間も破棄せず隠して、編集の履歴と制御器を保つ */}
        <TabsContent
          value="write"
          forceMount
          hidden={tab !== 'write'}
          tabIndex={-1}
        >
          <ClientOnly fallback={loadingPlaceholder}>
            <EditorLoadBoundary
              loading={loadingPlaceholder}
              onFailure={handleSurfaceFailure}
              renderFailed={(retry) => (
                <EditorPlaceholder
                  state="failed"
                  rendered={isBlank ? undefined : rendered}
                  placeholder={placeholder}
                  onRetry={() => {
                    requestFocus();
                    retry();
                  }}
                />
              )}
            >
              {(Surface) => (
                <Surface
                  initialValue={value}
                  editableId={editableId}
                  labelledBy={labelId}
                  describedBy={
                    describedById === undefined
                      ? hintId
                      : `${describedById} ${hintId}`
                  }
                  invalid={invalid}
                  disabled={disabled}
                  placeholder={placeholder}
                  onReady={handleReady}
                  onMarkdownChange={handleMarkdownChange}
                  onActiveActionsChange={setActiveActions}
                  onBlur={handleBlur}
                  onRequestLink={requestLink}
                />
              )}
            </EditorLoadBoundary>
          </ClientOnly>
          <span id={hintId} className="sr-only">
            {EDITOR_KEYBOARD_HINT}
          </span>
        </TabsContent>
        <TabsContent value="preview" className="min-h-28 px-3 py-2">
          {isBlank ? (
            <p className="text-sm text-muted-foreground">
              {PREVIEW_EMPTY_MESSAGE}
            </p>
          ) : (
            <MarkdownContent rendered={rendered} size="sm" />
          )}
        </TabsContent>
      </Tabs>
      <div className="flex justify-end border-t border-input px-3 py-1.5">
        <MarkdownLengthCounter value={value} max={maxGraphemes} />
      </div>
      {controller === undefined ? null : (
        <MarkdownLinkDialog
          open={linkDialogOpen}
          controller={controller}
          onOpenChange={setLinkDialogOpen}
        />
      )}
    </div>
  );
}
