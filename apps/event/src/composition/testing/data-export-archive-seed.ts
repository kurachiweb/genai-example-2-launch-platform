import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';

import { dataExports } from '../../../db/schema/data-export/data-exports.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import {
  commentIdOf,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { insertApiKey } from '../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import {
  clearMatchTables,
  insertMatches,
  insertUpvotes,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  clearMediaTables,
  insertFile,
  insertReason,
  objectKeyOf,
  fileIdOf,
} from '../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertCategory,
  categoryIdOf,
  insertScreenshot,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  openProductCaseOf,
  memberReportOf,
} from '../../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import {
  insertSponsorships,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  terminatedColumnsOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { exportIdOf } from '../../../lib/workers/data-export/testing/data-export-fixtures.ts';

export const OWNER = 1;
const OTHER = 2;
const WITHDRAWN_FOLLOWEE = 3;
const STRANGER = 4;

const OWNER_HANDLE = 'Exporter';
const OTHER_HANDLE = 'other-maker';

export const OWN_PRODUCT = 1;
export const OWN_DELETED_PRODUCT = 2;
const OTHER_PRODUCT = 3;
const OTHER_DELETED_PRODUCT = 4;

export const REQUESTED_AT = new Date('2026-11-22T07:30:00.000Z');

export const AVATAR_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4,
]);
export const SCREENSHOT_A_BYTES = new Uint8Array([10, 11, 12, 13, 14]);
export const SCREENSHOT_B_BYTES = new Uint8Array([20, 21, 22, 23, 24, 25]);
export const RECEIPT_BYTES = new Uint8Array(
  Array.from({ length: 4096 }, (_, index) => (index * 31 + 7) % 251),
);

const FILE = {
  avatar: 1,
  quarantinedLogo: 2,
  screenshotA: 3,
  screenshotB: 4,
  receipt: 5,
  vanishedAttachment: 6,
} as const;

const FAR_FUTURE_START = '2099-01-01';

export const PAYMENT_IDS = {
  sponsorship: sponsorshipPaymentRecordIdOf(1),
  subscription: '01JE0DXPAY0000000000000002',
  refund: '01JE0DXPAY0000000000000003',
  dispute: '01JE0DXPAY0000000000000004',
  smoke: '01JE0DXPAY0000000000000005',
  stranger: '01JE0DXPAY0000000000000006',
} as const;

export const INQUIRY_ID = '01JE0DXINQ0000000000000001';
export const USER_MESSAGE_ID = '01JE0DXMSG0000000000000001';
export const ADMIN_MESSAGE_ID = '01JE0DXMSG0000000000000002';
const ADMIN_ID = '01JE0DXADM0000000000000001';

export function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

export async function clearAll(): Promise<void> {
  await db.delete(dataExports);
  await db.delete(reports);
  await db.delete(reportCases);
  await db.delete(inquiryMessageAttachments);
  await db.delete(inquiryMessages);
  await db.delete(memberInquiries);
  await db.delete(sponsorships);
  await db.delete(paymentRecords);
  await db.delete(apiKeys);
  await db.delete(userFollows);
  await db.delete(userProfileWebsites);
  await db.delete(userProfiles);
  await db.delete(productRatings);
  await db.delete(launchComments);
  await clearMatchTables();
  await clearMediaTables();
}

async function putObject(
  bucket: R2Bucket,
  fileIndex: number,
  bytes: Uint8Array,
): Promise<void> {
  await bucket.put(objectKeyOf(fileIndex), bytes);
}

export async function emptyBuckets(): Promise<void> {
  for (const bucket of [
    env.IMAGES_BUCKET,
    env.FILES_BUCKET,
    env.QUARANTINE_BUCKET,
  ]) {
    const listed = await bucket.list();
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map(({ key }) => key));
    }
  }
}

async function seedMedia(): Promise<void> {
  const owner = { ownerKind: 'user', ownerId: userIdOf(OWNER) } as const;
  await insertFile(FILE.avatar, {
    ...owner,
    originalFileName: 'avatar.png',
    contentType: 'image/png',
    byteSize: AVATAR_BYTES.length,
  });
  await insertFile(FILE.quarantinedLogo, {
    ...owner,
    location: 'quarantine',
    originalFileName: 'logo.png',
    contentType: 'image/png',
    byteSize: 777,
  });
  await insertReason(FILE.quarantinedLogo, 'auto');
  await insertFile(FILE.screenshotA, {
    ...owner,
    originalFileName: 'home.png',
    contentType: 'image/png',
    byteSize: SCREENSHOT_A_BYTES.length,
  });
  await insertFile(FILE.screenshotB, {
    ...owner,
    originalFileName: 'home.png',
    contentType: 'image/png',
    byteSize: SCREENSHOT_B_BYTES.length,
  });
  await insertFile(FILE.receipt, {
    ...owner,
    purpose: 'inquiry-attachment',
    storage: 'files',
    location: 'files',
    originalFileName: '領収書: 2026?.pdf',
    contentType: 'application/pdf',
    byteSize: RECEIPT_BYTES.length,
    width: null,
    height: null,
  });
  await insertFile(FILE.vanishedAttachment, {
    ...owner,
    purpose: 'inquiry-attachment',
    storage: 'files',
    location: 'files',
    originalFileName: 'vanished.pdf',
    contentType: 'application/pdf',
    byteSize: 300,
    width: null,
    height: null,
  });
  await putObject(env.IMAGES_BUCKET, FILE.avatar, AVATAR_BYTES);
  await putObject(env.QUARANTINE_BUCKET, FILE.quarantinedLogo, AVATAR_BYTES);
  await putObject(env.IMAGES_BUCKET, FILE.screenshotA, SCREENSHOT_A_BYTES);
  await putObject(env.IMAGES_BUCKET, FILE.screenshotB, SCREENSHOT_B_BYTES);
  await putObject(env.FILES_BUCKET, FILE.receipt, RECEIPT_BYTES);
}

async function seedAccounts(): Promise<void> {
  await insertUser(OWNER, {
    handle: OWNER_HANDLE,
    nickname: 'エクスポート太郎',
    email: 'exporter@mail.example',
    emailVerifiedAt: at(1000),
  });
  await insertUser(OTHER, { handle: OTHER_HANDLE, nickname: 'Other Maker' });
  await insertUser(WITHDRAWN_FOLLOWEE, { deletedAt: at(2000) });
  await insertUser(STRANGER);
  await db.insert(userProfiles).values({
    id: '01JE0DXPRF0000000000000001',
    userId: userIdOf(OWNER),
    headline: '個人開発者',
    bioMarkdown: '# 自己紹介\n\nこんにちは',
    avatarFileId: fileIdOf(FILE.avatar),
    createdAt: at(1500),
    updatedAt: at(1600),
  });
  await db.insert(userProfileWebsites).values({
    id: '01JE0DXWEB0000000000000001',
    userId: userIdOf(OWNER),
    position: 0,
    name: null,
    url: 'https://github.example/exporter',
    createdAt: at(1500),
    updatedAt: at(1500),
  });
  await db.insert(userFollows).values([
    {
      id: '01JE0DXFLW0000000000000001',
      followerId: userIdOf(OWNER),
      followeeId: userIdOf(OTHER),
      createdAt: at(2500),
      updatedAt: at(2500),
    },
    {
      id: '01JE0DXFLW0000000000000002',
      followerId: userIdOf(OWNER),
      followeeId: userIdOf(WITHDRAWN_FOLLOWEE),
      createdAt: at(2600),
      updatedAt: at(2600),
    },
  ]);
  await insertApiKey(1, OWNER, {
    name: 'My dashboard',
    scopeProfile: 'read_write',
    createdAt: at(1800),
  });
}

async function seedProducts(): Promise<void> {
  await insertCategory(1, { name: 'AI', handle: 'ai' });
  await insertProduct(OWN_PRODUCT, OWNER, {
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'サッカー観戦メモをAIがまとめるアプリ',
    categoryId: categoryIdOf(1),
    descriptionMarkdown: '## Pitch Notes\n\n説明文',
    logoFileId: fileIdOf(FILE.quarantinedLogo),
    createdAt: at(3000),
    updatedAt: at(3100),
  });
  await insertScreenshot(1, OWN_PRODUCT, 0, fileIdOf(FILE.screenshotA));
  await insertScreenshot(2, OWN_PRODUCT, 1, fileIdOf(FILE.screenshotB));
  await insertProduct(OWN_DELETED_PRODUCT, OWNER, {
    handle: 'old-product',
    name: 'Old Product',
    createdAt: at(3200),
    updatedAt: at(3300),
    hiddenAt: at(4000),
    deletedAt: at(4100),
  });
  await insertProduct(OTHER_PRODUCT, OTHER, {
    handle: 'tactics-board',
    name: 'Tactics Board',
  });
  await insertProduct(OTHER_DELETED_PRODUCT, OTHER, {
    handle: 'retired-board',
    name: 'Retired Board',
    deletedAt: at(4200),
  });
  await insertLaunch(1, OWN_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: at(5000),
  });
  await insertLaunch(2, OWN_PRODUCT, {
    launchDate: '2026-11-12',
    outcome: 'lost',
    decidedAt: at(5100),
  });
  await insertLaunch(3, OTHER_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'lost',
    decidedAt: at(5000),
  });
  await insertLaunch(4, OTHER_DELETED_PRODUCT, {
    launchDate: '2026-11-11',
    outcome: 'won',
    decidedAt: at(5000),
  });
}

async function seedMatchesAndEngagement(): Promise<void> {
  await insertMatches([
    {
      index: 1,
      columns: { matchDate: '2026-11-10' },
      entries: [
        {
          index: 1,
          launch: 1,
          product: OWN_PRODUCT,
          owner: OWNER,
          columns: {
            upvoteCount: 12,
            lastUpvotedAt: at(6000),
            lastUpvoteSeq: 12,
            result: 'won',
          },
        },
        {
          index: 2,
          launch: 3,
          product: OTHER_PRODUCT,
          owner: OTHER,
          columns: { upvoteCount: 9, result: 'lost' },
        },
      ],
    },
    {
      index: 2,
      columns: { kind: 'week', round: 1, matchDate: '2026-11-12' },
      entries: [{ index: 3, launch: 2, product: OWN_PRODUCT, owner: OWNER }],
    },
    {
      index: 3,
      columns: { matchDate: '2026-11-11' },
      entries: [
        {
          index: 4,
          launch: 4,
          product: OTHER_DELETED_PRODUCT,
          owner: OTHER,
        },
      ],
    },
  ]);
  await insertUpvotes([
    {
      index: 1,
      match: 1,
      entry: 2,
      user: OWNER,
      upvotedAt: at(7000),
      columns: { matchDate: '2026-11-10' },
    },
    {
      index: 2,
      match: 3,
      entry: 4,
      user: OWNER,
      upvotedAt: at(7100),
      columns: { matchDate: '2026-11-11' },
    },
    {
      index: 3,
      match: 1,
      entry: 1,
      user: OTHER,
      upvotedAt: at(7200),
      columns: { matchDate: '2026-11-10' },
    },
  ]);
  await insertComments([
    {
      index: 1,
      product: OWN_PRODUCT,
      launch: 1,
      author: OWNER,
      columns: { createdAt: at(8000), updatedAt: at(8500), editedAt: at(8500) },
    },
    {
      index: 2,
      product: OWN_PRODUCT,
      launch: 1,
      author: OWNER,
      parent: { index: 1, root: 1 },
      depth: 2,
      columns: {
        createdAt: at(8100),
        updatedAt: at(8100),
        deletedAt: at(8200),
      },
    },
    {
      index: 3,
      product: OTHER_PRODUCT,
      launch: 3,
      author: OWNER,
      columns: {
        createdAt: at(8300),
        updatedAt: at(8300),
        hiddenAt: at(8400),
      },
    },
    {
      index: 4,
      product: OTHER_DELETED_PRODUCT,
      launch: 4,
      author: OWNER,
      columns: { createdAt: at(8600), updatedAt: at(8600) },
    },
    {
      index: 5,
      product: OWN_PRODUCT,
      launch: 1,
      author: OTHER,
      columns: { createdAt: at(8700), updatedAt: at(8700) },
    },
  ]);
  await insertRatings([
    {
      index: 1,
      product: OTHER_PRODUCT,
      user: OWNER,
      score: 4,
      columns: {
        createdAt: at(9000),
        updatedAt: at(9500),
        invalidatedAt: at(9600),
      },
    },
    {
      index: 2,
      product: OTHER_DELETED_PRODUCT,
      user: OWNER,
      score: 2,
      columns: { createdAt: at(9100), updatedAt: at(9100) },
    },
    {
      index: 3,
      product: OWN_PRODUCT,
      user: OTHER,
      score: 5,
      columns: { createdAt: at(9200), updatedAt: at(9200) },
    },
  ]);
}

async function seedReports(): Promise<void> {
  await db.insert(reportCases).values([
    openProductCaseOf(1, {
      targetKind: 'comment',
      targetId: commentIdOf(3),
      productId: productIdOf(OTHER_PRODUCT),
      targetOwnerUserId: userIdOf(OWNER),
    }),
    openProductCaseOf(2, {
      targetId: productIdOf(OTHER_PRODUCT),
      productId: productIdOf(OTHER_PRODUCT),
      targetOwnerUserId: userIdOf(OTHER),
    }),
    openProductCaseOf(3, {
      targetId: productIdOf(OTHER_DELETED_PRODUCT),
      productId: productIdOf(OTHER_DELETED_PRODUCT),
      targetOwnerUserId: userIdOf(OTHER),
    }),
  ]);
  const own = { reporterUserId: userIdOf(OWNER), contactEmail: null } as const;
  await db.insert(reports).values([
    memberReportOf(1, 1, 1, {
      ...own,
      categoryName: 'スパム',
      reason: '同じ宣伝文を投稿している',
      reportedAt: at(10_000),
    }),
    memberReportOf(2, 2, 1, { ...own, reportedAt: at(10_100) }),
    memberReportOf(3, 3, 1, { ...own, reportedAt: at(10_200) }),
    memberReportOf(4, 2, 1, {
      reporterUserId: userIdOf(STRANGER),
      contactEmail: null,
      reportedAt: at(10_300),
    }),
  ]);
}

async function seedInquiry(): Promise<void> {
  await db.insert(memberInquiries).values({
    id: INQUIRY_ID,
    userId: userIdOf(OWNER),
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    status: 'resolved',
    statusChangedAt: at(11_500),
    lastMessageAt: at(11_500),
    createdAt: at(11_000),
    updatedAt: at(11_500),
  });
  await db.insert(inquiryMessages).values([
    {
      id: USER_MESSAGE_ID,
      inquiryId: INQUIRY_ID,
      senderKind: 'user',
      body: '領収書の宛名を変更できますか?',
      createdAt: at(11_000),
    },
    {
      id: ADMIN_MESSAGE_ID,
      inquiryId: INQUIRY_ID,
      senderKind: 'admin',
      adminId: ADMIN_ID,
      body: '領収書ページから変更できます。',
      createdAt: at(11_500),
    },
  ]);
  await db.insert(inquiryMessageAttachments).values([
    {
      messageId: USER_MESSAGE_ID,
      fileId: fileIdOf(FILE.receipt),
      position: 0,
    },
    {
      messageId: USER_MESSAGE_ID,
      fileId: fileIdOf(FILE.vanishedAttachment),
      position: 1,
    },
  ]);
}

async function seedPayments(): Promise<void> {
  await insertSponsorships([
    {
      index: 1,
      owner: OWNER,
      product: OWN_PRODUCT,
      columns: {
        ...terminatedColumnsOf(1),
        startsOn: FAR_FUTURE_START,
        endsOn: '2099-01-07',
        createdAt: at(12_000),
      },
    },
  ]);
  const base = {
    pseudonymousId: 'pseudonymous-1',
    currency: 'usd',
    lastEventAt: at(13_000),
    recordedAt: at(13_000),
    createdAt: at(13_000),
    updatedAt: at(13_000),
  } as const;
  await db.insert(paymentRecords).values([
    {
      ...base,
      id: PAYMENT_IDS.sponsorship,
      kind: 'one_time',
      purpose: 'sponsorship',
      status: 'succeeded',
      amount: 5600,
      quantity: 7,
      stripeReference: 'cs_test_sponsorship',
      relatedId: sponsorshipIdOf(1),
      occurredAt: at(13_000),
    },
    {
      ...base,
      id: PAYMENT_IDS.subscription,
      kind: 'subscription',
      purpose: 'ultras',
      status: 'succeeded',
      amount: 900,
      quantity: 1,
      stripeReference: 'in_test_ultras',
      relatedId: null,
      occurredAt: at(13_100),
    },
    {
      ...base,
      id: PAYMENT_IDS.refund,
      kind: 'refund',
      purpose: 'sponsorship',
      status: 'succeeded',
      amount: -4800,
      quantity: null,
      stripeReference: 're_test_sponsorship',
      relatedId: sponsorshipIdOf(1),
      occurredAt: at(13_200),
    },
    {
      ...base,
      id: PAYMENT_IDS.dispute,
      kind: 'dispute',
      purpose: 'sponsorship',
      status: 'disputed',
      amount: -5600,
      quantity: null,
      stripeReference: 'dp_test_sponsorship',
      relatedId: sponsorshipIdOf(1),
      occurredAt: at(13_300),
    },
    {
      ...base,
      id: PAYMENT_IDS.smoke,
      kind: 'one_time',
      purpose: 'payments_smoke',
      status: 'succeeded',
      amount: 100,
      quantity: 1,
      stripeReference: 'cs_test_smoke',
      relatedId: null,
      occurredAt: at(13_400),
    },
    {
      ...base,
      id: PAYMENT_IDS.stranger,
      pseudonymousId: 'pseudonymous-4',
      kind: 'one_time',
      purpose: 'sponsorship',
      status: 'succeeded',
      amount: 1,
      quantity: 1,
      stripeReference: 'cs_test_stranger',
      relatedId: null,
      occurredAt: at(13_500),
    },
  ]);
}

export async function seedOwnerData(): Promise<void> {
  await seedAccounts();
  await seedMedia();
  await seedProducts();
  await seedMatchesAndEngagement();
  await seedReports();
  await seedInquiry();
  await seedPayments();
}

export function exportRowOf(
  index: number,
  userIndex: number,
  columns: Partial<typeof dataExports.$inferInsert> = {},
): typeof dataExports.$inferInsert {
  return {
    id: exportIdOf(index),
    userId: userIdOf(userIndex),
    status: 'queued',
    requestedAt: REQUESTED_AT,
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    ...columns,
  };
}

export async function readExport(index: number) {
  const [row] = await db
    .select()
    .from(dataExports)
    .where(eq(dataExports.id, exportIdOf(index)));
  return row;
}

export { db };
