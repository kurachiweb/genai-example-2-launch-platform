import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import {
  type InquiryAdminService,
  StoreInquiryAdminService,
} from './inquiry-admin-service.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  AdminInquiryDetail,
  AdminInquiryFilter,
  AdminInquiryPage,
  GuestInquiryRecord,
  InquirerProfile,
  InquirerProfiles,
  InquiryAdminReader,
  InquiryMessageRecord,
  MemberInquiryRecord,
  MemberInquiryStore,
} from './ports.ts';

const USER_ID = '01JD0000000000000000USER01';
const MEMBER_INQUIRY_ID = '01JD0000000000000000MINQ01';
const GUEST_INQUIRY_ID = '01JD0000000000000000GINQ01';
const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

const memberInquiryOf = (
  overrides: Partial<MemberInquiryRecord> = {},
): MemberInquiryRecord => ({
  id: MEMBER_INQUIRY_ID,
  userId: USER_ID,
  categoryId: '01JD0000000000000000000BUG',
  status: 'in_progress',
  statusChangedAt: new Date('2027-03-02T00:00:00.000Z'),
  lastMessageAt: new Date('2027-03-03T00:00:00.000Z'),
  createdAt: new Date('2027-03-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const GUEST_INQUIRY: GuestInquiryRecord = Object.freeze({
  id: GUEST_INQUIRY_ID,
  categoryId: '01JC0000000000000000000000',
  nickname: '未ログインの人',
  email: 'guest@mail.example',
  body: 'ログインできません。',
  status: 'open',
  statusChangedAt: new Date('2027-03-05T00:00:00.000Z'),
  createdAt: new Date('2027-03-05T00:00:00.000Z'),
});

const MESSAGES: readonly InquiryMessageRecord[] = Object.freeze([
  {
    id: '01JD0000000000000000MMSG01',
    inquiryId: MEMBER_INQUIRY_ID,
    sender: 'user',
    adminId: null,
    body: '画像のアップロードに失敗します。',
    fileIds: ['01JD0000000000000000FILE0A'],
    createdAt: new Date('2027-03-01T00:00:00.000Z'),
  },
  {
    id: '01JD0000000000000000AMSG01',
    inquiryId: MEMBER_INQUIRY_ID,
    sender: 'admin',
    adminId: ADMIN_ID,
    body: '確認します。',
    fileIds: [],
    createdAt: new Date('2027-03-03T00:00:00.000Z'),
  },
]);

const PROFILE: InquirerProfile = Object.freeze({
  userId: USER_ID,
  nickname: 'ログイン中の人',
  handle: 'member',
  avatarFileId: null,
});

const PAGE: AdminInquiryPage = Object.freeze<AdminInquiryPage>({
  items: [
    {
      kind: 'guest',
      id: GUEST_INQUIRY_ID,
      categoryId: GUEST_INQUIRY.categoryId,
      status: 'open',
      senderName: GUEST_INQUIRY.nickname,
      withdrawn: false,
      createdAt: GUEST_INQUIRY.createdAt,
      lastMessageAt: GUEST_INQUIRY.createdAt,
    },
  ],
  nextCursor: 'cursor-2',
});

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      // コンテナは注入する値がPromiseかをthenの有無で調べるため、thenは無いものとして返す
      if (property === 'then' || typeof property === 'symbol') {
        return undefined;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${property}`);
      };
    },
  }) as T;
}

interface FakeOptions {
  readonly detail?: AdminInquiryDetail | undefined;
  readonly profiles?: ReadonlyMap<string, InquirerProfile>;
  readonly unhandled?: number;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const listed: {
    readonly filter: AdminInquiryFilter;
    readonly page: { readonly after?: string; readonly limit: 50 };
  }[] = [];
  const profileRequests: (readonly string[])[] = [];
  const messageRequests: string[] = [];
  const detail =
    'detail' in options
      ? options.detail
      : { kind: 'member' as const, inquiry: memberInquiryOf() };
  const reader = partialFake<InquiryAdminReader>({
    list: (filter, page) => {
      calls.push('list');
      listed.push({ filter, page });
      return Promise.resolve(PAGE);
    },
    findDetail: (id) => {
      calls.push('findDetail');
      return Promise.resolve(detail?.inquiry.id === id ? detail : undefined);
    },
    countUnhandled: () => {
      calls.push('countUnhandled');
      return Promise.resolve(options.unhandled ?? 0);
    },
  });
  const store = partialFake<MemberInquiryStore>({
    listMessages: (inquiryId) => {
      calls.push('listMessages');
      messageRequests.push(inquiryId);
      return Promise.resolve(inquiryId === MEMBER_INQUIRY_ID ? MESSAGES : []);
    },
  });
  const profiles = partialFake<InquirerProfiles>({
    findMany: (userIds) => {
      calls.push('findMany');
      profileRequests.push(userIds);
      return Promise.resolve(options.profiles ?? new Map([[USER_ID, PROFILE]]));
    },
  });
  const container = new Container();
  container
    .bind<InquiryAdminReader>(INQUIRY_TYPES.InquiryAdminReader)
    .toConstantValue(reader);
  container
    .bind<MemberInquiryStore>(INQUIRY_TYPES.MemberInquiryStore)
    .toConstantValue(store);
  container
    .bind<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles)
    .toConstantValue(profiles);
  container
    .bind<InquiryAdminService>(INQUIRY_TYPES.InquiryAdminService)
    .to(StoreInquiryAdminService);
  const service = container.get<InquiryAdminService>(
    INQUIRY_TYPES.InquiryAdminService,
  );
  return { service, calls, listed, profileRequests, messageRequests };
}

describe('StoreInquiryAdminService.list', () => {
  test('絞り込みの条件をそのまま渡し、1ページ50件で横断の一覧を読む', async () => {
    const filter: AdminInquiryFilter = {
      status: 'open',
      kind: 'guest',
      categoryId: GUEST_INQUIRY.categoryId,
      receivedFrom: new Date('2027-03-01T00:00:00.000Z'),
      receivedBefore: new Date('2027-04-01T00:00:00.000Z'),
    };
    const { service, listed } = setup();

    const page = await service.list(filter, undefined);

    expect(page).toBe(PAGE);
    expect(listed).toEqual([{ filter, page: { limit: 50 } }]);
  });

  test('続きのページはカーソルを渡して読む', async () => {
    const { service, listed } = setup();

    await service.list({}, 'cursor-2');

    expect(listed).toEqual([
      { filter: {}, page: { after: 'cursor-2', limit: 50 } },
    ]);
  });
});

describe('StoreInquiryAdminService.detail', () => {
  test('ログインの問い合わせは、送信日時の古い順のメッセージと送った利用者の表示を併せて返す', async () => {
    const { service, calls, profileRequests, messageRequests } = setup();

    const view = await service.detail(MEMBER_INQUIRY_ID);

    expect(view).toEqual({
      kind: 'member',
      inquiry: memberInquiryOf(),
      withdrawn: false,
      member: PROFILE,
      messages: MESSAGES,
    });
    expect(calls.toSorted()).toEqual([
      'findDetail',
      'findMany',
      'listMessages',
    ]);
    expect(calls[0]).toBe('findDetail');
    expect(messageRequests).toEqual([MEMBER_INQUIRY_ID]);
    expect(profileRequests).toEqual([[USER_ID]]);
  });

  test('論理削除したログインの問い合わせは退会済みとして返す', async () => {
    const inquiry = memberInquiryOf({
      deletedAt: new Date('2027-03-10T00:00:00.000Z'),
    });
    const { service } = setup({ detail: { kind: 'member', inquiry } });

    const view = await service.detail(MEMBER_INQUIRY_ID);

    expect(view).toEqual({
      kind: 'member',
      inquiry,
      withdrawn: true,
      member: PROFILE,
      messages: MESSAGES,
    });
  });

  test('送った利用者の表示が見つからなければ、利用者の表示を空にしてメッセージは返す', async () => {
    const { service } = setup({ profiles: new Map() });

    const view = await service.detail(MEMBER_INQUIRY_ID);

    expect(view).toEqual({
      kind: 'member',
      inquiry: memberInquiryOf(),
      withdrawn: false,
      member: undefined,
      messages: MESSAGES,
    });
  });

  test('未ログインの問い合わせは連絡先と本文を持つ記録を返し、メッセージと利用者の表示を読まない', async () => {
    const { service, calls } = setup({
      detail: { kind: 'guest', inquiry: GUEST_INQUIRY },
    });

    const view = await service.detail(GUEST_INQUIRY_ID);

    expect(view).toEqual({
      kind: 'guest',
      inquiry: GUEST_INQUIRY,
      withdrawn: false,
    });
    expect(calls).toEqual(['findDetail']);
  });

  test('存在しない問い合わせはundefinedを返し、メッセージと利用者の表示を読まない', async () => {
    const { service, calls } = setup({ detail: undefined });

    const view = await service.detail(MEMBER_INQUIRY_ID);

    expect(view).toBeUndefined();
    expect(calls).toEqual(['findDetail']);
  });
});

describe('StoreInquiryAdminService.unhandledCount', () => {
  test('退会済みを除いた未対応の件数を照会口からそのまま返す', async () => {
    const { service, calls } = setup({ unhandled: 7 });

    const count = await service.unhandledCount();

    expect(count).toBe(7);
    expect(calls).toEqual(['countUnhandled']);
  });
});
