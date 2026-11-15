import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  type DefaultValues,
  type FieldPath,
  useController,
  useFormContext,
} from 'react-hook-form';
import type { z } from 'zod';

import {
  COMMENT_BOT_ACTIONS,
  COMMENT_MAX_GRAPHEMES,
  type RatingScore,
} from '../../../common-lib/engagement/engagement-rules.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { MarkdownEditor } from '../../../lib/components/markdown-editor/markdown-editor.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { BOT_CHECK_FAILED_MESSAGE } from '../../../lib/utilities/messages/bot-protection-messages.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { productRatingQueryOptions } from '../../graphql/engagement.ts';
import {
  type CommentFormInput,
  type CommentFormOutput,
  commentFormSchema,
  type CommentWithRatingFormInput,
  type CommentWithRatingFormOutput,
  commentWithRatingFormSchema,
} from './comment-form-schema.ts';
import {
  COMMENT_CANCEL_LABEL,
  COMMENT_EDIT_PLACEHOLDER,
  COMMENT_EDIT_SUBMIT_LABEL,
  COMMENT_POST_PLACEHOLDER,
  COMMENT_POST_SUBMIT_LABEL,
  COMMENT_RATING_INPUT_LABEL,
  COMMENT_RATING_ROW_LABEL,
  COMMENT_REPLY_PLACEHOLDER,
  COMMENT_REPLY_SUBMIT_LABEL,
} from './comment-messages.ts';
import { StarRatingInput } from './star-rating-input.tsx';
import { useEngagementViewer } from './use-engagement-viewer.ts';

export type CommentComposerTarget =
  | { readonly mode: 'post' }
  | { readonly mode: 'reply'; readonly onCancel: () => void }
  | {
      readonly mode: 'edit';
      readonly body: string;
      readonly topLevel: boolean;
      readonly onCancel: () => void;
    };

// 投稿先と編集するコメントのIDは呼び出し元が足す。評価は評価の行で現在の評価から変えた時だけ持つ
export interface CommentSubmission {
  readonly body: string;
  readonly rating?: RatingScore;
  readonly turnstileToken: string;
}

export interface CommentComposerProps {
  readonly target: CommentComposerTarget;
  readonly productId: string;
  readonly viewerIsOwner: boolean;
  // 投稿・返信・編集の操作。解決すると成功として入力を空にし、拒否すると入力を保って失敗の文言を示す
  readonly onSubmit: (submission: CommentSubmission) => Promise<void>;
}

type ComposerMode = CommentComposerTarget['mode'];

interface ComposerCopy {
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly botAction: string;
}

const COPY_BY_MODE: Readonly<Record<ComposerMode, ComposerCopy>> =
  Object.freeze({
    post: {
      placeholder: COMMENT_POST_PLACEHOLDER,
      submitLabel: COMMENT_POST_SUBMIT_LABEL,
      botAction: COMMENT_BOT_ACTIONS.post,
    },
    reply: {
      placeholder: COMMENT_REPLY_PLACEHOLDER,
      submitLabel: COMMENT_REPLY_SUBMIT_LABEL,
      botAction: COMMENT_BOT_ACTIONS.post,
    },
    edit: {
      placeholder: COMMENT_EDIT_PLACEHOLDER,
      submitLabel: COMMENT_EDIT_SUBMIT_LABEL,
      botAction: COMMENT_BOT_ACTIONS.edit,
    },
  });

const EMPTY_BODY_VALUES: CommentFormInput = Object.freeze({ body: '' });

const initialBodyOf = (target: CommentComposerTarget): string =>
  target.mode === 'edit' ? target.body : '';

const isTopLevel = (target: CommentComposerTarget): boolean =>
  target.mode === 'post' || (target.mode === 'edit' && target.topLevel);

function BodyField({ placeholder }: { readonly placeholder: string }) {
  const { control } = useFormContext<CommentFormInput>();
  // コメントの本文と同じrelの指定で描き、本文の識別子だけ入力欄の中と分ける
  const preview = useMarkdownOptions({
    externalLinkRel: ['noopener', 'ugc'],
    idScope: 'preview',
  });

  return (
    <FormField
      control={control}
      name="body"
      label={<span className="sr-only">{placeholder}</span>}
    >
      {(field) => (
        <MarkdownEditor
          value={field.value}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          labelId={field.labelId}
          describedById={field['aria-describedby']}
          invalid={field['aria-invalid'] === true}
          disabled={field.disabled === true}
          maxGraphemes={COMMENT_MAX_GRAPHEMES}
          placeholder={placeholder}
          preview={preview}
        />
      )}
    </FormField>
  );
}

function RatingField({
  currentScore,
}: {
  readonly currentScore: number | null;
}) {
  const { control, getFieldState, resetField } =
    useFormContext<CommentWithRatingFormInput>();
  const { field, fieldState } = useController({ control, name: 'rating' });
  const messageId = useId();
  const message = fieldState.error?.message;
  const hasError = message !== undefined && message !== '';

  // 評価欄と同じ値を示すため、利用者が選んでいない間は評価欄の値の変化に合わせる
  useEffect(() => {
    if (!getFieldState('rating').isDirty) {
      resetField('rating', { defaultValue: currentScore });
    }
  }, [currentScore, getFieldState, resetField]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {COMMENT_RATING_ROW_LABEL}
        </span>
        <StarRatingInput
          label={COMMENT_RATING_INPUT_LABEL}
          value={field.value}
          onChange={field.onChange}
          size="sm"
          {...(hasError ? { describedBy: messageId } : {})}
        />
      </div>
      {hasError ? <FormMessage id={messageId}>{message}</FormMessage> : null}
    </div>
  );
}

interface ComposerFormProps<TInput extends CommentFormInput, TOutput> {
  readonly target: CommentComposerTarget;
  readonly schema: z.ZodType<TOutput, TInput>;
  readonly defaultValues: TInput & DefaultValues<TInput>;
  readonly ratingField: ReactNode;
  readonly submissionOf: (
    values: TOutput,
  ) => Omit<CommentSubmission, 'turnstileToken'>;
  readonly valuesAfterSuccess: (values: TOutput) => TInput;
  readonly onSubmit: (submission: CommentSubmission) => Promise<void>;
}

function ComposerForm<TInput extends CommentFormInput, TOutput>({
  target,
  schema,
  defaultValues,
  ratingField,
  submissionOf,
  valuesAfterSuccess,
  onSubmit,
}: ComposerFormProps<TInput, TOutput>) {
  const form = useAppForm<TInput, TOutput>(schema, { defaultValues });
  const turnstile = useTurnstileToken();
  const [submitError, setSubmitError] = useState<string>();
  const [tokenUnavailable, setTokenUnavailable] = useState(false);
  const [submitFocused, setSubmitFocused] = useState(false);
  // 返信と編集の欄は利用者の操作でその場に開き、開いた元の操作(メニューの項目など)が消えることがあるため、開いた時に本文へフォーカスを移す
  const [bodyFocusRequest, setBodyFocusRequest] = useState(
    target.mode === 'post' ? 0 : 1,
  );
  const copy = COPY_BY_MODE[target.mode];
  const tokenPending = turnstile.token === undefined;
  // トークンの用意を待つ間は押せなくする。フォーカスのあるボタンを無効にするとフォーカスを失うため、フォーカスが離れるまでaria-disabledにし、その間の送信はトークンを待ってから送る
  const pendingWhileFocused = tokenPending && submitFocused;

  // 空にした本文で送信ボタンが無効になりフォーカスを失うため、開いたまま残るトップレベルの投稿欄も本文へフォーカスを移す。resetは欄の登録を外し、描き直しで登録し直されるため、描き直しの後に移す
  useEffect(() => {
    if (bodyFocusRequest > 0) {
      form.setFocus('body' as FieldPath<TInput>);
    }
  }, [bodyFocusRequest, form]);

  return (
    <AppForm
      form={form}
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setSubmitError(undefined);
        setTokenUnavailable(false);
        const turnstileToken = await turnstile.waitForToken();
        if (turnstileToken === undefined) {
          setTokenUnavailable(true);
          return;
        }
        await onSubmit({ ...submissionOf(values), turnstileToken });
        form.reset(valuesAfterSuccess(values));
        if (target.mode === 'post') {
          setBodyFocusRequest((count) => count + 1);
        }
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-3"
    >
      <BodyField placeholder={copy.placeholder} />
      <TurnstileWidget {...turnstile.widgetProps} action={copy.botAction} />
      {tokenUnavailable && turnstile.status !== 'error' ? (
        <FormMessage role="alert">{BOT_CHECK_FAILED_MESSAGE}</FormMessage>
      ) : null}
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {ratingField}
        <div className="ml-auto flex gap-2">
          {target.mode === 'post' ? null : (
            // 押し下げで本文の欄からフォーカスが外れると、空の本文の検証の文言が出てボタンの位置がずれ、押し上げが外れてキャンセルにならないため、押し下げではフォーカスを移さない
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={target.onCancel}
            >
              {COMMENT_CANCEL_LABEL}
            </Button>
          )}
          <SubmitButton
            size="sm"
            disabled={tokenPending && !submitFocused}
            {...(pendingWhileFocused ? { 'aria-disabled': true } : {})}
            onFocus={() => {
              setSubmitFocused(true);
            }}
            onBlur={() => {
              setSubmitFocused(false);
            }}
          >
            {copy.submitLabel}
          </SubmitButton>
        </div>
      </div>
    </AppForm>
  );
}

interface RatedComposerProps {
  readonly target: CommentComposerTarget;
  readonly viewerId: string;
  readonly productId: string;
  readonly onSubmit: (submission: CommentSubmission) => Promise<void>;
}

// 評価の行の初期値は評価欄と共有するキャッシュの閲覧者の現在の評価で、選ばずに送ると既存の評価を変えないよう、現在の評価から変えた時だけ評価を送る
function RatedComposer({
  target,
  viewerId,
  productId,
  onSubmit,
}: RatedComposerProps) {
  const { data } = useQuery(productRatingQueryOptions(viewerId, productId));
  const currentScore = data?.productRating?.viewerScore ?? null;
  const [defaultValues] = useState<CommentWithRatingFormInput>(() => ({
    body: initialBodyOf(target),
    rating: currentScore,
  }));

  return (
    <ComposerForm<CommentWithRatingFormInput, CommentWithRatingFormOutput>
      target={target}
      schema={commentWithRatingFormSchema}
      defaultValues={defaultValues}
      ratingField={<RatingField currentScore={currentScore} />}
      submissionOf={({ body, rating }) =>
        rating === null || rating === currentScore ? { body } : { body, rating }
      }
      valuesAfterSuccess={({ rating }) => ({
        body: '',
        rating: rating ?? currentScore,
      })}
      onSubmit={onSubmit}
    />
  );
}

interface PlainComposerProps {
  readonly target: CommentComposerTarget;
  readonly onSubmit: (submission: CommentSubmission) => Promise<void>;
}

function PlainComposer({ target, onSubmit }: PlainComposerProps) {
  const [defaultValues] = useState<CommentFormInput>(() => ({
    body: initialBodyOf(target),
  }));

  return (
    <ComposerForm<CommentFormInput, CommentFormOutput>
      target={target}
      schema={commentFormSchema}
      defaultValues={defaultValues}
      ratingField={null}
      submissionOf={({ body }) => ({ body })}
      valuesAfterSuccess={() => EMPTY_BODY_VALUES}
      onSubmit={onSubmit}
    />
  );
}

// 評価の行は投稿者本人以外のトップレベルの投稿欄と編集欄だけに描き、評価を含むスキーマで作る。条件は開いた時に決まり、開いている間は変わらない
export function CommentComposer({
  target,
  productId,
  viewerIsOwner,
  onSubmit,
}: CommentComposerProps) {
  const { kind, viewerId } = useEngagementViewer({
    viewer: { isOwner: viewerIsOwner },
  });
  const [ratedViewerId] = useState(() =>
    kind === 'member' && isTopLevel(target) ? viewerId : null,
  );

  return ratedViewerId === null ? (
    <PlainComposer target={target} onSubmit={onSubmit} />
  ) : (
    <RatedComposer
      target={target}
      viewerId={ratedViewerId}
      productId={productId}
      onSubmit={onSubmit}
    />
  );
}
