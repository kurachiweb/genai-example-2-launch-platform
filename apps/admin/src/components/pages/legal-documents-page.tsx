import { useQuery } from '@tanstack/react-query';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminLegalDocumentsQueryOptions,
  toLegalDocumentSummaries,
} from '../../graphql/admin-legal-documents.ts';
import { LegalDocumentList } from '../legal/legal-document-list.tsx';
import { LEGAL_DOCUMENTS_TITLE } from '../legal/legal-documents-messages.ts';

export function LegalDocumentsPage() {
  const documents = useQuery({
    ...adminLegalDocumentsQueryOptions(),
    select: toLegalDocumentSummaries,
  });
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の失敗はメッセージだけの例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = documents.isFetching ? null : documents.error;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={LEGAL_DOCUMENTS_TITLE} />
      <LegalDocumentList
        documents={documents.data}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void documents.refetch();
                },
              },
            })}
      />
    </div>
  );
}
