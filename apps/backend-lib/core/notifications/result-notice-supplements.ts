import type { ServiceIdentifier } from 'inversify';
import { z } from 'zod';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { linkUrlSchema } from '../email/kinds/link-url.ts';
import { createLifecycleRegistry } from '../identity/user-lifecycle.ts';
import type {
  EntryResult,
  MatchKind,
  MatchStage,
} from '../match/match-model.ts';
import type { BusinessDate } from '../time/business-time.ts';

export interface ResultNoticeSupplementInput {
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly entryId: string;
  readonly launchId: string | null;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly result: EntryResult;
  readonly decidedAt: Date;
}

export interface ResultNoticeSupplement {
  readonly title: string;
  // 日時はformatUtcDateTimeの表記
  readonly lines: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
  // 期限の強調(日曜日ローンチなど)
  readonly emphasized: boolean;
}

export interface ResultNoticeSupplementProvider {
  // 例外は送り出しの段の再試行になる
  supplementFor(
    input: ResultNoticeSupplementInput,
  ): Promise<ResultNoticeSupplement | undefined>;
}

export interface ResultNoticeSupplementRegistration {
  // '<spec名>.<名詞句>'
  readonly name: string;
  readonly kinds: readonly MatchKind[];
  // 同じ種別の中の順(昇順)
  readonly order: number;
  readonly provider: ServiceIdentifier<ResultNoticeSupplementProvider>;
}

export interface ResultNoticeSupplementRegistry {
  providersFor(kind: MatchKind): readonly ResultNoticeSupplementRegistration[];
}

export const RESULT_NOTICE_SUPPLEMENT_LIMITS = Object.freeze({
  titleGraphemes: 50,
  minLines: 1,
  maxLines: 5,
  lineGraphemes: 200,
  actionLabelGraphemes: 30,
});

export const RESULT_NOTICE_SUPPLEMENT_PROVIDER_LABEL = '結果の追記の提供元';

const boundedText = (maxGraphemes: number) =>
  z
    .string()
    .refine(
      (value) =>
        trimWhiteSpace(value) !== '' && countGraphemes(value) <= maxGraphemes,
      {
        message: `空白だけでない${String(maxGraphemes)}文字以内で指定してください`,
      },
    );

export const resultNoticeSupplementSchema: z.ZodType<ResultNoticeSupplement> =
  z.object({
    title: boundedText(RESULT_NOTICE_SUPPLEMENT_LIMITS.titleGraphemes),
    lines: z
      .array(boundedText(RESULT_NOTICE_SUPPLEMENT_LIMITS.lineGraphemes))
      .min(RESULT_NOTICE_SUPPLEMENT_LIMITS.minLines)
      .max(RESULT_NOTICE_SUPPLEMENT_LIMITS.maxLines),
    action: z
      .object({
        label: boundedText(
          RESULT_NOTICE_SUPPLEMENT_LIMITS.actionLabelGraphemes,
        ),
        url: linkUrlSchema,
      })
      .optional(),
    emphasized: z.boolean(),
  });

interface KindedRegistration {
  readonly name: string;
  readonly events: readonly MatchKind[];
  readonly order: number;
  readonly registration: ResultNoticeSupplementRegistration;
}

// 名前と順の検証・並びはライフサイクルの登録口と共通の規則にし、種別をその種類として扱う
export function createResultNoticeSupplementRegistry(
  registrations: readonly ResultNoticeSupplementRegistration[],
): ResultNoticeSupplementRegistry {
  const registry = createLifecycleRegistry<MatchKind, KindedRegistration>(
    registrations.map((registration) => ({
      name: registration.name,
      events: registration.kinds,
      order: registration.order,
      registration,
    })),
    { handlerLabel: RESULT_NOTICE_SUPPLEMENT_PROVIDER_LABEL },
  );
  return Object.freeze({
    providersFor: (kind: MatchKind) =>
      Object.freeze(
        registry.handlersFor(kind).map(({ registration }) => registration),
      ),
  });
}
