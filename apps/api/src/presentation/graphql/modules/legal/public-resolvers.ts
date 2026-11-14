import type { LegalDocumentReader } from '../../../../application/legal/legal-document-reader.ts';
import { LEGAL_TYPES } from '../../../../application/legal/legal-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { LEGAL_DOCUMENT_ARGS, LEGAL_DOCUMENT_VERSION_ARGS } from './inputs.ts';
import { toLegalDocument, toLegalDocumentVersion } from './mappers.ts';

const readerOf = (context: GraphQLContext): LegalDocumentReader =>
  context.resolve<LegalDocumentReader>(LEGAL_TYPES.LegalDocumentReader);

// 公開した版だけを返す照会のため、呼び出し元とログインを問わない
export const publicResolvers = {
  Query: {
    legalDocument: withValidatedArgs(
      LEGAL_DOCUMENT_ARGS,
      async (_parent, { kind }, context) =>
        toLegalDocument(await readerOf(context).getDocument(kind)),
    ),
    legalDocumentVersion: withValidatedArgs(
      LEGAL_DOCUMENT_VERSION_ARGS,
      async (_parent, { kind, versionNumber }, context) => {
        const version = await readerOf(context).getVersion(kind, versionNumber);
        return version === undefined ? null : toLegalDocumentVersion(version);
      },
    ),
  },
} satisfies Resolvers;
