import { type ReactNode, useId, useRef, useState } from 'react';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  LEGAL_DOCUMENT_LABELS,
} from '../../../common-lib/legal/legal-documents.ts';
import { LEGAL_BODY_MAX } from '../../../common-lib/legal/legal-input-rules.ts';
import { ConfirmActionDialog } from '../../../lib/components/admin/confirm-action-dialog.tsx';
import {
  AppForm,
  type SubmitErrorContext,
} from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { MarkdownEditor } from '../../../lib/components/markdown-editor/markdown-editor.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminLegalDocumentView,
  toGraphQLLegalDocumentKind,
} from '../../graphql/admin-legal-documents.ts';
import type {
  DiscardLegalDocumentDraftInput,
  SaveLegalDocumentDraftInput,
} from '../../graphql/generated/graphql.ts';
import { RoleGate } from '../layout/role-gate.tsx';
import { useAdminRole } from '../layout/use-current-admin.ts';
import {
  DISCARD_DRAFT_CONFIRM_LABEL,
  DISCARD_DRAFT_DESCRIPTION,
  DISCARD_DRAFT_LABEL,
  discardDraftTitle,
  LEAVE_PAGE_CONFIRM_LABEL,
  LEAVE_PAGE_TITLE,
  LEGAL_BODY_LABEL,
  LEGAL_BODY_PLACEHOLDER,
  PUBLISH_LABEL,
  SAVE_BEFORE_PUBLISH_MESSAGE,
  SAVE_DRAFT_LABEL,
  SAVE_DRAFT_PENDING_LABEL,
  UNSAVED_CHANGES_MESSAGE,
} from './legal-draft-form-messages.ts';
import { legalDraftFormSchema } from './legal-form-schemas.ts';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard.ts';

export interface LegalDraftFormProps {
  readonly document: AdminLegalDocumentView;
  // 失敗は例外で知らせる。欄に対応しない失敗はonSaveErrorへ渡る
  readonly onSave: (input: SaveLegalDocumentDraftInput) => Promise<void>;
  readonly onSaveError: (error: unknown, context: SubmitErrorContext) => void;
  // 失敗は例外で知らせ、確認のダイアログの中に文言を示す
  readonly onDiscard: (input: DiscardLegalDocumentDraftInput) => Promise<void>;
  readonly onPublishRequest: () => void;
  // 競合の案内や保存の失敗など、入力欄の前に示す内容
  readonly notice?: ReactNode;
}

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const initialBodyOf = ({ draft, latestBody }: AdminLegalDocumentView): string =>
  draft?.body ?? latestBody ?? '';

export function LegalDraftForm({
  document,
  onSave,
  onSaveError,
  onDiscard,
  onPublishRequest,
  notice,
}: LegalDraftFormProps) {
  const form = useAppForm(legalDraftFormSchema, {
    defaultValues: { body: initialBodyOf(document) },
  });
  const preview = useMarkdownOptions({
    externalLinkRel: LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
    idScope: 'preview',
  });
  const readOnly = !hasRole(useAdminRole(), 'super_admin');
  const dirty = form.formState.isDirty;
  const guard = useUnsavedChangesGuard(dirty);
  const [discardOpen, setDiscardOpen] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  // 破棄に成功すると開いた元のボタンが消えるため、閉じた後は保存のボタンへフォーカスを移す
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const publishHintId = useId();
  const kind = toGraphQLLegalDocumentKind(document.kind);
  const expectedStateVersion = document.stateVersion;
  const documentLabel = LEGAL_DOCUMENT_LABELS[document.kind];
  const hasDraft = document.draft !== null;

  return (
    <>
      <AppForm
        form={form}
        aria-label={LEGAL_BODY_LABEL}
        serverFieldPrefix="input"
        onSubmit={async ({ body }) => {
          await onSave({ kind, expectedStateVersion, body });
        }}
        onSubmitError={onSaveError}
        className="flex flex-col gap-4"
      >
        {notice}
        <FormField
          control={form.control}
          name="body"
          label={LEGAL_BODY_LABEL}
          disabled={readOnly}
        >
          {(control) => (
            <MarkdownEditor
              value={control.value}
              onValueChange={control.onChange}
              onBlur={control.onBlur}
              ref={control.ref}
              labelId={control.labelId}
              describedById={control['aria-describedby']}
              invalid={control['aria-invalid'] === true}
              disabled={control.disabled === true}
              maxGraphemes={LEGAL_BODY_MAX}
              placeholder={LEGAL_BODY_PLACEHOLDER}
              preview={preview}
            />
          )}
        </FormField>
        <RoleGate minimum="super_admin">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton
                ref={saveButtonRef}
                pendingLabel={SAVE_DRAFT_PENDING_LABEL}
              >
                {SAVE_DRAFT_LABEL}
              </SubmitButton>
              {hasDraft ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      discardReturnFocusRef.current = null;
                      setDiscardOpen(true);
                    }}
                  >
                    {DISCARD_DRAFT_LABEL}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={dirty}
                    aria-describedby={dirty ? publishHintId : undefined}
                    onClick={onPublishRequest}
                  >
                    {PUBLISH_LABEL}
                  </Button>
                </>
              ) : null}
            </div>
            {/* 入力欄の値はフォーカスを外した時に確定することがあり、その押下の途中で案内が現れて下の要素がずれると押下が外れるため、案内の行を先に確保する */}
            {hasDraft ? (
              <p
                id={publishHintId}
                className="min-h-5 text-sm text-muted-foreground"
              >
                {dirty ? SAVE_BEFORE_PUBLISH_MESSAGE : null}
              </p>
            ) : null}
          </div>
        </RoleGate>
      </AppForm>
      {/* 確認のダイアログはフォームを持ち、ポータルの中でも送信のイベントが入力欄のフォームへ伝わるため、入力欄のフォームの外に置く */}
      <ConfirmActionDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={discardDraftTitle(documentLabel)}
        description={DISCARD_DRAFT_DESCRIPTION}
        confirmLabel={DISCARD_DRAFT_CONFIRM_LABEL}
        reason="none"
        audited={false}
        onConfirm={async () => {
          await onDiscard({ kind, expectedStateVersion });
          discardReturnFocusRef.current = saveButtonRef.current;
        }}
        failureMessageOf={failureMessageOf}
        returnFocusRef={discardReturnFocusRef}
      />
      <ConfirmActionDialog
        open={guard.confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            guard.stay();
          }
        }}
        title={LEAVE_PAGE_TITLE}
        description={UNSAVED_CHANGES_MESSAGE}
        confirmLabel={LEAVE_PAGE_CONFIRM_LABEL}
        reason="none"
        audited={false}
        onConfirm={() => {
          guard.proceed();
          return Promise.resolve();
        }}
        failureMessageOf={failureMessageOf}
      />
    </>
  );
}
