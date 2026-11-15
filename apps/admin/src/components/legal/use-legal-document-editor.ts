import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { type RefObject, useRef, useState } from 'react';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import type { SubmitErrorContext } from '../../../lib/components/form/app-form.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminLegalDocumentFields,
  adminLegalDocumentQueryOptions,
  type AdminLegalDocumentView,
  toAdminLegalDocument,
} from '../../graphql/admin-legal-documents.ts';
import {
  AdminDiscardLegalDocumentDraftDocument,
  type AdminLegalDocumentQuery,
  AdminLegalDocumentsDocument,
  AdminLegalDocumentVersionDocument,
  AdminPublishLegalDocumentDocument,
  AdminSaveLegalDocumentDraftDocument,
  type DiscardLegalDocumentDraftInput,
  type PublishLegalDocumentInput,
  type SaveLegalDocumentDraftInput,
} from '../../graphql/generated/graphql.ts';
import {
  type LegalEditorErrorState,
  toLegalEditorErrorState,
} from './legal-editor-errors.ts';
import type { LegalFormFocusRequest } from './use-focus-after-change.ts';
import {
  DRAFT_DISCARDED_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  LEGAL_DOCUMENT_PUBLISHED_MESSAGE,
} from './legal-editor-messages.ts';

export interface LegalEditorFailure {
  readonly state: LegalEditorErrorState;
  // 同じ失敗が続いても案内を描き直して読み上げさせるための、失敗ごとに変わる値
  readonly id: number;
  // 確認のダイアログの中で既に読み上げた失敗は偽
  readonly announce: boolean;
}

export interface LegalDocumentEditor {
  readonly document: AdminLegalDocumentView;
  readonly failure: LegalEditorFailure | undefined;
  readonly saveButtonRef: RefObject<HTMLButtonElement | null>;
  // LegalDraftFormのfocusRequestへ渡す。公開・読み込み直しの後に作る
  readonly focusRequest: LegalFormFocusRequest | undefined;
  readonly save: (input: SaveLegalDocumentDraftInput) => Promise<void>;
  readonly onSaveError: (error: unknown, context: SubmitErrorContext) => void;
  readonly discard: (input: DiscardLegalDocumentDraftInput) => Promise<void>;
  readonly publish: (input: PublishLegalDocumentInput) => Promise<void>;
  readonly onPublishDialogClose: () => void;
  readonly reload: () => void;
}

const selectDocument = ({
  adminLegalDocument,
}: AdminLegalDocumentQuery): AdminLegalDocumentView =>
  toAdminLegalDocument(adminLegalDocument);

// 編集の画面の取得・変更と、変更の結果の反映・失敗の表示の状態
export function useLegalDocumentEditor(
  kind: LegalDocumentKind,
): LegalDocumentEditor {
  const queryClient = useQueryClient();
  const options = adminLegalDocumentQueryOptions(kind);
  const { data: document } = useSuspenseQuery({
    ...options,
    select: selectDocument,
  });
  const saveDraft = useMutation(
    graphqlMutationOptions(AdminSaveLegalDocumentDraftDocument),
  );
  const discardDraft = useMutation(
    graphqlMutationOptions(AdminDiscardLegalDocumentDraftDocument),
  );
  const publishDocument = useMutation(
    graphqlMutationOptions(AdminPublishLegalDocumentDocument),
  );
  const [failure, setFailure] = useState<LegalEditorFailure>();
  const failureSequenceRef = useRef(0);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<LegalFormFocusRequest>();
  // 公開に成功した時の、操作の前の状態の版
  const publishedFromRef = useRef<number | undefined>(undefined);

  const showFailure = (
    state: LegalEditorErrorState,
    announce: boolean,
  ): void => {
    failureSequenceRef.current += 1;
    setFailure({ state, id: failureSequenceRef.current, announce });
  };

  // 破棄と公開の失敗の文言はダイアログの中に出るため、ダイアログを閉じた後も再読み込みの導線が要る競合だけをページにも示す。ダイアログの間も外側の通知の領域を持つ部分は読み上げから隠れないため、ページの案内は読み上げない
  const showConflict = (error: unknown): void => {
    const state = toLegalEditorErrorState(error);
    if (state.kind === 'conflict') {
      showFailure(state, false);
    }
  };

  // 応答は変更の後の文書の全体のため、取得し直さずに照会の結果を置き換える。一覧と、公開で最新かどうかが変わる版の表示は次に開いた時に取得し直させる
  const apply = (
    fields: AdminLegalDocumentFields,
    { published }: { readonly published: boolean },
  ): void => {
    queryClient.setQueryData<AdminLegalDocumentQuery>(options.queryKey, {
      adminLegalDocument: fields,
    });
    void queryClient.invalidateQueries({
      queryKey: [documentIdOf(AdminLegalDocumentsDocument)],
    });
    if (published) {
      void queryClient.invalidateQueries({
        queryKey: [documentIdOf(AdminLegalDocumentVersionDocument)],
      });
    }
  };

  return {
    document,
    failure,
    saveButtonRef,
    focusRequest,
    save: async (input) => {
      setFailure(undefined);
      const { saveLegalDocumentDraft } = await saveDraft.mutateAsync({
        variables: { input },
      });
      apply(saveLegalDocumentDraft, { published: false });
      notify.success(DRAFT_SAVED_MESSAGE);
    },
    onSaveError: (error, context) => {
      showFailure(toLegalEditorErrorState(error, context), true);
    },
    discard: async (input) => {
      setFailure(undefined);
      try {
        const { discardLegalDocumentDraft } = await discardDraft.mutateAsync({
          variables: { input },
        });
        apply(discardLegalDocumentDraft, { published: false });
        notify.success(DRAFT_DISCARDED_MESSAGE);
      } catch (error) {
        showConflict(error);
        throw error;
      }
    },
    publish: async (input) => {
      setFailure(undefined);
      try {
        const { publishLegalDocument } = await publishDocument.mutateAsync({
          variables: { input },
        });
        // 公開すると下書きが無くなり、ダイアログを開いた「公開する」が消えるため、閉じた後にフォーカスを移す
        publishedFromRef.current = input.expectedStateVersion;
        apply(publishLegalDocument, { published: true });
        notify.success(LEGAL_DOCUMENT_PUBLISHED_MESSAGE);
      } catch (error) {
        showConflict(error);
        throw error;
      }
    },
    // 閉じる前に移すとダイアログがフォーカスを中へ戻すため、閉じてから移す
    onPublishDialogClose: () => {
      const fromStateVersion = publishedFromRef.current;
      if (fromStateVersion !== undefined) {
        publishedFromRef.current = undefined;
        setFocusRequest({ fromStateVersion });
      }
    },
    // 押したボタンは案内とともに消えるため、押せるなら先に保存のボタンへフォーカスを移し、読み込んだ後に最新の内容に合う場所へ移し直す。失敗しても案内を残し、もう一度押せるようにする。取得の間に重ねて押しても、TanStack Queryが進行中の取得にまとめる
    reload: () => {
      const fromStateVersion = document.stateVersion;
      saveButtonRef.current?.focus();
      queryClient.query({ ...options, staleTime: 0 }).then(
        () => {
          setFailure(undefined);
          setFocusRequest({ fromStateVersion });
        },
        (error: unknown) => {
          notify.error(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
        },
      );
    },
  };
}
