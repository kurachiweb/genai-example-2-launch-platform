import {
  type MatchFields,
  MATCH_SELECTION,
} from './match-graphql-operations.ts';
import type {
  MediaImageFields,
  ProductAwardFields,
  ProductCategoryFields,
} from './product-graphql-documents.ts';

export interface UserSummaryFields {
  readonly handle: string;
  readonly nickname: string;
  readonly avatar: { readonly id: string } | null;
}

export interface ProductPageOpponentFields {
  readonly kind: 'NONE' | 'PRIVATE' | 'UNLISTED' | 'LISTED';
  readonly handle: string | null;
  readonly name: string | null;
  readonly logo: MediaImageFields | null;
}

export interface ProductPageMatchFields {
  readonly id: string;
  readonly entryId: string;
  readonly kind: MatchFields['kind'];
  readonly round: number | null;
  readonly stage: MatchFields['stage'];
  readonly date: string;
  readonly result: 'WON' | 'LOST' | 'BYE' | 'WALKOVER';
  readonly decision: NonNullable<MatchFields['decision']>;
  readonly endedEarly: boolean;
  readonly ownUpvoteCount: number;
  readonly opponentUpvoteCount: number | null;
  readonly opponent: ProductPageOpponentFields;
}

export interface ProductPageLaunchFields {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  readonly kickoffAt: string;
  readonly status:
    'SCHEDULED' | 'PAIRED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELED';
  readonly summary: { readonly label: string; readonly inMatch: boolean };
  readonly kickedOff: boolean;
  readonly latestKickedOff: boolean;
  readonly matches: readonly ProductPageMatchFields[];
}

export interface ProductPageFields {
  readonly __typename: 'ProductPage';
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryFields;
  readonly websiteUrl: string;
  readonly logo: MediaImageFields | null;
  readonly description: string;
  readonly screenshots: readonly {
    readonly fileId: string;
    readonly image: MediaImageFields | null;
  }[];
  readonly owner: UserSummaryFields;
  readonly viewerIsOwner: boolean;
  readonly listed: boolean;
  readonly awards: readonly ProductAwardFields[];
  readonly record: {
    readonly firstLaunchDate: string | null;
    readonly launchCount: number;
    readonly wins: number;
    readonly losses: number;
  };
  readonly launches: readonly ProductPageLaunchFields[];
}

export interface ProductPageRedirectFields {
  readonly __typename: 'ProductPageRedirect';
  readonly handle: string;
}

export interface ProductLiveMatchFields {
  readonly serverTime: string;
  readonly match: MatchFields | null;
  readonly awaitingChange: boolean;
}

export interface SupporterConnectionFields {
  readonly nodes: readonly UserSummaryFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

// GraphQL Armorの深さの上限(8)はフラグメントの展開も1段に数えるため、項目を直接書き、最も深い対戦相手のロゴを7段に収める
export const PRODUCT_PAGE = /* GraphQL */ `
  query ProductPage($handle: String!) {
    productPage(handle: $handle) {
      __typename
      ... on ProductPageRedirect {
        handle
      }
      ... on ProductPage {
        id
        handle
        name
        tagline
        category {
          id
          name
          handle
          systemDefault
        }
        websiteUrl
        logo {
          id
          objectKey
        }
        description
        screenshots {
          fileId
          image {
            id
            objectKey
          }
        }
        owner {
          handle
          nickname
          avatar {
            id
          }
        }
        viewerIsOwner
        listed
        awards {
          kind
          count
          labels
        }
        record {
          firstLaunchDate
          launchCount
          wins
          losses
        }
        launches {
          id
          number
          launchDate
          kickoffAt
          status
          summary {
            label
            inMatch
          }
          kickedOff
          latestKickedOff
          matches {
            id
            entryId
            kind
            round
            stage
            date
            result
            decision
            endedEarly
            ownUpvoteCount
            opponentUpvoteCount
            opponent {
              kind
              handle
              name
              logo {
                id
                objectKey
              }
            }
          }
        }
      }
    }
  }
`;

export const PRODUCT_LIVE_MATCH = /* GraphQL */ `
  query ProductLiveMatch($productHandle: String!) {
    productLiveMatch(productHandle: $productHandle) {
      serverTime
      match {
        ${MATCH_SELECTION}
      }
      awaitingChange
    }
  }
`;

export const MATCH_SUPPORTERS = /* GraphQL */ `
  query MatchSupporters(
    $productHandle: String!
    $matchId: ID!
    $entryId: ID!
    $first: Int!
    $after: String
  ) {
    matchSupporters(
      productHandle: $productHandle
      matchId: $matchId
      entryId: $entryId
      first: $first
      after: $after
    ) {
      nodes {
        handle
        nickname
        avatar {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
