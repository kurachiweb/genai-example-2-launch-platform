import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminYearFinalDateSettingsDocument,
  type AdminYearFinalDateSettingsQuery,
} from './generated/graphql.ts';

export type AdminYearFinalDateSettings =
  AdminYearFinalDateSettingsQuery['yearFinalDateSettings'];

export type AdminYearFinalDateSetting =
  AdminYearFinalDateSettings['settings'][number];

export const adminYearFinalDateSettingsQueryOptions = () =>
  graphqlQueryOptions(AdminYearFinalDateSettingsDocument, {});
