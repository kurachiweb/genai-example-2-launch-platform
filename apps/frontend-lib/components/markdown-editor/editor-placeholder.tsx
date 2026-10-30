import type { RenderedMarkdown } from '../../../common-lib/markdown/render-markdown.ts';
import { cn } from '../../utilities/class-names.ts';
import {
  EDITOR_LOAD_FAILED_MESSAGE,
  EDITOR_LOADING_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import { RETRY_LABEL } from '../../utilities/messages/state-messages.ts';
import { MarkdownContent } from '../markdown/markdown-content.tsx';
import { Button } from '../ui/button/button.tsx';

export type EditorPlaceholderState = 'loading' | 'failed';

export interface EditorPlaceholderProps {
  readonly state: EditorPlaceholderState;
  // 空の値は描画結果を渡さず、プレースホルダーの文を表示する。失敗の表示でも値が失われていないことを示すため同じく表示する
  readonly rendered: RenderedMarkdown | undefined;
  readonly placeholder: string;
  readonly onRetry: () => void;
  readonly className?: string;
}

export function EditorPlaceholder({
  state,
  rendered,
  placeholder,
  onRetry,
  className,
}: EditorPlaceholderProps) {
  const content =
    rendered === undefined ? (
      <p className="text-sm text-muted-foreground">{placeholder}</p>
    ) : (
      <MarkdownContent rendered={rendered} size="sm" />
    );

  if (state === 'failed') {
    return (
      <div
        data-slot="editor-placeholder"
        data-state="failed"
        className={cn('flex min-h-28 flex-col gap-3 px-3 py-2', className)}
      >
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm">{EDITOR_LOAD_FAILED_MESSAGE}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {RETRY_LABEL}
          </Button>
        </div>
        {content}
      </div>
    );
  }

  return (
    <div
      data-slot="editor-placeholder"
      data-state="loading"
      className={cn('min-h-28 px-3 py-2', className)}
    >
      <p role="status" className="sr-only">
        {EDITOR_LOADING_LABEL}
      </p>
      <div aria-busy="true">{content}</div>
    </div>
  );
}
