import { z } from 'zod';

import {
  type ReporterKind,
  requiresContactEmail,
} from '../../../../../common-lib/reporting/report-rules.ts';
import type {
  ReportCategoryService,
  ReportSubmissionService,
} from '../../../../application/reporting/ports.ts';
import { reportContactEmailRequiredError } from '../../../../application/reporting/reporting-errors.ts';
import { REPORTING_TYPES } from '../../../../application/reporting/reporting-types.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_ARGUMENT, reportContactEmailFormatError } from './errors.ts';
import { SUBMIT_REPORT_ARGS } from './inputs.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

// 利用者側の画面が通報のフォームのbot判定の部品に渡す操作名と同じにする
export const REPORT_BOT_ACTION = 'report';

const categoryServiceOf = (context: GraphQLContext): ReportCategoryService =>
  context.resolve<ReportCategoryService>(REPORTING_TYPES.ReportCategoryService);

const submissionServiceOf = (
  context: GraphQLContext,
): ReportSubmissionService =>
  context.resolve<ReportSubmissionService>(
    REPORTING_TYPES.ReportSubmissionService,
  );

// 停止中の利用者は通報者として記録しないため、ユースケースと同じく未ログインと同じguestにする
async function reporterKindOf(context: GraphQLContext): Promise<ReporterKind> {
  const current = await accountGuardOf(context).currentUser(context.session);
  return current?.user.status === 'active' ? 'member' : 'guest';
}

// 要らない連絡先は、カテゴリの選び直しやログインの後に残った値で通報を拒否しないよう、形式を確かめずに捨てる
function contactEmailFor(
  reporterKind: ReporterKind,
  input: {
    readonly categoryId: string;
    readonly contactEmail: string | undefined;
  },
): string | undefined {
  if (!requiresContactEmail({ reporterKind, categoryId: input.categoryId })) {
    return undefined;
  }
  if (input.contactEmail === undefined) {
    throw reportContactEmailRequiredError();
  }
  if (!z.regexes.html5Email.test(input.contactEmail)) {
    throw reportContactEmailFormatError();
  }
  return input.contactEmail;
}

// 送信は呼び出し元→入力の形式→連絡先の要否と形式→bot判定→ユースケースの順に行い、トークンを使わずに拒否できる要求でトークンを消費させない
export const submissionResolvers = {
  Query: {
    reportCategories: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext,
    ) => [...(await categoryServiceOf(context).listForForm())],
  },
  Mutation: {
    submitReport: clientOnly(
      withValidatedArgs(
        SUBMIT_REPORT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const now = clockOf(context).now();
          const reporterKind = await reporterKindOf(context);
          await withInputPath(INPUT_ARGUMENT, async () => {
            const contactEmail = contactEmailFor(reporterKind, input);
            await context.assertHuman(REPORT_BOT_ACTION);
            await submissionServiceOf(context).submit(
              context.session,
              { ...input, contactEmail },
              { clientIp: context.clientIp, now },
            );
          });
          return { accepted: true };
        },
      ),
    ),
  },
} satisfies Resolvers;
