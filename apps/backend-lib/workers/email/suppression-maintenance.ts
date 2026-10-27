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
import type { SendRecordRepository } from './send-record-repository.ts';
import type { SuppressionStore } from './suppression-repository.ts';

// 照会口の1回の上限(90件)に合わせ、1日の処理件数を区切って残りを翌日の実行に回す
const UNLINKED_KEYS_PER_PAGE = 90;
const MAX_UNLINKED_PAGES_PER_RUN = 20;

const MILLISECONDS_PER_DAY = 86_400_000;

const logger = getAppLogger(['api', 'application', 'email-cleanup']);

interface UnlinkedCleanupResult {
  readonly deleted: number;
  readonly check: EmailCleanupSummary['unlinkedCheck'];
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}

async function deleteUnlinked(
  suppressions: SuppressionStore,
  directory: UserAddressDirectory,
  cutoff: Date,
): Promise<UnlinkedCleanupResult> {
  let deleted = 0;
  let afterKey: string | undefined;
  for (let page = 0; page < MAX_UNLINKED_PAGES_PER_RUN; page += 1) {
    const keys = await suppressions.listLastEventBefore(
      cutoff,
      UNLINKED_KEYS_PER_PAGE,
      afterKey,
    );
    if (keys.length === 0) {
      break;
    }
    const lookup = await directory.findRegistered(keys);
    if (lookup.kind === 'unavailable') {
      return { deleted, check: 'skipped-directory-unavailable' };
    }
    deleted += await suppressions.deleteByKeys(
      keys.filter((key) => !lookup.registered.has(key)),
    );
    if (keys.length < UNLINKED_KEYS_PER_PAGE) {
      break;
    }
    afterKey = keys.at(-1);
  }
  return { deleted, check: 'done' };
}

export function createSuppressionMaintenance(
  suppressions: SuppressionStore,
  sendRecords: Pick<SendRecordRepository, 'deleteSentBefore'>,
  directory: UserAddressDirectory,
): SuppressionMaintenance {
  return {
    async deleteByAddress(address) {
      await suppressions.deleteByKeys([toMatchingKey(address)]);
    },

    async runDailyCleanup(now) {
      const expiredSuppressionsDeleted = await suppressions.deleteExpired(now);
      const sendRecordsDeleted = await sendRecords.deleteSentBefore(
        daysBefore(now, SEND_RECORD_RETENTION_DAYS),
      );
      const unlinked = await deleteUnlinked(
        suppressions,
        directory,
        daysBefore(now, UNLINKED_RETENTION_DAYS),
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
