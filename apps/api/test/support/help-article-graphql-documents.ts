export interface HelpArticleAuthorFields {
  readonly nickname: string;
  readonly title: string | null;
  readonly avatar: {
    readonly id: string;
    readonly objectKey: string | null;
  } | null;
}

export interface AdminHelpArticleRowFields {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly pinned: boolean;
  readonly sortOrder: number;
  readonly creatorAdminId: string;
  readonly creator: HelpArticleAuthorFields | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminHelpArticleFields {
  readonly id: string;
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly pinned: boolean;
  readonly creator: HelpArticleAuthorFields | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const HELP_ARTICLE_AUTHOR_FIELDS = /* GraphQL */ `
  nickname
  title
  avatar {
    id
    objectKey
  }
`;

const ADMIN_HELP_ARTICLE_ROW_FIELDS = /* GraphQL */ `
  id
  handle
  title
  categoryId
  categoryName
  status
  pinned
  sortOrder
  creatorAdminId
  creator {
    ${HELP_ARTICLE_AUTHOR_FIELDS}
  }
  createdAt
  updatedAt
`;

const ADMIN_HELP_ARTICLE_FIELDS = /* GraphQL */ `
  id
  handle
  previousHandle
  title
  subtitle
  body
  categoryId
  categoryName
  status
  pinned
  creator {
    ${HELP_ARTICLE_AUTHOR_FIELDS}
  }
  revision
  createdAt
  updatedAt
`;

export const ADMIN_HELP_ARTICLES = /* GraphQL */ `
  query AdminHelpArticles {
    adminHelpArticles {
      ${ADMIN_HELP_ARTICLE_ROW_FIELDS}
    }
  }
`;

export const ADMIN_HELP_ARTICLE = /* GraphQL */ `
  query AdminHelpArticle($id: ID!) {
    adminHelpArticle(id: $id) {
      ${ADMIN_HELP_ARTICLE_FIELDS}
    }
  }
`;

export const HELP_ARTICLE_HANDLE_AVAILABILITY = /* GraphQL */ `
  query AdminHelpArticleHandleAvailability($handle: String!, $articleId: ID) {
    helpArticleHandleAvailability(handle: $handle, articleId: $articleId)
  }
`;

export const CREATE_HELP_ARTICLE = /* GraphQL */ `
  mutation AdminCreateHelpArticle($input: CreateHelpArticleInput!) {
    createHelpArticle(input: $input) {
      ${ADMIN_HELP_ARTICLE_FIELDS}
    }
  }
`;

export const UPDATE_HELP_ARTICLE = /* GraphQL */ `
  mutation AdminUpdateHelpArticle($input: UpdateHelpArticleInput!) {
    updateHelpArticle(input: $input) {
      ${ADMIN_HELP_ARTICLE_FIELDS}
    }
  }
`;

export const DELETE_HELP_ARTICLE = /* GraphQL */ `
  mutation AdminDeleteHelpArticle($id: ID!, $reason: String) {
    deleteHelpArticle(id: $id, reason: $reason) {
      id
    }
  }
`;

export const REORDER_HELP_ARTICLES = /* GraphQL */ `
  mutation AdminReorderHelpArticles($categoryId: ID!, $orderedIds: [ID!]!) {
    reorderHelpArticles(categoryId: $categoryId, orderedIds: $orderedIds) {
      ${ADMIN_HELP_ARTICLE_ROW_FIELDS}
    }
  }
`;

export const HELP_ARTICLE_DOCUMENTS = [
  ADMIN_HELP_ARTICLES,
  ADMIN_HELP_ARTICLE,
  HELP_ARTICLE_HANDLE_AVAILABILITY,
  CREATE_HELP_ARTICLE,
  UPDATE_HELP_ARTICLE,
  DELETE_HELP_ARTICLE,
  REORDER_HELP_ARTICLES,
] as const;
