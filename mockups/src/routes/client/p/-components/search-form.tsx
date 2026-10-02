import { useId, useRef, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';

import { SEARCH_COUNTER_FROM, SEARCH_MAX_LENGTH } from '../-model/query';
import { countGraphemes } from '../-model/text';

type Props = {
  value: string | undefined;
  onSearch: (q: string | undefined) => void;
};

// 入力中は一覧を動かさず、Enterキーか検索ボタンで実行する(IME変換中の誤爆と問い合わせ回数を防ぐ)
export function SearchForm({ value, onSearch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value ?? '');
  const [touched, setTouched] = useState(false);
  // 条件の解除やブラウザの戻る操作でURLの検索語が変わったら入力欄も合わせる。再マウントすると検索実行時に入力欄のフォーカスが外れるため、レンダー中に追従させる
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(value ?? '');
    setTouched(false);
  }
  const counterId = useId();
  const errorId = useId();

  const length = countGraphemes(text);
  const tooLong = length > SEARCH_MAX_LENGTH;
  const showCounter = length > SEARCH_COUNTER_FROM;
  const showError = tooLong && touched;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (tooLong) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    onSearch(text.trim() || undefined);
  };

  const clear = () => {
    setText('');
    setTouched(false);
    if (value) onSearch(undefined);
    inputRef.current?.focus();
  };

  const describedBy = [showCounter && counterId, showError && errorId]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <form
        role="search"
        aria-label="プロダクト"
        onSubmit={submit}
        className="flex gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            aria-label="検索キーワード"
            placeholder="プロダクト名・タグライン・説明文で検索"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError || undefined}
            aria-describedby={describedBy || undefined}
            className={cn(
              'h-11 rounded-xl bg-card pl-9 text-base shadow-sm md:text-base dark:bg-card [&::-webkit-search-cancel-button]:appearance-none',
              showCounter ? 'pr-24' : 'pr-11',
            )}
          />
          <div className="absolute inset-y-0 right-2 flex items-center gap-1">
            {showCounter && (
              <span
                id={counterId}
                className={cn(
                  'text-xs tabular-nums',
                  tooLong
                    ? 'font-bold text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                <span className="sr-only">文字数</span>
                {length}/{SEARCH_MAX_LENGTH}
              </span>
            )}
            {text && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="検索キーワードを消去"
                onClick={clear}
              >
                <XIcon />
              </Button>
            )}
          </div>
        </div>
        <Button type="submit" className="h-11 rounded-xl px-5">
          検索
        </Button>
      </form>
      {showError && (
        <p id={errorId} className="mt-1.5 text-sm text-destructive">
          検索キーワードは{SEARCH_MAX_LENGTH}文字以内で入力してください。
        </p>
      )}
    </div>
  );
}
