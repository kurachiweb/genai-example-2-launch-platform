import { useId, useRef, useState } from 'react';
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Markdown } from '#/components/client/markdown';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { Textarea } from '#/components/ui/textarea';
import { cn } from '#/lib/utils';

import { countGraphemes } from './comment-tree';
import { StarRatingInput } from './star-rating-input';

type Props = {
  submitLabel: string;
  placeholder: string;
  onSubmit: (body: string, rating: number | null) => void;
  onCancel?: () => void;
  initialBody?: string;
  // 投稿時に任意の5段階評価を添えられる場合のみ指定する(FR-RATNG-002)
  rating?: { value: number | null };
  autoFocus?: boolean;
};

const MAX_LENGTH = 2000;

type Tool = {
  label: string;
  icon: LucideIcon;
  apply: (selected: string) => { before: string; text: string; after: string };
  line?: boolean;
};

// 見出しレベル1と画像は除外する(FR-MDOWN-002)
const TOOLS: Tool[] = [
  {
    label: '見出し',
    icon: Heading2Icon,
    line: true,
    apply: (s) => ({ before: '## ', text: s || '見出し', after: '' }),
  },
  {
    label: '太字',
    icon: BoldIcon,
    apply: (s) => ({ before: '**', text: s || '太字', after: '**' }),
  },
  {
    label: '斜体',
    icon: ItalicIcon,
    apply: (s) => ({ before: '_', text: s || '斜体', after: '_' }),
  },
  {
    label: 'リンク',
    icon: LinkIcon,
    apply: (s) => ({ before: '[', text: s || 'リンク', after: '](https://)' }),
  },
  {
    label: '箇条書き',
    icon: ListIcon,
    line: true,
    apply: (s) => ({ before: '- ', text: s, after: '' }),
  },
  {
    label: '番号付きリスト',
    icon: ListOrderedIcon,
    line: true,
    apply: (s) => ({ before: '1. ', text: s, after: '' }),
  },
  {
    label: '引用',
    icon: QuoteIcon,
    line: true,
    apply: (s) => ({ before: '> ', text: s, after: '' }),
  },
  {
    label: 'コード',
    icon: CodeIcon,
    apply: (s) => ({ before: '`', text: s || 'code', after: '`' }),
  },
  {
    label: 'コードブロック',
    icon: SquareCodeIcon,
    line: true,
    apply: (s) => ({ before: '```\n', text: s, after: '\n```' }),
  },
];

export function CommentComposer({
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
  initialBody = '',
  rating,
  autoFocus = false,
}: Props) {
  const textareaId = useId();
  const errorId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initialBody);
  const [stars, setStars] = useState<number | null>(rating?.value ?? null);
  const [touched, setTouched] = useState(false);
  const length = countGraphemes(body);
  const tooLong = length > MAX_LENGTH;
  const showError = touched && tooLong;

  const applyTool = (tool: Tool) => {
    const element = textarea.current;
    if (!element) return;
    const { selectionStart, selectionEnd } = element;
    const selected = body.slice(selectionStart, selectionEnd);
    const needsBreak =
      tool.line && selectionStart > 0 && body[selectionStart - 1] !== '\n';
    const { before, text, after } = tool.apply(selected);
    const prefix = `${needsBreak ? '\n' : ''}${before}`;
    const next = `${body.slice(0, selectionStart)}${prefix}${text}${after}${body.slice(selectionEnd)}`;
    setBody(next);
    requestAnimationFrame(() => {
      element.focus();
      const start = selectionStart + prefix.length;
      element.setSelectionRange(start, start + text.length);
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (tooLong || body.trim() === '') return;
    onSubmit(body.trim(), stars);
    setBody('');
    setTouched(false);
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card">
      <Tabs defaultValue="write" className="gap-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5">
          <TabsList variant="line">
            <TabsTrigger value="write">書く</TabsTrigger>
            <TabsTrigger value="preview">プレビュー</TabsTrigger>
          </TabsList>
          <div
            role="toolbar"
            aria-label="書式"
            aria-controls={textareaId}
            className="flex flex-wrap"
          >
            {TOOLS.map((tool) => (
              <Button
                key={tool.label}
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={tool.label}
                title={tool.label}
                onClick={() => applyTool(tool)}
              >
                <tool.icon />
              </Button>
            ))}
          </div>
        </div>
        <TabsContent value="write" className="p-2">
          <label htmlFor={textareaId} className="sr-only">
            {placeholder}
          </label>
          <Textarea
            id={textareaId}
            ref={textarea}
            value={body}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(event) => setBody(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError}
            aria-describedby={showError ? errorId : undefined}
            className="min-h-24 border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </TabsContent>
        <TabsContent value="preview" className="min-h-24 p-3">
          {body.trim() ? (
            <Markdown size="sm" externalRel="noopener ugc">
              {body}
            </Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              プレビューする内容がありません。
            </p>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3 py-2">
        {rating && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">評価(任意)</span>
            <StarRatingInput
              label="このプロダクトの評価(任意)"
              value={stars}
              onChange={setStars}
              size="sm"
            />
          </div>
        )}
        <p
          className={cn(
            'scoreboard-digits ml-auto text-xs',
            tooLong ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              キャンセル
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={tooLong || body.trim() === ''}
          >
            {submitLabel}
          </Button>
        </div>
        {showError && (
          <p id={errorId} className="w-full text-xs text-destructive">
            コメントは2,000文字以内で入力してください。
          </p>
        )}
      </div>
    </form>
  );
}
