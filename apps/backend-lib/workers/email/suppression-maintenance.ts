import { toMatchingKey } from '../../core/email/email-address.ts';
import type {
  EmailCleanupSummary,
  SuppressionMaintenance,
  UserAddressDirectory,
} from '../../core/email/ports.ts';
import {
  SEND_RECORD_RETENTION_DAYS,
  UNLINKED_RETENTION_DAYS,
} from '../../core/email/suppression-policy.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { CleanupCursorStore } from './cleanup-cursor-repository.ts';
import type { SendRecordRepository } from './send-record-repository.ts';
import type { SuppressionStore } from './suppression-repository.ts';

// 照会口の1回の上限(90件)に合わせ、1日の処理件数を区切って残りを翌日の実行に回す
const UNLINKED_KEYS_PER_PAGE = 90;
const MAX_UNLINKED_PAGES_PER_RUN = 20;

const UNLINKED_CURSOR_NAME = 'email-delivery.unlinked-suppressions';

const MILLISECONDS_PER_DAY = 86_400_000;

const logger = getAppLogger(['api', 'application', 'email-cleanup']);

interface UnlinkedCleanupResult {
  readonly deleted: number;
  readonly check: EmailCleanupSummary['unlinkedCheck'];
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}

// 前回の続きの照合キーから確かめ、末尾に達したら位置を先頭へ戻す。1日の件数に上限があっても、全件を数日かけて一巡する
async function deleteUnlinked(
  suppressions: SuppressionStore,
  directory: UserAddressDirectory,
  cursors: CleanupCursorStore,
  cutoff: Date,
  now: Date,
): Promise<UnlinkedCleanupResult> {
  let deleted = 0;
  let afterKey = await cursors.read(UNLINKED_CURSOR_NAME);
  for (let page = 0; page < MAX_UNLINKED_PAGES_PER_RUN; page += 1) {
    const keys = await suppressions.listLastEventBefore(
      cutoff,
      UNLINKED_KEYS_PER_PAGE,
      afterKey,
    );
    if (keys.length > 0) {
      const lookup = await directory.findRegistered(keys);
      // 確かめていないページのキーを飛ばさないよう、位置は確かめ終えたページまでしか進めない
      if (lookup.kind === 'unavailable') {
        return { deleted, check: 'skipped-directory-unavailable' };
      }
      deleted += await suppressions.deleteByKeys(
        keys.filter((key) => !lookup.registered.has(key)),
      );
    }
    const reachedEnd = keys.length < UNLINKED_KEYS_PER_PAGE;
    afterKey = reachedEnd ? undefined : keys.at(-1);
    await cursors.save(UNLINKED_CURSOR_NAME, afterKey, now);
    if (reachedEnd) {
      break;
    }
  }
  return { deleted, check: 'done' };
}

export function createSuppressionMaintenance(
  suppressions: SuppressionStore,
  sendRecords: Pick<SendRecordRepository, 'deleteSentBefore'>,
  directory: UserAddressDirectory,
  cursors: CleanupCursorStore,
): SuppressionMaintenance {
  return {
    async deleteByAddress(address) {
      const key = toMatchingKey(address);
      await suppressions.deleteByKeys([key]);
      await cursors.resetIfAt(UNLINKED_CURSOR_NAME, key);
    },

    async runDailyCleanup(now) {
      const expiredSuppressionsDeleted = await suppressions.deleteExpired(now);
      const sendRecordsDeleted = await sendRecords.deleteSentBefore(
        daysBefore(now, SEND_RECORD_RETENTION_DAYS),
      );
      const unlinked = await deleteUnlinked(
        suppressions,
        directory,
        cursors,
        daysBefore(now, UNLINKED_RETENTION_DAYS),
        now,
      );
      if (unlinked.check === 'skipped-directory-unavailable') {
        logger.warn(
          '利用者のアドレスの照会口が使えないため、利用者に紐づかない抑止記録の削除を行いませんでした',
          {
            unlinkedCheck: unlinked.check,
            unlinkedSuppressionsDeleted: unlinked.deleted,
          },
        );
      }
      return {
        expiredSuppressionsDeleted,
        unlinkedSuppressionsDeleted: unlinked.deleted,
        sendRecordsDeleted,
        unlinkedCheck: unlinked.check,
      };
    },
  };
}
