import { SearchIcon, XIcon } from 'lucide-react';
import { type SubmitEvent, useId, useRef, useState } from 'react';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
  lengthOverLimitAnnouncement,
} from '../../../lib/utilities/messages/length-limit-messages.ts';
import {
  KEYWORD_SEARCH_CLEAR_LABEL,
  KEYWORD_SEARCH_COUNTER_PREFIX,
  KEYWORD_SEARCH_INPUT_LABEL,
  KEYWORD_SEARCH_SUBMIT_LABEL,
  keywordSearchTooLongMessage,
} from './keyword-search-form-messages.ts';

export interface KeywordSearchFormProps {
  // URLから正規化した適用中の検索語。外から変わったら入力欄をその値に戻す
  readonly value: string | undefined;
  // 検索語が無ければundefined
  readonly onSearch: (q: string | undefined) => void;
  // 検索の領域の名前(画面に見えない)
  readonly formLabel: string;
  readonly placeholder: string;
  // 前後の空白を除いて数える書記素の上限
  readonly maxGraphemes: number;
  // この書記素数を超えたら文字数を示す
  readonly counterFrom: number;
}

// IME変換中の誤操作と全文検索への問い合わせ回数を抑えるため、入力中は知らせず、Enterキーと検索のボタンでだけ知らせる
export function KeywordSearchForm({
  value,
  onSearch,
  formLabel,
  placeholder,
  maxGraphemes,
  counterFrom,
}: KeywordSearchFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const counterId = useId();
  const errorId = useId();
  const [text, setText] = useState(value ?? '');
  const [touched, setTouched] = useState(false);
  // 条件の解除やブラウザの戻る操作でURLの検索語が変わったら入力欄を戻す。部品を作り直すと検索の後に入力欄のフォーカスを失うため、描画中に状態を差し替える
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(value ?? '');
    setTouched(false);
  }

  const term = trimWhiteSpace(text);
  const length = countGraphemes(term);
  const tooLong = length > maxGraphemes;
  const showsCounter = length > counterFrom;
  const showsError = tooLong && touched;
  const [announcedTooLong, setAnnouncedTooLong] = useState(tooLong);
  const [announcement, setAnnouncement] = useState('');
  // 入力のたびに読み上げないよう、上限を超えた時と上限以内に戻った時だけ読み上げの文言を変える
  if (tooLong !== announcedTooLong) {
    setAnnouncedTooLong(tooLong);
    setAnnouncement(
      tooLong
        ? lengthOverLimitAnnouncement(maxGraphemes)
        : LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
    );
  }
  const describedBy = [showsCounter && counterId, showsError && errorId]
    .filter((id) => id !== false)
    .join(' ');

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tooLong) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    onSearch(term === '' ? undefined : term);
  };

  const clear = () => {
    setText('');
    setTouched(false);
    inputRef.current?.focus();
    if (value !== undefined) {
      onSearch(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <form
        role="search"
        aria-label={formLabel}
        className="flex gap-2"
        onSubmit={submit}
      >
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={KEYWORD_SEARCH_INPUT_LABEL}
            placeholder={placeholder}
            value={text}
            aria-invalid={showsError ? true : undefined}
            aria-describedby={describedBy === '' ? undefined : describedBy}
            className={cn(
              'h-11 rounded-xl bg-card pl-9 text-base shadow-sm md:text-base dark:bg-card [&::-webkit-search-cancel-button]:appearance-none',
              showsCounter ? 'pr-24' : 'pr-11',
            )}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onBlur={() => {
              setTouched(true);
            }}
          />
          <div className="absolute inset-y-0 right-2 flex items-center gap-1">
            <span
              id={counterId}
              className={cn(
                'text-xs tabular-nums',
                tooLong
                  ? 'font-bold text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {showsCounter ? (
                <>
                  <span className="sr-only">
                    {KEYWORD_SEARCH_COUNTER_PREFIX}
                  </span>
                  <span>{`${String(length)}/${String(maxGraphemes)}`}</span>
                </>
              ) : null}
            </span>
            {text === '' ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={KEYWORD_SEARCH_CLEAR_LABEL}
                onClick={clear}
              >
                <XIcon aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        <Button type="submit" className="h-11 rounded-xl px-5">
          {KEYWORD_SEARCH_SUBMIT_LABEL}
        </Button>
      </form>
      {showsError ? (
        <FormMessage id={errorId}>
          {keywordSearchTooLongMessage(maxGraphemes)}
        </FormMessage>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
