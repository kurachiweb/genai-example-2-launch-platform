export type PreviousRelease =
  | { readonly kind: 'found'; readonly commit: string }
  | { readonly kind: 'unknown'; readonly reason: string };

export type DeployedVersion =
  | { readonly kind: 'found'; readonly versionId: string }
  | { readonly kind: 'unknown'; readonly reason: string };

interface VersionTraffic {
  readonly versionId: string;
  readonly percentage: number;
}

const COMMIT_SHA_PATTERN = /^[\da-f]{40}$/;
const VERSION_ID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const FULL_PERCENTAGE = 100;
const TAG_ANNOTATION = 'workers/tag';
const UNREADABLE_STATUS = '版の状態を読み取れません。';

export const isCommitSha = (value: string): boolean =>
  COMMIT_SHA_PATTERN.test(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonRecord = (
  json: string,
): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const trafficOf = (entry: unknown): VersionTraffic | undefined => {
  if (!isRecord(entry)) return undefined;
  const { version_id: versionId, percentage } = entry;
  if (typeof versionId !== 'string' || !VERSION_ID_PATTERN.test(versionId)) {
    return undefined;
  }
  if (typeof percentage !== 'number') return undefined;
  return { versionId, percentage };
};

const trafficListOf = (
  statusJson: string,
): readonly VersionTraffic[] | undefined => {
  const versions = parseJsonRecord(statusJson)?.['versions'];
  if (!Array.isArray(versions) || versions.length === 0) return undefined;
  const traffic = versions.map(trafficOf);
  return traffic.every((entry) => entry !== undefined) ? traffic : undefined;
};

// 版のIDは子プロセスの引数に使うため、識別子の形でない値は読み取れないものとして扱う
export function fullyDeployedVersionOf(statusJson: string): DeployedVersion {
  const traffic = trafficListOf(statusJson);
  if (traffic === undefined) {
    return { kind: 'unknown', reason: UNREADABLE_STATUS };
  }
  const [only] = traffic;
  if (
    traffic.length === 1 &&
    only !== undefined &&
    only.percentage === FULL_PERCENTAGE
  ) {
    return { kind: 'found', versionId: only.versionId };
  }
  const split = traffic
    .map(({ versionId, percentage }) => `${versionId} ${String(percentage)}%`)
    .join('・');
  return {
    kind: 'unknown',
    reason: `分割配信中(${split})のため、配信率100%の版がありません。`,
  };
}

type TagReading =
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' };

const tagOf = (viewJson: string | undefined): TagReading => {
  const view = viewJson === undefined ? undefined : parseJsonRecord(viewJson);
  if (view === undefined) return { kind: 'unreadable' };
  const { annotations } = view;
  if (annotations === undefined) return { kind: 'missing' };
  if (!isRecord(annotations)) return { kind: 'unreadable' };
  const tag = annotations[TAG_ANNOTATION];
  if (tag === undefined || tag === '') return { kind: 'missing' };
  return typeof tag === 'string'
    ? { kind: 'tag', tag }
    : { kind: 'unreadable' };
};

export function previousReleaseFromVersions(
  deploymentsStatusJson: string,
  versionViewJson: (versionId: string) => string | undefined,
): PreviousRelease {
  const deployed = fullyDeployedVersionOf(deploymentsStatusJson);
  if (deployed.kind === 'unknown') return deployed;
  const { versionId } = deployed;
  const reading = tagOf(versionViewJson(versionId));
  switch (reading.kind) {
    case 'unreadable':
      return {
        kind: 'unknown',
        reason: `版${versionId}の版の情報を読み取れません。`,
      };
    case 'missing':
      return { kind: 'unknown', reason: `版${versionId}にタグがありません。` };
    case 'tag':
      return isCommitSha(reading.tag)
        ? { kind: 'found', commit: reading.tag }
        : {
            kind: 'unknown',
            reason: `版${versionId}のタグ(${reading.tag})が40桁の16進のコミットではありません。`,
          };
  }
}
