import type { CodegenConfig } from '@graphql-codegen/cli';

const GENERATED_DIR = 'src/graphql/generated/';

// 操作を.graphqlに書くのは、TypeScriptのgraphql()の呼び出しでは操作の本文が文字列としてブラウザのバンドルに入るため。画面は本文を持たない文書を生成物のgraphql.tsから読み込む
// 出力先の操作の一覧(persisted-documents.json)は、apiの許可リストの生成が読む場所(ALLOWLIST_SOURCES)と一致させる
const config: CodegenConfig = {
  schema: '../api/src/presentation/graphql/generated/schema.graphql',
  documents: ['src/**/*.graphql'],
  generates: {
    [GENERATED_DIR]: {
      preset: 'client',
      presetConfig: {
        persistedDocuments: { mode: 'replaceDocumentWithHash' },
        fragmentMasking: false,
      },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        strictScalars: true,
        scalars: { DateTime: 'string' },
      },
    },
  },
};

export default config;
