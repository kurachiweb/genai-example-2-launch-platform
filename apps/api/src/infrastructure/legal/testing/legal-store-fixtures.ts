import { env } from 'cloudflare:workers';

import { createDatabase } from '../../../../db/client.ts';
import { legalDocumentVersions } from '../../../../db/schema/legal/legal-document-versions.ts';
import { legalDocuments } from '../../../../db/schema/legal/legal-documents.ts';

const db = createDatabase(env.DB);

const SEEDED_AT = new Date(1_793_750_400_000);

export const SEEDED_DOCUMENTS = [
  { id: '01M6HXNZ000000000000000001', kind: 'terms' },
  { id: '01M6HXNZ000000000000000002', kind: 'privacy' },
  { id: '01M6HXNZ000000000000000003', kind: 'legal-notice' },
] as const;

// 初期データの3行はマイグレーションで常に入るため、各テストの前に版を消して文書の行を初期データの状態に戻す
export async function resetLegalTables(): Promise<void> {
  await db.batch([
    db.delete(legalDocumentVersions),
    db.delete(legalDocuments),
    db.insert(legalDocuments).values(
      SEEDED_DOCUMENTS.map(({ id, kind }) => ({
        id,
        kind,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      })),
    ),
  ]);
}
