import {
  DATE_TIME_DESCRIPTION,
  DATE_TIME_SCALAR_NAME,
} from './date-time-scalar.ts';

export const PLATFORM_TYPE_DEFS = /* GraphQL */ `
  "${DATE_TIME_DESCRIPTION}"
  scalar ${DATE_TIME_SCALAR_NAME}

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type OffsetPageInfo {
    page: Int!
    perPage: Int!
    totalCount: Int!
    totalPages: Int!
  }
`;
