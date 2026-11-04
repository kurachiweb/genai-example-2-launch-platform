import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../../../common-lib/legal/legal-documents.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LegalConflictNotice } from '../legal/legal-conflict-notice.tsx';
import { OPEN_PUBLIC_PAGE_LABEL } from '../legal/legal-documents-messages.ts';
import { LegalDraftForm } from '../legal/legal-draft-form.tsx';
import { LegalDraftStatus } from '../legal/legal-draft-status.tsx';
import { legalEditorErrorMessageOf } from '../legal/legal-editor-errors.ts';
import { LegalRevisionTable } from '../legal/legal-revision-table.tsx';
import { PublishLegalDocumentDialog } from '../legal/publish-legal-document-dialog.tsx';
import { useClientSiteHref } from '../legal/use-client-site-href.ts';
import {
  type LegalEditorFailure,
  useLegalDocumentEditor,
} from '../legal/use-legal-document-editor.ts';

const routeApi = getRouteApi('/_authenticated/legal-documents/$kind/');

const noticeOf = (
  failure: LegalEditorFailure | undefined,
  onReload: () => void,
) => {
  if (failure === undefined) {
    return null;
  }
  return failure.state.kind === 'conflict' ? (
    <LegalConflictNotice
      key={failure.id}
      onReload={onReload}
      announce={failure.announce}
    />
  ) : (
    <FormMessage key={failure.id} role="alert">
      {legalEditorErrorMessageOf(failure.state)}
    </FormMessage>
  );
};

export function LegalDocumentEditorPage() {
  const { kind } = routeApi.useLoaderData();
  const editor = useLegalDocumentEditor(kind);
  const clientSiteHref = useClientSiteHref();
  const [publishOpen, setPublishOpen] = useState(false);
  const { document } = editor;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={LEGAL_DOCUMENT_LABELS[kind]}
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={clientSiteHref(LEGAL_DOCUMENT_PATHS[kind])}>
              {OPEN_PUBLIC_PAGE_LABEL}
            </a>
          </Button>
        }
      />
      <LegalDraftStatus draft={document.draft} />
      <LegalDraftForm
        document={document}
        onSave={editor.save}
        onSaveError={editor.onSaveError}
        onDiscard={editor.discard}
        onPublishRequest={() => {
          setPublishOpen(true);
        }}
        notice={noticeOf(editor.failure, editor.reload)}
        saveButtonRef={editor.saveButtonRef}
        focusRequest={editor.focusRequest}
      />
      <LegalRevisionTable kind={kind} revisions={document.revisions} />
      <PublishLegalDocumentDialog
        open={publishOpen}
        onOpenChange={(open) => {
          setPublishOpen(open);
          if (!open) {
            editor.onPublishDialogClose();
          }
        }}
        document={document}
        onPublish={editor.publish}
        onReload={editor.reload}
      />
    </div>
  );
}
