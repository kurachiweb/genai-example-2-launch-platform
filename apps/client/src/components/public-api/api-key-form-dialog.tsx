import { type RefObject, useId, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
  lengthOverLimitAnnouncement,
} from '../../../lib/utilities/messages/length-limit-messages.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { API_KEY_NAME_MAX_GRAPHEMES } from '../../../common-lib/public-api/api-key-rules.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type {
  ApiKeyFieldsFragment,
  ClientIssueApiKeyMutationVariables,
  ClientUpdateApiKeyMutationVariables,
} from '../../graphql/generated/graphql.ts';
import {
  toApiKeyScopes,
  toApiKeyScopesInput,
} from '../../graphql/public-api.ts';
import {
  API_KEY_FORM_MESSAGES,
  apiKeyNameCounterOf,
} from './api-key-form-messages.ts';
import {
  apiKeyFormSchema,
  type ApiKeyFormValues,
  issueFormValues,
} from './api-key-form-schema.ts';
import { ApiKeyScopeFields } from './api-key-scope-fields.tsx';

export type EditableApiKey = Pick<
  ApiKeyFieldsFragment,
  'id' | 'name' | 'scopes'
>;

export type ApiKeyFormTarget =
  | { readonly mode: 'issue' }
  | { readonly mode: 'edit'; readonly apiKey: EditableApiKey };

// 発行と編集の操作の引数をそのまま渡す
export type ApiKeyFormRequest =
  | {
      readonly mode: 'issue';
      readonly variables: ClientIssueApiKeyMutationVariables;
    }
  | {
      readonly mode: 'edit';
      readonly variables: ClientUpdateApiKeyMutationVariables;
    };

export interface ApiKeyFormDialogProps {
  // nullの間は閉じている
  readonly target: ApiKeyFormTarget | null;
  readonly onClose: () => void;
  // 閉じた後にフォーカスを戻す、開いた元の操作
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  // 送信の操作。解決すると閉じ、拒否するとダイアログを開いたまま、欄の詳細を欄に、それ以外をフォームの失敗として示す
  readonly onSubmit: (request: ApiKeyFormRequest) => Promise<void>;
}

const TOO_MANY_REQUESTS = 429;

// 名前の文字数は、上限に近づくまで示さない
const NAME_COUNTER_FROM = 40;

const submitErrorMessageOf = (error: unknown): string =>
  error instanceof GraphQLClientError && error.status === TOO_MANY_REQUESTS
    ? API_KEY_FORM_MESSAGES.rateLimited
    : errorMessageOf(error, CLIENT_PROFILE.contactAvailable);

const defaultValuesOf = (target: ApiKeyFormTarget): ApiKeyFormValues =>
  target.mode === 'issue'
    ? issueFormValues()
    : {
        name: target.apiKey.name,
        scopes: toApiKeyScopes(target.apiKey.scopes),
      };

const requestOf = (
  target: ApiKeyFormTarget,
  values: ApiKeyFormValues,
): ApiKeyFormRequest => {
  const input = {
    name: values.name,
    scopes: toApiKeyScopesInput(values.scopes),
  };
  return target.mode === 'issue'
    ? { mode: 'issue', variables: { input } }
    : { mode: 'edit', variables: { id: target.apiKey.id, input } };
};

function ApiKeyNameField() {
  const { control } = useFormContext<ApiKeyFormValues>();
  const counterId = useId();
  const name = useWatch({ control, name: 'name' });
  const length = countGraphemes(trimWhiteSpace(name));
  const showsCounter = length > NAME_COUNTER_FROM;
  const tooLong = length > API_KEY_NAME_MAX_GRAPHEMES;
  const [announcedTooLong, setAnnouncedTooLong] = useState(tooLong);
  const [announcement, setAnnouncement] = useState('');
  // 入力のたびに読み上げないよう、上限を超えた時と上限以内に戻った時だけ読み上げの文言を変える
  if (tooLong !== announcedTooLong) {
    setAnnouncedTooLong(tooLong);
    setAnnouncement(
      tooLong
        ? lengthOverLimitAnnouncement(API_KEY_NAME_MAX_GRAPHEMES)
        : LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
    );
  }

  return (
    <FormField
      control={control}
      name="name"
      label={API_KEY_FORM_MESSAGES.nameLabel}
      description={API_KEY_FORM_MESSAGES.nameDescription}
    >
      {(field) => (
        <>
          <Input
            {...field}
            aria-describedby={
              showsCounter
                ? [counterId, field['aria-describedby']]
                    .filter((id) => id !== undefined)
                    .join(' ')
                : field['aria-describedby']
            }
            aria-required
            autoComplete="off"
          />
          {showsCounter ? (
            <p
              id={counterId}
              className={cn(
                'self-end text-xs tabular-nums',
                tooLong
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              <span className="sr-only">
                {API_KEY_FORM_MESSAGES.nameCounterPrefix}
              </span>
              {apiKeyNameCounterOf(length)}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </>
      )}
    </FormField>
  );
}

interface ApiKeyFormProps {
  readonly target: ApiKeyFormTarget;
  readonly title: string;
  readonly onSubmit: (request: ApiKeyFormRequest) => Promise<void>;
  readonly onSubmitted: () => void;
}

function ApiKeyForm({ target, title, onSubmit, onSubmitted }: ApiKeyFormProps) {
  const [defaultValues] = useState(() => defaultValuesOf(target));
  const form = useAppForm<ApiKeyFormValues, ApiKeyFormValues>(
    apiKeyFormSchema,
    { defaultValues },
  );
  const [submitError, setSubmitError] = useState<string>();

  return (
    <AppForm
      form={form}
      aria-label={title}
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await onSubmit(requestOf(target, values));
        onSubmitted();
      }}
      onSubmitError={(error) => {
        setSubmitError(submitErrorMessageOf(error));
      }}
      className="flex flex-col gap-5"
    >
      <ApiKeyNameField />
      <ApiKeyScopeFields />
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {API_KEY_FORM_MESSAGES.cancel}
          </Button>
        </DialogClose>
        <SubmitButton>
          {target.mode === 'issue'
            ? API_KEY_FORM_MESSAGES.issueSubmit
            : API_KEY_FORM_MESSAGES.editSubmit}
        </SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

// 開いたまま別のキーへ切り替わった時は入力を引き継がず作り直す。同じキーの取り直しでは入力を保つ
const formKeyOf = (target: ApiKeyFormTarget): string =>
  target.mode === 'edit' ? `edit:${target.apiKey.id}` : 'issue';

interface ShownForm {
  readonly target: ApiKeyFormTarget;
  // 開くたびに変え、閉じる途中に開き直してもフォームを作り直す
  readonly session: number;
}

// 閉じると入力を破棄し、開き直すと発行は初期値、編集はその時点のキーの値から始める
export function ApiKeyFormDialog({
  target,
  onClose,
  returnFocusRef,
  onSubmit,
}: ApiKeyFormDialogProps) {
  // 閉じる動きの間も題名と入力を保つよう、最後に開いていた対象で描く
  const [shown, setShown] = useState<ShownForm | null>(() =>
    target === null ? null : { target, session: 0 },
  );
  const [seenTarget, setSeenTarget] = useState(target);
  if (target !== seenTarget) {
    setSeenTarget(target);
    if (target !== null) {
      const reopened =
        seenTarget === null ||
        shown === null ||
        formKeyOf(target) !== formKeyOf(shown.target);
      const session = (shown?.session ?? 0) + (reopened ? 1 : 0);
      setShown({ target, session });
    }
  }
  const title =
    shown?.target.mode === 'edit'
      ? API_KEY_FORM_MESSAGES.editTitle
      : API_KEY_FORM_MESSAGES.issueTitle;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた元の操作へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const element = returnFocusRef.current;
          if (element?.isConnected === true) {
            element.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {shown === null ? null : (
          <ApiKeyForm
            key={shown.session}
            target={shown.target}
            title={title}
            onSubmit={onSubmit}
            onSubmitted={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
