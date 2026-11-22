import { PROFILE_BIO_PATH } from '../export-plan.ts';
import { referenceFile } from './file-reference.ts';
import type { DocumentInput } from './file-reference.ts';
import { toIsoUtc, toIsoUtcOrNull } from './export-formats.ts';

export interface AccountDocument {
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly registeredAt: string;
  readonly mfaEnabled: boolean;
  readonly plan: {
    readonly name: 'ultras';
    readonly status: string;
    readonly startedAt: string;
    readonly currentPeriodEndsAt: string | null;
    readonly canceledAt: string | null;
  } | null;
  readonly notificationSettings: {
    readonly matchPreview: boolean;
    readonly matchResult: boolean;
    readonly followedUserMatch: boolean;
    readonly followedUserAward: boolean;
    readonly suppressedReason: string | null;
  } | null;
  readonly apiKeys: readonly {
    readonly name: string;
    readonly scopes: Readonly<Record<string, string>>;
    readonly createdAt: string;
  }[];
}

export interface ProfileDocument {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bioPath: string | null;
  readonly avatarPath: string | null;
  readonly avatarQuarantined: boolean | null;
  readonly avatarOriginalFileName: string | null;
  readonly avatarContentType: string | null;
  readonly avatarSize: number | null;
  readonly websites: readonly {
    readonly name: string;
    readonly url: string;
  }[];
  readonly updatedAt: string;
}

// 項目を明示して写す。上流の取得結果に余分な項目が混ざっても出力へ出さないため
export function buildAccountDocument({
  snapshot,
}: DocumentInput): AccountDocument {
  const { account } = snapshot;
  const { plan, notificationSettings } = account;
  return {
    email: account.email,
    emailVerifiedAt: toIsoUtcOrNull(account.emailVerifiedAt),
    registeredAt: toIsoUtc(account.registeredAt),
    mfaEnabled: account.mfaEnabled,
    plan:
      plan === null
        ? null
        : {
            name: 'ultras',
            status: plan.status,
            startedAt: toIsoUtc(plan.startedAt),
            currentPeriodEndsAt: toIsoUtcOrNull(plan.currentPeriodEndsAt),
            canceledAt: toIsoUtcOrNull(plan.canceledAt),
          },
    notificationSettings:
      notificationSettings === null
        ? null
        : {
            matchPreview: notificationSettings.matchPreview,
            matchResult: notificationSettings.matchResult,
            followedUserMatch: notificationSettings.followedUserMatch,
            followedUserAward: notificationSettings.followedUserAward,
            suppressedReason: notificationSettings.suppressedReason,
          },
    apiKeys: account.apiKeys.map((apiKey) => ({
      name: apiKey.name,
      scopes: { ...apiKey.scopes },
      createdAt: toIsoUtc(apiKey.createdAt),
    })),
  };
}

export function buildProfileDocument(input: DocumentInput): ProfileDocument {
  const { profile } = input.snapshot;
  const avatar = referenceFile(input, profile.avatarFileId);
  const hasBio = input.plan.markdown.some(
    (entry) => entry.path === PROFILE_BIO_PATH,
  );
  return {
    handle: profile.handle,
    nickname: profile.nickname,
    headline: profile.headline,
    bioPath: hasBio ? PROFILE_BIO_PATH : null,
    avatarPath: avatar.path,
    avatarQuarantined: avatar.quarantined,
    avatarOriginalFileName: avatar.originalFileName,
    avatarContentType: avatar.contentType,
    avatarSize: avatar.size,
    websites: profile.websites.map((website) => ({
      name: website.name,
      url: website.url,
    })),
    updatedAt: toIsoUtc(profile.updatedAt),
  };
}
