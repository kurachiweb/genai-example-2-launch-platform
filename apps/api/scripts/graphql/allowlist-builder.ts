import {
  CALLER_KINDS,
  type CallerKind,
} from '../../src/presentation/gateway/gateway-headers.ts';
import type { GatewayErrorCode } from '../../src/presentation/graphql/error-codes.ts';
import type {
  AllowlistData,
  DocumentId,
} from '../../src/presentation/graphql/operation-allowlist.ts';
import type { DocumentValidator } from './document-validator.ts';

export type PersistedDocuments = Readonly<Record<string, string>>;

export type PersistedDocumentsByCaller = Readonly<
  Record<CallerKind, PersistedDocuments>
>;

export interface AllowlistBuildInput {
  readonly current: PersistedDocumentsByCaller;
  readonly previous: PersistedDocumentsByCaller | undefined;
  readonly validate: DocumentValidator;
}

export type AllowlistBuildError =
  | {
      readonly kind: 'invalid_id';
      readonly caller: CallerKind;
      readonly documentId: string;
    }
  | {
      readonly kind: 'hash_mismatch';
      readonly caller: CallerKind;
      readonly documentId: string;
    }
  | {
      readonly kind: 'conflicting_document';
      readonly caller: CallerKind;
      readonly documentId: string;
    }
  | {
      readonly kind: 'current_invalid';
      readonly caller: CallerKind;
      readonly documentId: string;
      readonly reasons: readonly GatewayErrorCode[];
    };

export interface ExcludedOperation {
  readonly caller: CallerKind;
  readonly documentId: string;
  readonly reasons: readonly GatewayErrorCode[];
}

export type AllowlistBuildResult =
  | {
      readonly ok: true;
      readonly allowlist: AllowlistData;
      readonly excluded: readonly ExcludedOperation[];
    }
  | { readonly ok: false; readonly errors: readonly AllowlistBuildError[] };

type CallerOperations = Readonly<Record<DocumentId, string>>;

interface CallerOutcome {
  readonly errors: readonly AllowlistBuildError[];
  readonly excluded: readonly ExcludedOperation[];
  readonly operations: CallerOperations;
}

type DocumentEntry = readonly [documentId: string, document: string];

const DOCUMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

const ALLOWLIST_VERSION = 1;

function isDocumentId(value: string): value is DocumentId {
  return DOCUMENT_ID_PATTERN.test(value);
}

function compareEntries([left]: DocumentEntry, [right]: DocumentEntry): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function sortedEntries(
  documents: Readonly<Record<string, string>>,
): readonly DocumentEntry[] {
  return Object.entries(documents).toSorted(compareEntries);
}

async function sha256DocumentId(document: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(document),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `sha256:${hex}`;
}

async function identifierError(
  caller: CallerKind,
  [documentId, document]: DocumentEntry,
): Promise<AllowlistBuildError | undefined> {
  if (!isDocumentId(documentId)) {
    return { kind: 'invalid_id', caller, documentId };
  }
  return documentId === (await sha256DocumentId(document))
    ? undefined
    : { kind: 'hash_mismatch', caller, documentId };
}

async function identifierErrors(
  caller: CallerKind,
  documents: PersistedDocuments,
): Promise<readonly AllowlistBuildError[]> {
  const errors = await Promise.all(
    sortedEntries(documents).map((entry) => identifierError(caller, entry)),
  );
  return errors.filter((error) => error !== undefined);
}

function conflictErrors(
  caller: CallerKind,
  current: PersistedDocuments,
  previous: PersistedDocuments,
): readonly AllowlistBuildError[] {
  return sortedEntries(previous)
    .filter(
      ([documentId, document]) =>
        Object.hasOwn(current, documentId) && current[documentId] !== document,
    )
    .map(([documentId]) => ({
      kind: 'conflicting_document',
      caller,
      documentId,
    }));
}

function currentInvalidErrors(
  caller: CallerKind,
  current: PersistedDocuments,
  validate: DocumentValidator,
): readonly AllowlistBuildError[] {
  return sortedEntries(current).flatMap(([documentId, document]) => {
    const reasons = validate(document);
    return reasons.length === 0
      ? []
      : [{ kind: 'current_invalid' as const, caller, documentId, reasons }];
  });
}

function toOperations(entries: readonly DocumentEntry[]): CallerOperations {
  return Object.fromEntries(
    entries
      .filter(([documentId]) => isDocumentId(documentId))
      .toSorted(compareEntries),
  );
}

async function buildCallerAllowlist(
  caller: CallerKind,
  { current, previous, validate }: AllowlistBuildInput,
): Promise<CallerOutcome> {
  const currentDocuments = current[caller];
  const previousDocuments = previous?.[caller] ?? {};
  const errors = [
    ...(await identifierErrors(caller, currentDocuments)),
    ...(await identifierErrors(caller, previousDocuments)),
    ...conflictErrors(caller, currentDocuments, previousDocuments),
    ...currentInvalidErrors(caller, currentDocuments, validate),
  ];
  const previousOnly = sortedEntries(previousDocuments)
    .filter(([documentId]) => !Object.hasOwn(currentDocuments, documentId))
    .map(([documentId, document]) => ({
      entry: [documentId, document] as const,
      reasons: validate(document),
    }));
  const accepted = previousOnly
    .filter(({ reasons }) => reasons.length === 0)
    .map(({ entry }) => entry);
  const excluded = previousOnly
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ entry: [documentId], reasons }) => ({
      caller,
      documentId,
      reasons,
    }));
  return {
    errors,
    excluded,
    operations: toOperations([...sortedEntries(currentDocuments), ...accepted]),
  };
}

export async function buildAllowlist(
  input: AllowlistBuildInput,
): Promise<AllowlistBuildResult> {
  const outcomes = {
    client: await buildCallerAllowlist('client', input),
    admin: await buildCallerAllowlist('admin', input),
  } satisfies Record<CallerKind, CallerOutcome>;
  const ordered = CALLER_KINDS.map((caller) => outcomes[caller]);
  const errors = ordered.flatMap((outcome) => outcome.errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    allowlist: {
      version: ALLOWLIST_VERSION,
      operations: {
        client: outcomes.client.operations,
        admin: outcomes.admin.operations,
      },
    },
    excluded: ordered.flatMap((outcome) => outcome.excluded),
  };
}

// 生成し直した時の差分を内容の変化だけにするため、呼び出し元と識別子を辞書順に並べる
export function serializeAllowlist(allowlist: AllowlistData): string {
  const operations = Object.fromEntries(
    CALLER_KINDS.toSorted().map((caller) => [
      caller,
      Object.fromEntries(sortedEntries(allowlist.operations[caller])),
    ]),
  );
  return `${JSON.stringify({ version: allowlist.version, operations }, null, 2)}\n`;
}
