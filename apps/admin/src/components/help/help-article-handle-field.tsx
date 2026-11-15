import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { SERVER_FIELD_ERROR_TYPE } from '../../../lib/utilities/forms/server-field-errors.ts';
import { isExpectedFailure } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  type HelpArticleHandleAvailability,
  helpArticleHandleAvailabilityQueryOptions,
  toHelpArticleHandleAvailability,
} from '../../graphql/admin-help-articles.ts';
import type { HelpArticleFormInput } from './help-article-form-schema.ts';
import {
  HELP_ARTICLE_FORM_LABELS,
  HELP_ARTICLE_HANDLE_PREFIX,
  HELP_HANDLE_RELEASES_PREVIOUS_MESSAGE,
  HELP_HANDLE_UNAVAILABLE_MESSAGE,
  helpPreviousHandleGuidance,
} from './help-messages.ts';

const FIELD_NAME = 'fields.handle';

export interface HelpArticleHandleFieldProps {
  // 編集中の記事。作成では渡さない
  readonly article?: {
    readonly id: string;
    // 読み込んだ時点のハンドル。サーバーが使えるとして扱う値のため問い合わせない
    readonly handle: string;
    readonly previousHandle: string | null;
  };
  readonly disabled: boolean;
}

// 問い合わせの失敗は保存を妨げず、保存の時にサーバーが判定し直すため、文言を出さずに確認を諦める
async function fetchAvailability(
  queryClient: QueryClient,
  handle: string,
  articleId: string | undefined,
): Promise<HelpArticleHandleAvailability | undefined> {
  try {
    const data = await queryClient.query({
      ...helpArticleHandleAvailabilityQueryOptions(handle, articleId),
      staleTime: 0,
      gcTime: 0,
    });
    return toHelpArticleHandleAvailability(data);
  } catch (error) {
    if (!isExpectedFailure(error)) {
      reportUnexpectedErrorInBrowser(error, 'render');
    }
    return undefined;
  }
}

export function HelpArticleHandleField({
  article,
  disabled,
}: HelpArticleHandleFieldProps) {
  const queryClient = useQueryClient();
  const form = useFormContext<HelpArticleFormInput>();
  const handle = useWatch({ control: form.control, name: FIELD_NAME });
  // 他の記事の旧ハンドルと一致したハンドル。値を書き換えたら案内を消すため、案内は値が同じ間だけ示す
  const [releasingHandle, setReleasingHandle] = useState<string>();

  // 形式が正しい時だけ問い合わせ、応答を待つ間に値が変わっていれば古い応答を捨てる。使えることの肯定の表示は作らない
  const checkAvailability = async (value: string): Promise<void> => {
    if (value === article?.handle || !(await form.trigger(FIELD_NAME))) {
      return;
    }
    const availability = await fetchAvailability(
      queryClient,
      value,
      article?.id,
    );
    if (availability === undefined || form.getValues(FIELD_NAME) !== value) {
      return;
    }
    setReleasingHandle(
      availability === 'available-releases-previous' ? value : undefined,
    );
    if (availability === 'unavailable') {
      form.setError(FIELD_NAME, {
        type: SERVER_FIELD_ERROR_TYPE,
        message: HELP_HANDLE_UNAVAILABLE_MESSAGE,
      });
    }
  };

  const previousHandle = article?.previousHandle ?? null;
  const releasing = releasingHandle !== undefined && releasingHandle === handle;
  const description =
    previousHandle === null && !releasing ? undefined : (
      <>
        {previousHandle === null ? null : (
          <span className="block">
            {helpPreviousHandleGuidance(previousHandle)}
          </span>
        )}
        {previousHandle !== null && releasing ? ' ' : null}
        {releasing ? (
          <span className="block">{HELP_HANDLE_RELEASES_PREVIOUS_MESSAGE}</span>
        ) : null}
      </>
    );

  return (
    <FormField
      control={form.control}
      name={FIELD_NAME}
      label={HELP_ARTICLE_FORM_LABELS.handle}
      description={description}
      disabled={disabled}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <span
            data-slot="handle-prefix"
            aria-hidden="true"
            className="text-muted-foreground"
          >
            {HELP_ARTICLE_HANDLE_PREFIX}
          </span>
          <Input
            {...control}
            onBlur={() => {
              control.onBlur();
              void checkAvailability(control.value);
            }}
            aria-required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      )}
    </FormField>
  );
}
