import { type RefObject, useState } from 'react';

import { LEGAL_DOCUMENT_LABELS } from '../../../common-lib/legal/legal-documents.ts';
import { CHANGE_SUMMARY_MAX } from '../../../common-lib/legal/legal-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { MarkdownLengthCounter } from '../../../lib/components/markdown-editor/markdown-length-counter.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import {
  type AdminLegalDocumentView,
  toGraphQLLegalDocumentKind,
} from '../../graphql/admin-legal-documents.ts';
import type { PublishLegalDocumentInput } from '../../graphql/generated/graphql.ts';
import { AdminFormDialog } from '../admins/admin-form-dialog.tsx';
import { useAdminFormDialogControls } from '../admins/admin-form-dialog-controls.ts';
import { AdminFormDialogFooter } from '../admins/admin-form-dialog-footer.tsx';
import { LegalConflictNotice } from './legal-conflict-notice.tsx';
import {
  type LegalEditorErrorState,
  legalEditorErrorMessageOf,
  toLegalEditorErrorState,
} from './legal-editor-errors.ts';
import { publishFormSchema } from './legal-form-schemas.ts';
import {
  CHANGE_SUMMARY_LABEL,
  CHANGE_SUMMARY_PUBLIC_NOTICE,
  PUBLISH_CONFIRM_LABEL,
  PUBLISH_LEGAL_DOCUMENT_DESCRIPTION,
  publishLegalDocumentTitle,
} from './publish-legal-document-messages.ts';

export interface PublishLegalDocumentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly document: AdminLegalDocumentView;
  // 失敗は例外で知らせ、ダイアログの中に示す。成功すると閉じる
  readonly onPublish: (input: PublishLegalDocumentInput) => Promise<void>;
  // 競合の案内の「最新の内容を読み込む」の押下。読み込み直した本文を確かめずに公開させないため、押すとダイアログを閉じる
  readonly onReload: () => void;
  // 公開に成功すると開いた元の「公開する」が消えるため、成功の時に呼び出す側が閉じた後のフォーカスの移り先を入れる。空なら開いた元の要素へ戻す
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const DEFAULT_VALUES = Object.freeze({ changeSummary: '' });

interface PublishFormProps {
  readonly document: AdminLegalDocumentView;
  readonly onPublish: (input: PublishLegalDocumentInput) => Promise<void>;
  readonly onReload: () => void;
}

// ダイアログを閉じると中身が取り除かれるため、開くたびに入力と失敗の表示を始め直す
function PublishForm({ document, onPublish, onReload }: PublishFormProps) {
  const { pending, run, cancel } = useAdminFormDialogControls();
  const form = useAppForm(publishFormSchema, { defaultValues: DEFAULT_VALUES });
  const [failure, setFailure] = useState<LegalEditorErrorState>();
  const kind = toGraphQLLegalDocumentKind(document.kind);
  const expectedStateVersion = document.stateVersion;

  return (
    <AppForm
      form={form}
      serverFieldPrefix="input"
      onSubmit={({ changeSummary }) =>
        run(async () => {
          setFailure(undefined);
          await onPublish({ kind, expectedStateVersion, changeSummary });
        })
      }
      onSubmitError={(error, context) => {
        setFailure(toLegalEditorErrorState(error, context));
      }}
      className="flex flex-col gap-4"
    >
      {failure === undefined ? null : failure.kind === 'conflict' ? (
        <LegalConflictNotice
          onReload={() => {
            onReload();
            cancel();
          }}
        />
      ) : (
        <FormMessage role="alert">
          {legalEditorErrorMessageOf(failure)}
        </FormMessage>
      )}
      <FormField
        control={form.control}
        name="changeSummary"
        label={CHANGE_SUMMARY_LABEL}
        description={CHANGE_SUMMARY_PUBLIC_NOTICE}
      >
        {(control) => (
          <>
            <Input {...control} autoComplete="off" aria-required="true" />
            <MarkdownLengthCounter
              value={trimWhiteSpace(control.value)}
              max={CHANGE_SUMMARY_MAX}
            />
          </>
        )}
      </FormField>
      <AdminFormDialogFooter
        submitLabel={PUBLISH_CONFIRM_LABEL}
        pending={pending}
        onCancel={cancel}
        audited={false}
      />
    </AppForm>
  );
}

export function PublishLegalDocumentDialog({
  open,
  onOpenChange,
  document,
  onPublish,
  onReload,
  returnFocusRef,
}: PublishLegalDocumentDialogProps) {
  return (
    <AdminFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={publishLegalDocumentTitle(LEGAL_DOCUMENT_LABELS[document.kind])}
      description={PUBLISH_LEGAL_DOCUMENT_DESCRIPTION}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
    >
      <PublishForm
        document={document}
        onPublish={onPublish}
        onReload={onReload}
      />
    </AdminFormDialog>
  );
}
