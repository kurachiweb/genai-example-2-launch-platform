import type { Plugin } from 'vite';

export const LOCAL_SECRETS_FILE_NAME = '.dev.vars';

// @cloudflare/vite-pluginはビルド時に注入されたシークレットをこのファイルとしてビルド結果へ平文で書き出す。
// vite previewはビルド結果のWrangler設定のsecrets.requiredのキーをprocess.envからも読むため、出力から除いても注入の下のプレビューへ値が渡る
export function excludeLocalSecretsFile(): Plugin {
  return {
    name: 'frontend:exclude-local-secrets-file',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        Reflect.deleteProperty(bundle, LOCAL_SECRETS_FILE_NAME);
      },
    },
  };
}
