# syntax=docker/dockerfile:1
# 本番環境はCloudflare Workers(サーバーレス)で動くため、このイメージは開発専用でありデプロイしない。
FROM oven/bun:1.3-slim

# Homebrewのインストールに必要なパッケージを導入する。
# Infisical(秘密情報管理サービス)のCLIはMacでなければHomebrewからインストールできないため、公式のAPTリポジトリを登録してからapt-getでインストールする。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates build-essential procps curl file git \
  && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
  && apt-get install -y --no-install-recommends infisical \
  && rm -rf /var/lib/apt/lists/*

# Playwright・chrome-devtools MCPが起動するChromiumを導入する。
# ChromiumバイナリのOS側共有ライブラリ(libnss3等)はrootユーザーとして導入する。
# Chromium本体は`bun install`後に確定する`@playwright/test`の実バージョンに一致させる必要があるため、entrypoint.sh側でbunユーザーが導入する(不一致は`Executable doesn't exist`エラーの原因になる)。
# CHROMIUM_PATHはMCPサーバーへ実行ファイルを絶対パスで渡すための固定シンボリックリンク先。
# コンテナでは非特権ユーザー名前空間が無効でサンドボックスが起動できないため、.mcp.json側で--no-sandboxを渡す。
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CHROMIUM_PATH=/opt/ms-playwright-bin/chrome
RUN bunx --bun playwright@latest install-deps chromium \
  && mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin \
  && chown -R bun:bun ${PLAYWRIGHT_BROWSERS_PATH} /opt/ms-playwright-bin \
  && rm -rf /var/lib/apt/lists/*

# Homebrewは既定の/home/linuxbrew/.linuxbrewに置くことで、ビルド済みパッケージ(bottle)をそのまま使え、時間のかかる自前ビルドを避けられる。
# bunユーザーはsudo権限がなく自分でディレクトリを作れないため、rootのうちに作成してbun所有に変更しておく。
# RTKの初期化はClaudeの設定ディレクトリが無いと失敗するため、先に作成しておく。
# Claude、Infisical、Cloudflareのログイン情報を永続化し、コンテナ再作成時の再認証を不要にする。
# 初回コンテナビルド時にClaudeのワークスペース信頼設定(hasTrustDialogAccepted等)を設定ファイルに書き込むので、ユーザーは意識する必要がなくなる。
ENV CLAUDE_CONFIG_DIR=/home/bun/.claude
RUN mkdir -p /home/linuxbrew/.linuxbrew \
  && chown -R bun:bun /home/linuxbrew/.linuxbrew \
  && mkdir -p /home/bun/.claude \
  && printf '%s' '{"projects":{"/workspace":{"hasTrustDialogAccepted":true,"hasCompletedProjectOnboarding":true}}}' > /home/bun/.claude/.claude.json \
  && chown -R bun:bun /home/bun/.claude \
  && mkdir -p /home/bun/.infisical \
  && chown -R bun:bun /home/bun/.infisical \
  && mkdir -p /home/bun/.wrangler \
  && chown -R bun:bun /home/bun/.wrangler

# node_modulesは名前付きボリューム(node_modules_***)で分離する。
# 名前付きボリュームは中身が空だとマウント先ディレクトリの所有者をそのまま引き継ぐため、
# 非rootに切り替える前にbun所有で作成しておき、bunユーザーのbun installが書き込めるようにする(権限エラー回避)。
RUN mkdir -p /workspace/node_modules \
  && chown -R bun:bun /workspace/node_modules \
  && mkdir -p /workspace/apps/api/node_modules \
  && chown -R bun:bun /workspace/apps/api/node_modules \
  && mkdir -p /workspace/apps/public-api/node_modules \
  && chown -R bun:bun /workspace/apps/public-api/node_modules \
  && mkdir -p /workspace/apps/db/node_modules \
  && chown -R bun:bun /workspace/apps/db/node_modules \
  && mkdir -p /workspace/apps/client/node_modules \
  && chown -R bun:bun /workspace/apps/client/node_modules \
  && mkdir -p /workspace/apps/admin/node_modules \
  && chown -R bun:bun /workspace/apps/admin/node_modules \
  && mkdir -p /workspace/apps/frontend-lib/node_modules \
  && chown -R bun:bun /workspace/apps/frontend-lib/node_modules

USER bun
WORKDIR /workspace

ENV PATH="/home/linuxbrew/.linuxbrew/bin:${PATH}"

# Homebrewのインストール時は`NONINTERACTIVE=1`で確認プロンプトを抑止する。
# `node`パッケージはアプリケーションコードの実行には使わないもののWrangler CLIが必要としているため、バージョン管理しやすいよう明示的にインストールする。
RUN NONINTERACTIVE=1 curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash \
  && brew tap hashicorp/tap \
  && brew install hashicorp/tap/terraform cloudflare-wrangler gh rtk mailpit node \
  && brew install --cask claude-code \
  && HOME=/home/bun RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch

# コンテナ起動時のセットアップ処理はスクリプトへ切り出す。
COPY --chmod=755 scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

# entrypoint.shは`.`(source)で読み込む。別プロセスとして実行すると常駐プロセスがPID1(docker-init)の子であるshの子でなくなり、スクリプト内のtrapもスクリプト終了時に失われるため、停止時にMailpitへSIGTERMを転送できなくなる。
# `sleep infinity`は「何もせず永遠に待ち続けるだけ」のコマンドで、これをバックグラウンドで動かし続けることでPID1のshを終了させず、コンテナを生かし続ける(Mailpitが落ちてもコンテナは生存する)。
# `wait $!`は直前にバックグラウンド実行した`sleep infinity`の終了を待つ組み込みコマンドで、シグナル(SIGTERMなど)を受けると即座に中断されるため、コンテナ停止時にスクリプト内の`trap`をすぐ発火できる。
CMD ["sh", "-c", ". /usr/local/bin/entrypoint.sh; sleep infinity & wait $!"]
