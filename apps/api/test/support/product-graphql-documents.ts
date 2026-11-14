export interface MediaImageFields {
  readonly id: string;
  readonly objectKey: string | null;
}

export interface ProductCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly systemDefault: boolean;
}

export interface ProductLaunchFields {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  readonly kickoffAt: string;
  readonly status:
    'SCHEDULED' | 'PAIRED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELED';
  readonly outcome: 'WON' | 'LOST' | null;
  readonly summary: { readonly label: string; readonly inMatch: boolean };
}

export interface LaunchDateWindowFields {
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: readonly {
    readonly from: string;
    readonly to: string;
    readonly reason: 'PAIRING_DEADLINE' | 'RELAUNCH_INTERVAL' | 'OUT_OF_RANGE';
  }[];
  readonly relaunchIntervalDays: number | null;
}

export interface ProductLaunchPlanFields {
  readonly mode: 'NEW' | 'RESCHEDULE' | 'BLOCKED' | 'UNKNOWN';
  readonly currentLaunchDate: string | null;
  readonly window: LaunchDateWindowFields | null;
  readonly blocks: readonly {
    readonly code: string;
    readonly message: string;
    readonly releaseAt: string | null;
  }[];
  readonly locked: boolean;
  readonly locks: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly lockUnknown: boolean;
  readonly ultrasEntitled: boolean;
}

export interface MyProductFields {
  readonly __typename: 'MyProduct';
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryFields;
  readonly websiteUrl: string;
  readonly description: string;
  readonly logoFileId: string;
  readonly logo: MediaImageFields | null;
  readonly screenshots: readonly {
    readonly fileId: string;
    readonly image: MediaImageFields | null;
    readonly byteSize: number;
  }[];
  readonly hidden: boolean;
  readonly listed: boolean;
  readonly version: number;
  readonly latestLaunch: ProductLaunchFields | null;
  readonly plan: ProductLaunchPlanFields;
}

export interface MyProductRedirectFields {
  readonly __typename: 'MyProductRedirect';
  readonly handle: string;
}

export interface MyProductConnectionFields {
  readonly nodes: readonly MyProductFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface ProductOwnerStatusFields {
  readonly latestLaunch: ProductLaunchFields | null;
  readonly plan: ProductLaunchPlanFields;
}

export type HandleAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';

export interface ProductAwardFields {
  readonly kind: 'WEEK' | 'YEAR';
  readonly count: number;
  readonly labels: readonly string[];
}

export interface LaunchHistoryItemFields {
  readonly product: {
    readonly handle: string;
    readonly name: string;
    readonly tagline: string;
    readonly category: ProductCategoryFields;
    readonly websiteUrl: string;
    readonly logo: MediaImageFields | null;
    readonly listed: boolean;
  };
  readonly launches: readonly ProductLaunchFields[];
  readonly awards: readonly ProductAwardFields[];
}

export interface LaunchHistoryConnectionFields {
  readonly viewerIsOwner: boolean;
  readonly ownerSuspended: boolean;
  readonly totalCount: number;
  readonly nodes: readonly LaunchHistoryItemFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

const LAUNCH_FIELDS = /* GraphQL */ `
  id
  number
  launchDate
  kickoffAt
  status
  outcome
  summary {
    label
    inMatch
  }
`;

const WINDOW_FIELDS = /* GraphQL */ `
  earliest
  latest
  unavailable {
    from
    to
    reason
  }
  relaunchIntervalDays
`;

const PLAN_FIELDS = /* GraphQL */ `
  mode
  currentLaunchDate
  window {
    ${WINDOW_FIELDS}
  }
  blocks {
    code
    message
    releaseAt
  }
  locked
  locks {
    code
    message
  }
  lockUnknown
  ultrasEntitled
`;

const MY_PRODUCT_FIELDS = /* GraphQL */ `
  __typename
  handle
  previousHandle
  name
  tagline
  category {
    id
    name
    handle
    systemDefault
  }
  websiteUrl
  description
  logoFileId
  logo {
    id
    objectKey
  }
  screenshots {
    fileId
    image {
      id
      objectKey
    }
    byteSize
  }
  hidden
  listed
  version
  latestLaunch {
    ${LAUNCH_FIELDS}
  }
  plan {
    ${PLAN_FIELDS}
  }
`;

export const MY_PRODUCTS = /* GraphQL */ `
  query ClientMyProducts($first: Int!, $after: String) {
    myProducts(first: $first, after: $after) {
      nodes {
        ${MY_PRODUCT_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const MY_PRODUCT = /* GraphQL */ `
  query ClientMyProduct($handle: String!) {
    myProduct(handle: $handle) {
      __typename
      ... on MyProduct {
        ${MY_PRODUCT_FIELDS}
      }
      ... on MyProductRedirect {
        handle
      }
    }
  }
`;

export const NEW_PRODUCT_LAUNCH_WINDOW = /* GraphQL */ `
  query ClientNewProductLaunchWindow {
    newProductLaunchWindow {
      ${WINDOW_FIELDS}
    }
  }
`;

export const PRODUCT_HANDLE_AVAILABILITY = /* GraphQL */ `
  query ClientProductHandleAvailability(
    $handle: String!
    $productHandle: String
  ) {
    productHandleAvailability(handle: $handle, productHandle: $productHandle)
  }
`;

export const PRODUCT_OWNER_STATUS = /* GraphQL */ `
  query ClientProductOwnerStatus($productHandle: String!) {
    productOwnerStatus(productHandle: $productHandle) {
      latestLaunch {
        ${LAUNCH_FIELDS}
      }
      plan {
        ${PLAN_FIELDS}
      }
    }
  }
`;

export const REGISTER_PRODUCT = /* GraphQL */ `
  mutation ClientRegisterProduct($input: RegisterProductInput!) {
    registerProduct(input: $input) {
      ${MY_PRODUCT_FIELDS}
    }
  }
`;

export const UPDATE_PRODUCT = /* GraphQL */ `
  mutation ClientUpdateProduct($input: UpdateProductInput!) {
    updateProduct(input: $input) {
      ${MY_PRODUCT_FIELDS}
    }
  }
`;

export const DELETE_PRODUCT = /* GraphQL */ `
  mutation ClientDeleteProduct(
    $productHandle: String!
    $expectedVersion: Int!
  ) {
    deleteProduct(
      productHandle: $productHandle
      expectedVersion: $expectedVersion
    )
  }
`;

const CATEGORY_FIELDS = /* GraphQL */ `
  id
  name
  handle
  systemDefault
`;

export const LAUNCH_HISTORY = /* GraphQL */ `
  query ClientLaunchHistory(
    $userHandle: String!
    $first: Int!
    $after: String
  ) {
    launchHistory(userHandle: $userHandle, first: $first, after: $after) {
      viewerIsOwner
      ownerSuspended
      totalCount
      nodes {
        product {
          handle
          name
          tagline
          category {
            ${CATEGORY_FIELDS}
          }
          websiteUrl
          logo {
            id
            objectKey
          }
          listed
        }
        launches {
          ${LAUNCH_FIELDS}
        }
        awards {
          kind
          count
          labels
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCT_CATEGORIES = /* GraphQL */ `
  query ProductCategories {
    productCategories {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const ADMIN_PRODUCT_CATEGORIES = /* GraphQL */ `
  query AdminProductCategories {
    adminProductCategories {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const CREATE_PRODUCT_CATEGORY = /* GraphQL */ `
  mutation AdminCreateProductCategory(
    $input: ProductCategoryInput!
    $reason: String
  ) {
    createProductCategory(input: $input, reason: $reason) {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const UPDATE_PRODUCT_CATEGORY = /* GraphQL */ `
  mutation AdminUpdateProductCategory(
    $id: ID!
    $input: ProductCategoryInput!
    $reason: String
  ) {
    updateProductCategory(id: $id, input: $input, reason: $reason) {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const DELETE_PRODUCT_CATEGORY = /* GraphQL */ `
  mutation AdminDeleteProductCategory($id: ID!, $reason: String) {
    deleteProductCategory(id: $id, reason: $reason)
  }
`;

export const PROFILE_AWARDS = /* GraphQL */ `
  query ClientProfileAwards($userHandle: String!) {
    profileAwards(userHandle: $userHandle) {
      kind
      count
      labels
    }
  }
`;
