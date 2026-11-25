import { useId, useState } from 'react';
import { useWatch } from 'react-hook-form';

import {
  isInfringementCategory,
  REPORT_REASON_MAX,
  type ReportTargetKind,
  type ReporterKind,
  requiresContactEmail,
} from '../../../common-lib/reporting/report-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { MarkdownLengthCounter } from '../../../lib/components/markdown-editor/markdown-length-counter.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { Textarea } from '../../../lib/components/ui/textarea/textarea.tsx';
import type { ClientViewer } from '../../graphql/viewer.ts';
import type { ReportCategoryOption } from '../../graphql/reporting.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { REPORT_BOT_ACTION } from './bot-actions.ts';
import {
  REPORT_FORM_SCHEMA,
  REPORT_FORM_WITH_CONTACT_SCHEMA,
  type ReportFormInput,
  type ReportFormOutput,
} from './report-form-schema.ts';
import { REPORT_MESSAGES } from './report-messages.ts';
import {
  reportSubmitErrorMessageOf,
  useSubmitReport,
} from './use-submit-report.ts';

export interface ReportFormProps {
  readonly targetKind: ReportTargetKind;
  readonly targetRef: string;
  readonly categories: readonly ReportCategoryOption[];
  // フォームの名前(ダイアログの題)
  readonly label: string;
  // 受け付けられた後に呼ぶ(ダイアログを閉じる)
  readonly onSubmitted: () => void;
}

const DEFAULT_VALUES: ReportFormInput = Object.freeze({
  categoryId: '',
  reason: '',
  contactEmail: '',
});

// APIサーバーと同じく、停止中の利用者は通報者として記録しないため未ログインと同じ扱いにする
const reporterKindOf = (viewer: ClientViewer | null): ReporterKind =>
  viewer?.status === 'ACTIVE' ? 'member' : 'guest';

function ReasonCounter({ className }: { readonly className?: string }) {
  const reason = useWatch<ReportFormInput, 'reason'>({ name: 'reason' });
  return (
    <MarkdownLengthCounter
      value={trimWhiteSpace(reason)}
      max={REPORT_REASON_MAX}
      className={className}
    />
  );
}

export function ReportForm({
  targetKind,
  targetRef,
  categories,
  label,
  onSubmitted,
}: ReportFormProps) {
  const reporterKind = reporterKindOf(useViewer());
  // スキーマの選択に使うため、カテゴリの欄の変更とともに状態にも持つ
  const [categoryId, setCategoryId] = useState(DEFAULT_VALUES.categoryId);
  const requiresContact = requiresContactEmail({ reporterKind, categoryId });
  const infringement = isInfringementCategory(categoryId);
  const form = useAppForm<ReportFormInput, ReportFormOutput>(
    requiresContact ? REPORT_FORM_WITH_CONTACT_SCHEMA : REPORT_FORM_SCHEMA,
    { defaultValues: DEFAULT_VALUES },
  );
  const { turnstile, submit } = useSubmitReport();
  const [submitError, setSubmitError] = useState<string>();
  const itemBaseId = useId();

  return (
    <AppForm
      form={form}
      aria-label={label}
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await submit({ ...values, targetKind, targetRef });
        onSubmitted();
      }}
      onSubmitError={(error) => {
        setSubmitError(reportSubmitErrorMessageOf(error));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="categoryId"
        label={REPORT_MESSAGES.categoryLabel}
      >
        {(field) => (
          <RadioGroup
            id={field.id}
            ref={field.ref}
            value={field.value}
            onValueChange={(value) => {
              field.onChange(value);
              setCategoryId(value);
            }}
            onBlur={field.onBlur}
            disabled={field.disabled}
            aria-labelledby={field.labelId}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            aria-required
            className="flex flex-col gap-2.5"
          >
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-2">
                <RadioGroupItem
                  id={`${itemBaseId}-${category.id}`}
                  value={category.id}
                />
                <Label
                  htmlFor={`${itemBaseId}-${category.id}`}
                  className="font-normal"
                >
                  {category.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </FormField>
      <FormField
        control={form.control}
        name="reason"
        label={REPORT_MESSAGES.reasonLabel}
        {...(infringement
          ? { description: REPORT_MESSAGES.infringementReasonGuide }
          : {})}
      >
        {(field) => (
          <>
            <Textarea {...field} rows={6} className="min-h-32" aria-required />
            <ReasonCounter className="self-end" />
          </>
        )}
      </FormField>
      {requiresContact ? (
        <FormField
          control={form.control}
          name="contactEmail"
          label={REPORT_MESSAGES.contactEmailLabel}
          description={REPORT_MESSAGES.contactEmailDescription}
        >
          {(field) => (
            <Input {...field} type="email" autoComplete="email" aria-required />
          )}
        </FormField>
      ) : null}
      <TurnstileWidget {...turnstile.widgetProps} action={REPORT_BOT_ACTION} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {REPORT_MESSAGES.cancel}
          </Button>
        </DialogClose>
        <SubmitButton>{REPORT_MESSAGES.submit}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}
