import {
  type ImageMediaType,
  isImageMediaType,
} from '../../../common-lib/media/media-types.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MediaFileView,
  MediaLocation,
  ModerationFinding,
  ModerationStatus,
} from '../../../lib/core/media/media-file.ts';
import type { ModerateImageBody } from '../../../lib/core/media/media-messages.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
  ModerationRecord,
} from '../../../lib/core/media/ports.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { RetryPolicy } from '../../../lib/core/messaging/retry-policy.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ModerationConfig } from './moderation-config.ts';
import {
  MODERATION_IMAGE_LIMITS,
  planModerationImage,
} from './moderation-image-plan.ts';
import { judgeLabels } from './moderation-verdict.ts';
import type {
  FileRelocator,
  MediaIncidentReporter,
  ModerationImagePlan,
  ModerationImageRenderer,
  ModerationOutcome,
  ModerationProvider,
} from './ports.ts';
import { inspectSvg } from './svg-allowlist.ts';

// 判定サービスの一時的な障害や処理量の上限が解けるまで待てるよう、既定より長い間隔(60・120・240・480秒)で再試行する
export const MODERATION_RETRY_POLICY = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 1800,
} as const) satisfies RetryPolicy;

type TransientReason = Extract<
  ModerationOutcome,
  { kind: 'transient' }
>['reason'];

export class ImageModerationRetryError extends Error {
  override readonly name = 'ImageModerationRetryError';

  constructor(reason: TransientReason) {
    super(
      `判定サービスの一時的な失敗のため、画像の判定を再試行します: ${reason}`,
    );
  }
}

export interface ModerateImageHandlerDependencies {
  readonly files: MediaFileStore;
  readonly objects: MediaObjectStore;
  readonly renderer: ModerationImageRenderer;
  readonly provider: ModerationProvider;
  readonly incidents: MediaIncidentReporter;
  readonly relocator: FileRelocator;
  readonly config: ModerationConfig;
  readonly clock: Clock;
}

type ModerationResult =
  | 'passed'
  | 'flagged'
  | 'undetermined'
  | 'retrying'
  | 'skipped'
  | 'already-moderated'
  | 'original-missing';

type LogLevel = 'info' | 'warning' | 'error';

// ファイル名・オブジェクトキー・画像の内容を出さないよう、ログの属性は識別子・結果・数値・分類の値だけで組む
type LogDetails = Readonly<Record<string, string | number | boolean>>;

interface HandlingContext {
  readonly fileId: string;
  readonly attempts: number;
  readonly startedAt: Date;
}

type Assessment =
  | {
      readonly kind: 'verdict';
      readonly record: Extract<
        ModerationRecord,
        { verdict: 'passed' | 'flagged' }
      >;
      readonly details: LogDetails;
      readonly level: LogLevel;
      readonly rejectedReason?: string;
    }
  | {
      readonly kind: 'transient';
      readonly reason: TransientReason;
      readonly details: LogDetails;
    };

const RESULT_MESSAGE = '画像の判定を終えました';

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const RECORDABLE_STATUSES: ReadonlySet<ModerationStatus> = new Set([
  'pending',
  'undetermined',
]);

// 寸法を読めないSVGは表示の大きさが決まらないため、判定用画像の長辺の上限の正方形として描く
const UNSIZED_IMAGE_SIDE = MODERATION_IMAGE_LIMITS.maxLongSide;

const SVG_MEDIA_TYPE = 'image/svg+xml';

const logger = getAppLogger(['event', 'media', 'moderation']);

type ImageFileView = MediaFileView & { readonly contentType: ImageMediaType };

function isModeratable(file: MediaFileView | undefined): file is ImageFileView {
  return (
    file !== undefined &&
    file.stored &&
    file.deletedAt === null &&
    !file.eraseRequested &&
    file.storage === 'images' &&
    isImageMediaType(file.contentType)
  );
}

// 隔離・復元の移動はコピー→元の削除→保存先の記録の更新の順のため、記録の保存先に無ければ移動先に既に写っている
function readLocationsOf(file: MediaFileView): readonly MediaLocation[] {
  return file.location === 'quarantine'
    ? ['quarantine', 'images']
    : ['images', 'quarantine'];
}

function flagged(
  findings: readonly ModerationFinding[],
  details: LogDetails,
  level: LogLevel = 'info',
  rejectedReason?: string,
): Assessment {
  return {
    kind: 'verdict',
    record: { verdict: 'flagged', findings },
    details: { ...details, findings: findings.length },
    level,
    ...(rejectedReason === undefined ? {} : { rejectedReason }),
  };
}

export class ModerateImageHandler implements MessageHandler<ModerateImageBody> {
  private readonly files: MediaFileStore;
  private readonly objects: MediaObjectStore;
  private readonly renderer: ModerationImageRenderer;
  private readonly provider: ModerationProvider;
  private readonly incidents: MediaIncidentReporter;
  private readonly relocator: FileRelocator;
  private readonly config: ModerationConfig;
  private readonly clock: Clock;

  constructor(dependencies: ModerateImageHandlerDependencies) {
    this.files = dependencies.files;
    this.objects = dependencies.objects;
    this.renderer = dependencies.renderer;
    this.provider = dependencies.provider;
    this.incidents = dependencies.incidents;
    this.relocator = dependencies.relocator;
    this.config = dependencies.config;
    this.clock = dependencies.clock;
  }

  async handle(
    body: ModerateImageBody,
    meta: MessageMeta,
  ): Promise<MessageHandlingResult> {
    const context: HandlingContext = {
      fileId: body.fileId,
      attempts: meta.attempts,
      startedAt: this.clock.now(),
    };
    const file = (await this.files.findViews([body.fileId])).get(body.fileId);
    if (!isModeratable(file)) {
      return this.finish(context, 'skipped');
    }
    // 判定済みの画像の隔離理由は管理者の解除を含めて確定しているため、判定し直さず保存先のずれだけを直す
    if (!RECORDABLE_STATUSES.has(file.moderationStatus)) {
      const { moved } = await this.relocator.reconcile([file.id]);
      return this.finish(context, 'already-moderated', { moved });
    }
    const original = await this.readOriginal(file);
    if (original === undefined) {
      return this.finish(context, 'original-missing', {}, 'warning');
    }
    const assessment = await this.assess(file, original);
    if (assessment.kind === 'transient') {
      return this.handleTransient(context, assessment);
    }
    const recorded = await this.files.recordModeration(
      file.id,
      assessment.record,
    );
    if (recorded && assessment.rejectedReason !== undefined) {
      this.incidents.rejectedByService(file.id, assessment.rejectedReason);
    }
    const { moved } = await this.relocator.reconcile([file.id]);
    return this.finish(
      context,
      assessment.record.verdict,
      { ...assessment.details, recorded, moved },
      assessment.level,
    );
  }

  private async readOriginal(
    file: MediaFileView,
  ): Promise<Uint8Array | undefined> {
    for (const location of readLocationsOf(file)) {
      const object = await this.objects.get(location, file.objectKey);
      if (object !== undefined) {
        return new Uint8Array(await new Response(object.body).arrayBuffer());
      }
    }
    return undefined;
  }

  private async assess(
    file: ImageFileView,
    original: Uint8Array,
  ): Promise<Assessment> {
    const type = file.contentType;
    if (type === SVG_MEDIA_TYPE) {
      const inspection = inspectSvg(new TextDecoder().decode(original));
      if (!inspection.ok) {
        return flagged(
          inspection.violations.map((violation) => ({
            source: 'svg',
            violation: violation.kind,
            target: violation.target,
          })),
          { reason: 'svg-violation' },
        );
      }
    }
    const plan = planModerationImage({
      type,
      width: file.width ?? UNSIZED_IMAGE_SIDE,
      height: file.height ?? UNSIZED_IMAGE_SIDE,
      byteSize: original.byteLength,
    });
    return this.detect(original, plan);
  }

  private async detect(
    original: Uint8Array,
    plan: ModerationImagePlan,
  ): Promise<Assessment> {
    const details: LogDetails = { planKind: plan.kind };
    const rendered = await this.renderer.render({ original, plan });
    if (!rendered.ok) {
      return flagged(
        [{ source: 'unprocessable', reason: 'undecodable' }],
        { ...details, reason: rendered.reason },
        'warning',
      );
    }
    const outcome = await this.provider.detect(
      rendered.image,
      this.config.minConfidence,
    );
    switch (outcome.kind) {
      case 'transient':
        return { kind: 'transient', reason: outcome.reason, details };
      case 'rejected':
        return flagged(
          [{ source: 'unprocessable', reason: 'rejected-by-service' }],
          { ...details, reason: outcome.reason },
          'warning',
          outcome.reason,
        );
      case 'labels': {
        const verdict = judgeLabels(outcome.labels, this.config);
        const labelDetails = { ...details, labels: outcome.labels.length };
        return verdict.verdict === 'passed'
          ? {
              kind: 'verdict',
              record: { verdict: 'passed' },
              details: labelDetails,
              level: 'info',
            }
          : flagged(verdict.findings, labelDetails);
      }
    }
  }

  // 一時的な失敗の間は画像を公開したまま保存先を動かさず、上限の試行で未判定を残して日次バッチの依頼し直しに任せる
  private async handleTransient(
    context: HandlingContext,
    assessment: Extract<Assessment, { kind: 'transient' }>,
  ): Promise<MessageHandlingResult> {
    const { reason } = assessment;
    const details = { ...assessment.details, reason };
    if (context.attempts < MODERATION_RETRY_POLICY.maxAttempts) {
      this.log(context, 'retrying', details, 'warning');
      throw new ImageModerationRetryError(reason);
    }
    const recorded = await this.files.recordModeration(context.fileId, {
      verdict: 'undetermined',
    });
    if (recorded) {
      this.incidents.undetermined(context.fileId, reason);
    }
    const misconfigured = reason === 'misconfigured';
    if (misconfigured) {
      this.incidents.misconfigured(reason);
    }
    return this.finish(
      context,
      'undetermined',
      { ...details, recorded },
      misconfigured ? 'error' : 'warning',
    );
  }

  private finish(
    context: HandlingContext,
    result: ModerationResult,
    details: LogDetails = {},
    level: LogLevel = 'info',
  ): MessageHandlingResult {
    this.log(context, result, details, level);
    return DONE;
  }

  private log(
    context: HandlingContext,
    result: ModerationResult,
    details: LogDetails,
    level: LogLevel,
  ): void {
    const properties = {
      result,
      fileId: context.fileId,
      attempts: context.attempts,
      durationMs: this.clock.now().getTime() - context.startedAt.getTime(),
      ...details,
    };
    switch (level) {
      case 'error':
        logger.error(RESULT_MESSAGE, properties);
        return;
      case 'warning':
        logger.warn(RESULT_MESSAGE, properties);
        return;
      case 'info':
        logger.info(RESULT_MESSAGE, properties);
    }
  }
}
