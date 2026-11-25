import { mediaFileQuarantineReasons } from '../../../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../../../db/schema/media/media-files.ts';
import { baseInstantOf, userAt, type EntityContext } from '../../entities.ts';
import { deterministicUlid } from '../../random.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { DAY_MS, HOUR_MS } from './scale.ts';

// 合成のデータのうちファイルの記録以外(データエクスポートのアーカイブ)が持つオブジェクトキーの接頭辞
export const MEDIA_KEY_PREFIX = 'synthetic-readiness/';

// 画像のキャッシュの破棄のメッセージは32桁の16進数のキーしか受け付けず、合成のキーが合わないと物理削除が全件失敗するため、ファイルの記録のキーは接頭辞16桁・種別4桁・通し番号12桁の16進数にする。接頭辞は実体の無い合成のデータだけが持つ
export const MEDIA_FILE_KEY_PREFIX = '5ee0d00d5ee0d00d';

const KEY_KIND_TAGS = {
  user: '0001',
  orphan: '0002',
  '810': '0810',
  '820': '0820',
  '830': '0830',
} as const;

type KeyKind = keyof typeof KEY_KIND_TAGS;

const SERIAL_HEX_DIGITS = 12;

export const mediaFileKeyLike = (kind: KeyKind): string =>
  `${MEDIA_FILE_KEY_PREFIX}${KEY_KIND_TAGS[kind]}%`;

const mediaFileKeyOf = (kind: KeyKind, serial: number): string =>
  `${MEDIA_FILE_KEY_PREFIX}${KEY_KIND_TAGS[kind]}${serial
    .toString(16)
    .padStart(SERIAL_HEX_DIGITS, '0')}`;

export const DEDICATED_ROWS_PER_JOB = 3;

export const USER_AVATAR_PURPOSE = 'user-avatar';

// 物理削除の波及処理が取り残すファイルの数。1回の実行の上限(1,000件)を超える件数にする
export const ORPHAN_FILE_COUNT = 1_200;

// 専用の行の保有者は、利用者の番号0(作り手)・1(対戦相手)を避けた先頭の利用者から割り当てる
const DEDICATED_FIRST_OWNER_INDEX = 2;

// 保有者の居ない記録の保有者のIDの時刻。どの合成の利用者(基準日より前に作られる)のIDよりも後に並べる
const ORPHAN_OWNER_AFTER_BASE_DAYS = 365;

const UNIX_MS_PER_SECOND = 1_000;

type Job = '810' | '820' | '830';

interface FileShape {
  readonly key: string;
  readonly kind: KeyKind;
  readonly serial: number;
  readonly ownerId: string;
  readonly createdAt: Date;
  readonly overrides?: SqlRow;
}

const numberOf = (index: number): string => String(index + 1).padStart(6, '0');

// 紐付け済み・保存の完了・判定が合格・保存先と場所が整合・隔離の理由と削除の要求が無い、4:21のどのジョブにも当たらない行
function baseRow(entities: EntityContext, shape: FileShape): SqlRow {
  const { createdAt } = shape;
  const stored = new Date(createdAt.getTime() + UNIX_MS_PER_SECOND);
  return {
    id: deterministicUlid(
      createdAt,
      `${String(entities.seed)}:media:${shape.key}`,
    ),
    objectKey: mediaFileKeyOf(shape.kind, shape.serial),
    purpose: USER_AVATAR_PURPOSE,
    storage: 'images',
    location: 'images',
    ownerKind: 'user',
    ownerId: shape.ownerId,
    originalFileName: 'synthetic-avatar.png',
    contentType: 'image/png',
    byteSize: 1_024,
    width: 64,
    height: 64,
    storedAt: stored,
    attachedAt: stored,
    moderationStatus: 'passed',
    moderatedAt: stored,
    createdAt,
    updatedAt: stored,
    ...shape.overrides,
  };
}

export function orphanOwnerIdOf(
  entities: EntityContext,
  index: number,
): string {
  const at = new Date(
    baseInstantOf(entities.baseDate).getTime() +
      ORPHAN_OWNER_AFTER_BASE_DAYS * DAY_MS,
  );
  return deterministicUlid(
    at,
    `${String(entities.seed)}:orphan-owner:${String(index)}`,
  );
}

function* userFileShapes(entities: EntityContext): Generator<FileShape> {
  for (let index = 0; index < entities.profile.users; index += 1) {
    const user = userAt(entities, index);
    yield {
      key: `user/${numberOf(index)}`,
      kind: 'user',
      serial: index,
      ownerId: user.id,
      createdAt: new Date(user.createdAt.getTime() + HOUR_MS),
    };
  }
}

function* orphanFileShapes(entities: EntityContext): Generator<FileShape> {
  const createdAt = new Date(
    baseInstantOf(entities.baseDate).getTime() - 30 * DAY_MS,
  );
  for (let index = 0; index < ORPHAN_FILE_COUNT; index += 1) {
    yield {
      key: `orphan/${numberOf(index)}`,
      kind: 'orphan',
      serial: index,
      ownerId: orphanOwnerIdOf(entities, index),
      createdAt,
    };
  }
}

interface DedicatedFile {
  readonly job: Job;
  readonly name: string;
  readonly ageMs: number;
  readonly overrides: (createdAt: Date, base: number) => SqlRow;
  readonly reason?: 'admin_action' | 'product_hidden';
}

// 810: 削除待ち・論理削除から13日以上・24時間を過ぎた未紐付け。820: 未判定・判定待ちのまま1時間以上。830: 隔離理由が無いのに隔離バケット・隔離理由があるのに通常のバケット。各行は自分のジョブの条件だけに当たる
const DEDICATED_FILES: readonly DedicatedFile[] = Object.freeze([
  {
    job: '810',
    name: 'erase-requested',
    ageMs: DAY_MS,
    overrides: (createdAt: Date) => ({
      eraseRequestedAt: new Date(createdAt.getTime() + HOUR_MS),
    }),
  },
  {
    job: '810',
    name: 'soft-deleted',
    ageMs: 15 * DAY_MS,
    overrides: (createdAt: Date) => ({
      deletedAt: new Date(createdAt.getTime() + DAY_MS),
    }),
  },
  {
    job: '810',
    name: 'unattached',
    ageMs: 3 * DAY_MS,
    overrides: () => ({ attachedAt: null, moderationStatus: 'passed' }),
  },
  {
    job: '820',
    name: 'undetermined',
    ageMs: DAY_MS,
    overrides: () => ({ moderationStatus: 'undetermined', moderatedAt: null }),
  },
  {
    job: '820',
    name: 'pending-old',
    ageMs: 2 * DAY_MS,
    overrides: () => ({ moderationStatus: 'pending', moderatedAt: null }),
  },
  {
    job: '820',
    name: 'pending-hours',
    ageMs: 3 * HOUR_MS,
    overrides: () => ({ moderationStatus: 'pending', moderatedAt: null }),
  },
  {
    job: '830',
    name: 'quarantine-without-reason',
    ageMs: DAY_MS,
    overrides: () => ({ location: 'quarantine' }),
  },
  {
    job: '830',
    name: 'images-with-admin-reason',
    ageMs: DAY_MS,
    overrides: () => ({}),
    reason: 'admin_action',
  },
  {
    job: '830',
    name: 'images-with-product-reason',
    ageMs: DAY_MS,
    overrides: () => ({}),
    reason: 'product_hidden',
  },
]);

interface PlannedDedicated {
  readonly shape: FileShape;
  readonly reason: DedicatedFile['reason'];
}

function dedicatedPlans(entities: EntityContext): PlannedDedicated[] {
  const base = baseInstantOf(entities.baseDate).getTime();
  return DEDICATED_FILES.map((file, position) => {
    const createdAt = new Date(base - file.ageMs);
    return {
      reason: file.reason,
      shape: {
        key: `job-${file.job}/${file.name}`,
        kind: file.job,
        serial: position,
        ownerId: userAt(entities, DEDICATED_FIRST_OWNER_INDEX + position).id,
        createdAt,
        overrides: file.overrides(createdAt, base),
      },
    };
  });
}

function* allShapes(entities: EntityContext): Generator<FileShape> {
  yield* userFileShapes(entities);
  yield* orphanFileShapes(entities);
  for (const { shape } of dedicatedPlans(entities)) {
    yield shape;
  }
}

export function* mediaStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  yield* insertStatements(
    mediaFiles,
    (function* () {
      for (const shape of allShapes(entities)) {
        yield baseRow(entities, shape);
      }
    })(),
  );
  const reasons = dedicatedPlans(entities).flatMap(({ shape, reason }) =>
    reason === undefined
      ? []
      : [
          {
            id: deterministicUlid(
              shape.createdAt,
              `${String(entities.seed)}:media-reason:${shape.key}`,
            ),
            fileId: baseRow(entities, shape)['id'],
            reason,
            createdAt: shape.createdAt,
            updatedAt: shape.createdAt,
          },
        ],
  );
  yield* insertStatements(mediaFileQuarantineReasons, reasons);
}
