import { EXPORT_SCHEMA_VERSION, README_TEXT } from '../archive-names.ts';
import type { ArchivePlan } from '../export-plan.ts';
import type { ExportSnapshot } from '../export-snapshot.ts';
import {
  buildAccountDocument,
  buildProfileDocument,
} from './account-documents.ts';
import {
  buildCommentsDocument,
  buildFollowsDocument,
  buildRatingsDocument,
  buildReportsDocument,
  buildUpvotesDocument,
} from './activity-documents.ts';
import {
  buildInquiriesDocument,
  buildPaymentsDocument,
  buildSponsorshipsDocument,
} from './exchange-documents.ts';
import { toIsoUtc } from './export-formats.ts';
import type { DocumentInput } from './file-reference.ts';
import {
  buildLaunchesDocument,
  buildProductsDocument,
} from './product-documents.ts';

export interface ExportTextFile {
  readonly path: string;
  readonly text: string;
}

export interface ExportDocuments {
  readonly files: readonly ExportTextFile[];
}

export const MANIFEST_PATH = 'manifest.json';
export const README_PATH = 'README.txt';
export const SERVICE_NAME = 'Launch Stadium';

const JSON_INDENT = 2;

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

interface JsonDocument {
  readonly kind: string;
  readonly content: unknown;
}

// manifestの`files`と出力の順を兼ねる。文書の12のJSONの順と一致させること
function buildJsonDocuments(input: DocumentInput): readonly JsonDocument[] {
  const { snapshot } = input;
  return [
    { kind: 'account', content: buildAccountDocument(input) },
    { kind: 'profile', content: buildProfileDocument(input) },
    { kind: 'products', content: buildProductsDocument(input) },
    { kind: 'launches', content: buildLaunchesDocument(input) },
    { kind: 'comments', content: buildCommentsDocument(snapshot.comments) },
    { kind: 'upvotes', content: buildUpvotesDocument(snapshot.upvotes) },
    { kind: 'ratings', content: buildRatingsDocument(snapshot.ratings) },
    { kind: 'follows', content: buildFollowsDocument(snapshot.follows) },
    { kind: 'reports', content: buildReportsDocument(snapshot.reports) },
    { kind: 'inquiries', content: buildInquiriesDocument(input) },
    {
      kind: 'sponsorships',
      content: buildSponsorshipsDocument(snapshot.sponsorships),
    },
    { kind: 'payments', content: buildPaymentsDocument(snapshot.payments) },
  ];
}

function countOf(content: unknown): number {
  return Array.isArray(content) ? content.length : 1;
}

function buildManifest(
  snapshot: ExportSnapshot,
  documents: readonly JsonDocument[],
) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    service: SERVICE_NAME,
    requestedAt: toIsoUtc(snapshot.requestedAt),
    user: { handle: snapshot.profile.handle },
    files: documents.map(({ kind, content }) => ({
      path: `${kind}.json`,
      kind,
      count: countOf(content),
    })),
  };
}

// 書き出しの順に返す。JSON・マークダウン本文・manifest・READMEは画像と添付の後に書くため
export function buildExportDocuments(input: {
  readonly snapshot: ExportSnapshot;
  readonly plan: ArchivePlan;
  readonly stored: ReadonlySet<string>;
}): ExportDocuments {
  const documents = buildJsonDocuments(input);
  return {
    files: [
      ...documents.map(({ kind, content }) => ({
        path: `${kind}.json`,
        text: serializeJson(content),
      })),
      ...input.plan.markdown.map(({ path, text }) => ({ path, text })),
      {
        path: MANIFEST_PATH,
        text: serializeJson(buildManifest(input.snapshot, documents)),
      },
      { path: README_PATH, text: README_TEXT },
    ],
  };
}
