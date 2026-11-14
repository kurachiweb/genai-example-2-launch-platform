import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ScrollTextIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Control } from 'react-hook-form';

import {
  HELP_ARTICLE_STATUS_LABELS,
  HELP_ARTICLE_STATUSES,
  type HelpArticleStatus,
} from '../../../common-lib/help/help-article-status.ts';
import {
  HELP_ARTICLE_EXTERNAL_LINK_REL,
  HELP_BODY_MAX,
} from '../../../common-lib/help/help-input-rules.ts';
import { ReasonField } from '../../../lib/components/admin/reason-field.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { MarkdownEditor } from '../../../lib/components/markdown-editor/markdown-editor.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { Checkbox } from '../../../lib/components/ui/checkbox/checkbox.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { AUDITED_ACTION_NOTICE } from '../../../lib/utilities/messages/admin-console-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminHelpArticleView,
  refreshHelpArticleQueriesAfterDelete,
  toAdminHelpArticle,
  toGraphQLHelpArticleStatus,
} from '../../graphql/admin-help-articles.ts';
import type { HelpCategoryView } from '../../graphql/admin-help-categories.ts';
import {
  AdminCreateHelpArticleDocument,
  AdminUpdateHelpArticleDocument,
  type HelpArticleFields,
} from '../../graphql/generated/graphql.ts';
import {
  HELP_ARTICLE_FORM_SCHEMA,
  type HelpArticleFormInput,
  type HelpArticleFormOutput,
} from './help-article-form-schema.ts';
import { HelpArticleHandleField } from './help-article-handle-field.tsx';
import {
  HELP_ARTICLE_CREATE_SUBMIT_LABEL,
  HELP_ARTICLE_FORM_CREATE_LABEL,
  HELP_ARTICLE_FORM_EDIT_LABEL,
  HELP_ARTICLE_FORM_LABELS,
  HELP_ARTICLE_SAVE_SUBMIT_LABEL,
  HELP_ARTICLES_LINK_LABEL,
  HELP_BODY_PLACEHOLDER,
  HELP_CATEGORY_MOVE_NOTICE,
  HELP_CATEGORY_PLACEHOLDER,
  HELP_PINNED_CHECKBOX_LABEL,
} from './help-messages.ts';

interface HelpArticleFormBaseProps {
  // 管理者が指定した並び順
  readonly categories: readonly HelpCategoryView[];
  // 閲覧のみの管理者。全欄を無効にし、送信しない
  readonly readOnly: boolean;
  readonly onSaved: (article: AdminHelpArticleView) => void;
}

export type HelpArticleFormProps = HelpArticleFormBaseProps &
  (
    | { readonly mode: 'create' }
    | { readonly mode: 'edit'; readonly article: AdminHelpArticleView }
  );

type FormControl = Control<
  HelpArticleFormInput,
  unknown,
  HelpArticleFormOutput
>;

interface SubmitFailure {
  readonly message: string;
  readonly deleted: boolean;
}

const HELP_ARTICLE_NOT_FOUND_CODE = 'help_article_not_found';

const EMPTY_VALUES: HelpArticleFormInput = Object.freeze({
  fields: Object.freeze({
    title: '',
    subtitle: '',
    handle: '',
    categoryId: '',
    pinned: false,
    status: 'draft',
    body: '',
  }),
  reason: '',
});

const valuesOf = (article: AdminHelpArticleView): HelpArticleFormInput => ({
  fields: {
    title: article.title,
    subtitle: article.subtitle,
    handle: article.handle,
    categoryId: article.categoryId,
    pinned: article.pinned,
    status: article.status,
    body: article.body,
  },
  reason: '',
});

const toFieldsInput = ({
  fields,
}: HelpArticleFormOutput): HelpArticleFields => ({
  ...fields,
  status: toGraphQLHelpArticleStatus(fields.status),
});

const reasonInputOf = ({ reason }: HelpArticleFormOutput) =>
  reason === undefined ? {} : { reason };

interface FieldProps {
  readonly control: FormControl;
  readonly disabled: boolean;
}

function CategoryField({
  control,
  disabled,
  categories,
  description,
}: FieldProps & {
  readonly categories: readonly HelpCategoryView[];
  readonly description: string | undefined;
}) {
  // 一覧を開くとフォーカスが一覧へ移り開いた元の要素からフォーカスが外れるため、開いている間のフォーカスアウトは検証しない
  const openRef = useRef(false);
  return (
    <FormField
      control={control}
      name="fields.categoryId"
      label={HELP_ARTICLE_FORM_LABELS.categoryId}
      description={description}
      disabled={disabled}
    >
      {({
        value,
        onChange,
        onBlur,
        ref,
        name,
        disabled: fieldDisabled,
        ...aria
      }) => (
        <Select
          name={name}
          value={value}
          onValueChange={onChange}
          onOpenChange={(open) => {
            openRef.current = open;
          }}
          disabled={fieldDisabled}
        >
          <SelectTrigger
            ref={ref}
            {...aria}
            aria-required
            className="w-full sm:w-72"
            onBlur={() => {
              if (!openRef.current) {
                onBlur();
              }
            }}
          >
            <SelectValue placeholder={HELP_CATEGORY_PLACEHOLDER} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

function PinnedField({ control, disabled }: FieldProps) {
  return (
    <FormField
      control={control}
      name="fields.pinned"
      label={HELP_ARTICLE_FORM_LABELS.pinned}
      disabled={disabled}
    >
      {({ value, onChange, ...field }) => (
        <div className="flex items-center gap-2">
          <Checkbox
            {...field}
            checked={value}
            onCheckedChange={(checked) => {
              onChange(checked === true);
            }}
          />
          <Label htmlFor={field.id} className="font-normal">
            {HELP_PINNED_CHECKBOX_LABEL}
          </Label>
        </div>
      )}
    </FormField>
  );
}

function StatusField({ control, disabled }: FieldProps) {
  const itemBaseId = useId();
  const itemIdOf = (status: HelpArticleStatus) => `${itemBaseId}-${status}`;
  return (
    <FormField
      control={control}
      name="fields.status"
      label={HELP_ARTICLE_FORM_LABELS.status}
      disabled={disabled}
    >
      {(field) => (
        <RadioGroup
          id={field.id}
          ref={field.ref}
          value={field.value}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          aria-labelledby={field.labelId}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid']}
          className="flex flex-wrap gap-6"
        >
          {HELP_ARTICLE_STATUSES.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <RadioGroupItem id={itemIdOf(status)} value={status} />
              <Label htmlFor={itemIdOf(status)} className="font-normal">
                {HELP_ARTICLE_STATUS_LABELS[status]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
    </FormField>
  );
}

function BodyField({ control, disabled }: FieldProps) {
  const preview = useMarkdownOptions({
    externalLinkRel: HELP_ARTICLE_EXTERNAL_LINK_REL,
    idScope: 'preview',
  });
  return (
    <FormField
      control={control}
      name="fields.body"
      label={HELP_ARTICLE_FORM_LABELS.body}
      disabled={disabled}
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
          maxGraphemes={HELP_BODY_MAX}
          placeholder={HELP_BODY_PLACEHOLDER}
          preview={preview}
        />
      )}
    </FormField>
  );
}

// 作成と編集で共通のフォーム。保存の後のトースト・移動・取り直しは呼び出し側がonSavedで行う
export function HelpArticleForm({
  categories,
  readOnly,
  onSaved,
  ...target
}: HelpArticleFormProps) {
  const article = target.mode === 'edit' ? target.article : undefined;
  const [initialValues] = useState(() =>
    article === undefined ? EMPTY_VALUES : valuesOf(article),
  );
  const form = useAppForm(HELP_ARTICLE_FORM_SCHEMA, {
    defaultValues: initialValues,
  });
  const create = useMutation(
    graphqlMutationOptions(AdminCreateHelpArticleDocument),
  );
  const update = useMutation(
    graphqlMutationOptions(AdminUpdateHelpArticleDocument),
  );
  const [failure, setFailure] = useState<SubmitFailure>();
  const queryClient = useQueryClient();

  const save = async (
    values: HelpArticleFormOutput,
  ): Promise<AdminHelpArticleView> => {
    const fields = toFieldsInput(values);
    const reason = reasonInputOf(values);
    if (article === undefined) {
      const { createHelpArticle } = await create.mutateAsync({
        variables: { input: { fields, ...reason } },
      });
      return toAdminHelpArticle(createHelpArticle);
    }
    // 編集する記事と読み込んだ版は入力欄を持たないため、読み込んだ記事から足す
    const { updateHelpArticle } = await update.mutateAsync({
      variables: {
        input: {
          id: article.id,
          expectedRevision: article.revision,
          fields,
          ...reason,
        },
      },
    });
    return toAdminHelpArticle(updateHelpArticle);
  };

  return (
    <AppForm
      form={form}
      aria-label={
        article === undefined
          ? HELP_ARTICLE_FORM_CREATE_LABEL
          : HELP_ARTICLE_FORM_EDIT_LABEL
      }
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setFailure(undefined);
        onSaved(await save(values));
      }}
      onSubmitError={(error) => {
        const deleted =
          error instanceof GraphQLClientError &&
          error.code === HELP_ARTICLE_NOT_FOUND_CODE;
        setFailure({
          message: errorMessageOf(error, ADMIN_PROFILE.contactAvailable),
          deleted,
        });
        // 一覧への導線の先で削除済みの記事を古いキャッシュのまま示さないため
        if (deleted) {
          void refreshHelpArticleQueriesAfterDelete(queryClient);
        }
      }}
      className="flex flex-col gap-6"
    >
      <FormField
        control={form.control}
        name="fields.title"
        label={HELP_ARTICLE_FORM_LABELS.title}
        disabled={readOnly}
      >
        {(field) => <Input {...field} aria-required />}
      </FormField>
      <FormField
        control={form.control}
        name="fields.subtitle"
        label={HELP_ARTICLE_FORM_LABELS.subtitle}
        disabled={readOnly}
      >
        {(field) => <Input {...field} aria-required />}
      </FormField>
      <HelpArticleHandleField
        disabled={readOnly}
        {...(article === undefined ? {} : { article })}
      />
      <CategoryField
        control={form.control}
        disabled={readOnly}
        categories={categories}
        description={
          article === undefined ? undefined : HELP_CATEGORY_MOVE_NOTICE
        }
      />
      <PinnedField control={form.control} disabled={readOnly} />
      <StatusField control={form.control} disabled={readOnly} />
      <BodyField control={form.control} disabled={readOnly} />
      {readOnly ? null : (
        <>
          <ReasonField control={form.control} name="reason" required={false} />
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <ScrollTextIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{AUDITED_ACTION_NOTICE}</span>
          </p>
          <div className="flex flex-col gap-3">
            {failure === undefined ? null : (
              <FormMessage role="alert">{failure.message}</FormMessage>
            )}
            {failure?.deleted === true ? (
              <Link
                to="/help-articles"
                className={cn(INLINE_LINK_CLASS_NAME, 'self-start text-sm')}
              >
                {HELP_ARTICLES_LINK_LABEL}
              </Link>
            ) : null}
            <SubmitButton className="self-start">
              {article === undefined
                ? HELP_ARTICLE_CREATE_SUBMIT_LABEL
                : HELP_ARTICLE_SAVE_SUBMIT_LABEL}
            </SubmitButton>
          </div>
        </>
      )}
    </AppForm>
  );
}
