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
      },
    },
  },
};

export default config;
