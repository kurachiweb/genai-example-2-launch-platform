import type {
  ClientMyProductsQuery,
  ClientRegisterProductMutation,
} from '../src/graphql/generated/graphql.ts';
import type { ClientViewer } from '../src/graphql/viewer.ts';

export const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

export type MyProductsPage = ClientMyProductsQuery['myProducts'];
export type MyProductNode = MyProductsPage['nodes'][number];
export type MyProductFields = ClientRegisterProductMutation['registerProduct'];

export const CATEGORY = {
  id: '01JD0CATEGORY0000000000001',
  name: '開発ツール',
  handle: 'dev-tools',
  systemDefault: false,
};

export const LOGO = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

export const WINDOW = {
  earliest: '2026-11-12',
  latest: '2027-02-07',
  unavailable: [
    {
      from: '2026-11-12',
      to: '2026-11-13',
      reason: 'RELAUNCH_INTERVAL' as const,
    },
  ],
  relaunchIntervalDays: 7,
};

export const RESCHEDULE_PLAN: MyProductNode['plan'] = {
  mode: 'RESCHEDULE',
  currentLaunchDate: '2026-11-20',
  window: WINDOW,
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
};

export const LAUNCH: NonNullable<MyProductNode['latestLaunch']> = {
  id: '01JD0LAUNCH000000000000001',
  number: 1,
  launchDate: '2026-11-20',
  kickoffAt: '2026-11-19T15:00:00.000Z',
  status: 'SCHEDULED',
  outcome: null,
  summary: { label: 'キックオフ予定', inMatch: false },
};

export const NODE: MyProductNode = {
  handle: 'pitch-deck',
  name: 'ピッチデッキ',
  category: CATEGORY,
  logo: LOGO,
  hidden: false,
  listed: false,
  latestLaunch: LAUNCH,
  plan: RESCHEDULE_PLAN,
};

export const pageOf = (
  nodes: readonly MyProductNode[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientMyProductsQuery => ({
  myProducts: { nodes: [...nodes], pageInfo: { endCursor, hasNextPage } },
});

export const FIRST_PAGE = pageOf([NODE], 'cursor-1', true);

export const FIELDS: MyProductFields = {
  ...NODE,
  previousHandle: 'pitch-deck-old',
  tagline: '5分でピッチの資料を作る',
  websiteUrl: 'https://pitch-deck.example',
  description: '# ピッチデッキ',
  logoFileId: LOGO.id,
  screenshots: [
    {
      fileId: '01JD0FILE00000000000000002',
      image: { ...LOGO, id: '01JD0FILE00000000000000002' },
      byteSize: 2_097_152,
    },
    { fileId: '01JD0FILE00000000000000003', image: null, byteSize: 0 },
  ],
  version: 4,
};
