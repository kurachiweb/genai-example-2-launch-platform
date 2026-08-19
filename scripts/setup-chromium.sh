#!/bin/sh
set -eu

# Playwright・chrome-devtools MCPが必要とするChromiumを導入する。
# Chromium本体は`bun install`で解決された`@playwright/test`の実際のバージョンに追従させる必要があるため、イメージビルド時ではなくこのスクリプトの実行時に都度インストールする。該当リビジョンが既にあれば再ダウンロードは行われない。

# `bunx --bun playwright`はカレントディレクトリの`node_modules`を解決するため、Playwrightがインストールされている位置に移る。
cd /workspace

if [ ! -x /workspace/node_modules/.bin/playwright ]; then
  echo 'Playwrightが未インストールのためChromiumのセットアップをスキップしました。ルートディレクトリで`bun install`を実行してから、このスクリプトを再実行してください。' >&2
  exit 0
fi

if ! { bunx --bun playwright install chromium \
  && ln -sf "$(bunx --bun node -e "process.stdout.write(require('playwright-core').chromium.executablePath())")" "${CHROMIUM_PATH}" \
  && "${CHROMIUM_PATH}" --version >/dev/null; }; then
  echo "Chromiumの起動確認に失敗しました。CHROMIUM_PATH=${CHROMIUM_PATH}" >&2
  echo "OS側共有ライブラリとChromium本体のバージョンが不整合の可能性があります。DockerfileのPLAYWRIGHT_VERSIONを@playwright/testの実バージョンに合わせて更新し、イメージを再ビルドしてください。" >&2
  exit 1
fi
