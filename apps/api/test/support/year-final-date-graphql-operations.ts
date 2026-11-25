import { asc, eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { adminAuditLogs } from '../../db/schema/admin/admin-audit-logs.ts';
import { yearTournaments } from '../../db/schema/tournament/year-tournaments.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { clearYearTournamentTables } from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { weekTournamentSchemaModule } from '../../src/presentation/graphql/modules/week-tournament/index.ts';
import { yearTournamentSchemaModule } from '../../src/presentation/graphql/modules/year-tournament/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';

export { codesOf, detailsOf } from './match-graphql-operations.ts';

// 業務時刻の2026-12-01 12:00。2026年は変更期限の後、2027年は変更期限の前
export const YEAR_FINAL_DATE_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-12-01'),
  { hour: 12, minute: 0 },
);

export type YearFinalDateSourceValue = 'EXPLICIT' | 'DEFAULT';

export interface YearFinalDateSettingFields {
  readonly year: number;
  readonly finalDate: string;
  readonly source: YearFinalDateSourceValue;
  readonly acceptUntil: string;
  readonly deadlineAt: string;
  readonly drawAt: string;
  readonly changeLockAt: string;
  readonly changeable: boolean;
  readonly choices: readonly string[];
  readonly previousYearFinalDate: string | null;
  readonly nextYearFinalDate: string | null;
  readonly nextYearSource: YearFinalDateSourceValue | null;
  readonly nextYearGapWarningDate: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: { readonly nickname: string | null } | null;
}

export interface YearFinalDateSettingsFields {
  readonly serverTime: string;
  readonly settings: readonly YearFinalDateSettingFields[];
}

export interface UpdateYearFinalDateInput {
  readonly year: number;
  readonly finalDate: string;
  readonly expectedVersion: number;
  readonly reason?: string;
}

const SETTING_SELECTION = /* GraphQL */ `
  year
  finalDate
  source
  acceptUntil
  deadlineAt
  drawAt
  changeLockAt
  changeable
  choices
  previousYearFinalDate
  nextYearFinalDate
  nextYearSource
  nextYearGapWarningDate
  version
  updatedAt
  updatedBy {
    nickname
  }
`;

export const YEAR_FINAL_DATE_SETTINGS = /* GraphQL */ `
  query AdminYearFinalDateSettings {
    yearFinalDateSettings {
      serverTime
      settings {
        ${SETTING_SELECTION}
      }
    }
  }
`;

export const UPDATE_YEAR_FINAL_DATE = /* GraphQL */ `
  mutation AdminUpdateYearFinalDate($input: UpdateYearFinalDateInput!) {
    updateYearFinalDate(input: $input) {
      ${SETTING_SELECTION}
    }
  }
`;

let currentNow = YEAR_FINAL_DATE_TEST_NOW;

const testClock: Clock = { now: () => currentNow };

const clockModule: AppModule<GatewayApp> = {
  name: 'year-final-date-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

// Yearのスキーマモジュールの型定義はtournament-week・match・paymentsの型を参照するため、それらのスキーマモジュールも載せる
const finalDateGateway = createGraphQLGateway({
  documents: [YEAR_FINAL_DATE_SETTINGS, UPDATE_YEAR_FINAL_DATE],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    paymentsSchemaModule,
    weekTournamentSchemaModule,
    yearTournamentSchemaModule,
  ],
  overrides: [clockModule],
});

// 削除済みの管理者は、行を作らずにIDだけを最後に変更した管理者として使う
export const YEAR_FINAL_DATE_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
  secondSuperAdmin: 4,
  invited: 8,
  deleted: 9,
});

const ROLES_OF_SIGNED_IN_ADMINS: readonly (readonly [number, AdminRole])[] = [
  [YEAR_FINAL_DATE_ADMINS.superAdmin, 'super_admin'],
  [YEAR_FINAL_DATE_ADMINS.moderator, 'moderator'],
  [YEAR_FINAL_DATE_ADMINS.viewer, 'viewer'],
  [YEAR_FINAL_DATE_ADMINS.secondSuperAdmin, 'super_admin'],
];

const adminSessionTokens = new Map<number, string>();

export function asYearFinalDateAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

// セッションの期限は固定した時計で判定するため、時計を動かした後は発行し直す
export async function signInYearFinalDateAdmins(): Promise<void> {
  adminSessionTokens.clear();
  for (const [index] of ROLES_OF_SIGNED_IN_ADMINS) {
    adminSessionTokens.set(
      index,
      (await issueAdminSession(adminIdOf(index), { now: currentNow })).token,
    );
  }
}

// 選べる日付と変更期限が実行の時刻で変わらないよう、時計を固定する
export function setYearFinalDateTestNow(now: Date): void {
  currentNow = now;
}

// 各テストの前にYearトーナメントと監査ログを含む管理者の表を空にし、時計を戻して4人の管理者とそのセッションを用意する
export function installYearFinalDateGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = YEAR_FINAL_DATE_TEST_NOW;
    await clearYearTournamentTables();
    await clearAdminTables();
    for (const [index, role] of ROLES_OF_SIGNED_IN_ADMINS) {
      await insertAdmin(index, { role });
    }
    await signInYearFinalDateAdmins();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function fetchYearFinalDateSettings(options?: GatewayCallOptions) {
  return finalDateGateway.call<{
    yearFinalDateSettings: YearFinalDateSettingsFields | null;
  }>(YEAR_FINAL_DATE_SETTINGS, {}, options);
}

export function updateYearFinalDate(
  input: UpdateYearFinalDateInput,
  options?: GatewayCallOptions,
) {
  return finalDateGateway.call<{
    updateYearFinalDate: YearFinalDateSettingFields | null;
  }>(UPDATE_YEAR_FINAL_DATE, { input }, options);
}

export async function readYearTournamentRow(year: number) {
  const [row] = await db
    .select({
      finalDate: yearTournaments.finalDate,
      finalDateSource: yearTournaments.finalDateSource,
      finalDateVersion: yearTournaments.finalDateVersion,
      finalDateUpdatedByAdminId: yearTournaments.finalDateUpdatedByAdminId,
    })
    .from(yearTournaments)
    .where(eq(yearTournaments.year, year));
  return row;
}

// 削除済み・招待中の管理者による変更を再現するため、最後に変更した管理者のIDと日時を直接書く
export async function markYearFinalDateUpdatedBy(
  year: number,
  adminId: string,
  at: Date,
): Promise<void> {
  await db
    .update(yearTournaments)
    .set({
      finalDateSource: 'explicit',
      finalDateVersion: 1,
      finalDateUpdatedAt: at,
      finalDateUpdatedByAdminId: adminId,
    })
    .where(eq(yearTournaments.year, year));
}

export async function readAuditLogReasons(): Promise<(string | null)[]> {
  const rows = await db
    .select({ reason: adminAuditLogs.reason })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
  return rows.map((row) => row.reason);
}
