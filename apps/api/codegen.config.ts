import type { CodegenConfig } from '@graphql-codegen/cli';

const GENERATED_DIR = 'src/presentation/graphql/generated';

const config: CodegenConfig = {
  schema: `${GENERATED_DIR}/schema.graphql`,
  generates: {
    [`${GENERATED_DIR}/resolvers-types.ts`]: {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useTypeImports: true,
        contextType: '../graphql-context.ts#GraphQLContext',
        scalars: { DateTime: { input: 'number', output: 'number | Date' } },
        strictScalars: true,
        enumsAsTypes: true,
        // 項目のリゾルバが要求されたときだけ読む項目を持たない形を、親の値の型にする
        mappers: {
          Viewer: '../modules/identity/resolver-support.ts#ViewerSource',
        },
      },
    },
  },
};

export default config;
