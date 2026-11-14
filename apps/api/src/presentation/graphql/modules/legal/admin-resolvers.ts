import type { LegalDocumentAdminReader } from '../../../../application/legal/legal-document-admin-reader.ts';
import type { LegalDocumentPublisher } from '../../../../application/legal/legal-document-publisher.ts';
import type { LegalDraftEditor } from '../../../../application/legal/legal-draft-editor.ts';
import { LEGAL_TYPES } from '../../../../application/legal/legal-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { adminOnly } from '../admin/resolver-support.ts';
import {
  DISCARD_LEGAL_DOCUMENT_DRAFT_ARGS,
  LEGAL_DOCUMENT_ARGS,
  LEGAL_DOCUMENT_VERSION_ARGS,
  PUBLISH_LEGAL_DOCUMENT_ARGS,
  SAVE_LEGAL_DOCUMENT_DRAFT_ARGS,
} from './inputs.ts';
import {
  toAdminLegalDocument,
  toAdminLegalDocumentSummary,
  toAdminLegalDocumentVersion,
} from './mappers.ts';

const adminReaderOf = (context: GraphQLContext): LegalDocumentAdminReader =>
  context.resolve<LegalDocumentAdminReader>(
    LEGAL_TYPES.LegalDocumentAdminReader,
  );

const draftEditorOf = (context: GraphQLContext): LegalDraftEditor =>
  context.resolve<LegalDraftEditor>(LEGAL_TYPES.LegalDraftEditor);

const publisherOf = (context: GraphQLContext): LegalDocumentPublisher =>
  context.resolve<LegalDocumentPublisher>(LEGAL_TYPES.LegalDocumentPublisher);

// 下書きと公開者は管理者だけに返すため、照会も全ロールの管理者に限る。変更は最上位管理者だけに許す
export const adminResolvers = {
  Query: {
    adminLegalDocuments: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        const summaries = await adminReaderOf(context).listDocuments();
        return summaries.map(toAdminLegalDocumentSummary);
      },
    ),
    adminLegalDocument: adminOnly(
      withValidatedArgs(
        LEGAL_DOCUMENT_ARGS,
        async (_parent: unknown, { kind }, context) => {
          await requireAdmin(context, 'viewer');
          return toAdminLegalDocument(
            await adminReaderOf(context).getDocument(kind),
          );
        },
      ),
    ),
    adminLegalDocumentVersion: adminOnly(
      withValidatedArgs(
        LEGAL_DOCUMENT_VERSION_ARGS,
        async (_parent: unknown, { kind, versionNumber }, context) => {
          await requireAdmin(context, 'viewer');
          const version = await adminReaderOf(context).getVersion(
            kind,
            versionNumber,
          );
          return version === undefined
            ? null
            : toAdminLegalDocumentVersion(version);
        },
      ),
    ),
  },
  Mutation: {
    saveLegalDocumentDraft: adminOnly(
      withValidatedArgs(
        SAVE_LEGAL_DOCUMENT_DRAFT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          return toAdminLegalDocument(
            await draftEditorOf(context).save({
              adminId: current.id,
              ...input,
            }),
          );
        },
      ),
    ),
    discardLegalDocumentDraft: adminOnly(
      withValidatedArgs(
        DISCARD_LEGAL_DOCUMENT_DRAFT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          return toAdminLegalDocument(
            await draftEditorOf(context).discard({
              adminId: current.id,
              ...input,
            }),
          );
        },
      ),
    ),
    publishLegalDocument: adminOnly(
      withValidatedArgs(
        PUBLISH_LEGAL_DOCUMENT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          return toAdminLegalDocument(
            await publisherOf(context).publish({
              adminId: current.id,
              ...input,
            }),
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
