# syntax=docker/dockerfile:1
# 本番環境はCloudflare Workers(サーバーレス)で動くため、このイメージは開発専用でありデプロイしない。
FROM oven/bun:1.3-slim

# Homebrewのインストールに必要なパッケージを導入する。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates build-essential procps curl file git \
  && rm -rf /var/lib/apt/lists/*

# Homebrewは既定の/home/linuxbrew/.linuxbrewに置くことで、ビルド済みパッケージ(bottle)をそのまま使え、時間のかかる自前ビルドを避けられる。
# bunユーザーはsudo権限がなく自分でディレクトリを作れないため、rootのうちに作成してbun所有に変更しておく。
# RTKの初期化はClaudeの設定ディレクトリが無いと失敗するため、先に作成しておく。
RUN mkdir -p /home/linuxbrew/.linuxbrew \
  && chown -R bun:bun /home/linuxbrew/.linuxbrew \
  && mkdir -p /home/bun/.claude \
  && chown -R bun:bun /home/bun/.claude

# node_modules は名前付きボリューム(node_modules_***)で分離する。
# 名前付きボリュームは中身が空だとマウント先ディレクトリの所有者をそのまま引き継ぐため、
# 非rootに切り替える前にbun所有で作成しておき、bunユーザーのbun installが書き込めるようにする(権限エラー回避)。
RUN mkdir -p /workspace/node_modules \
  && chown -R bun:bun /workspace/node_modules \
  && mkdir -p /workspace/apps/api/node_modules \
  && chown -R bun:bun /workspace/apps/api/node_modules \
  && mkdir -p /workspace/apps/public-api/node_modules \
  && chown -R bun:bun /workspace/apps/public-api/node_modules \
  && mkdir -p /workspace/apps/client/node_modules \
  && chown -R bun:bun /workspace/apps/client/node_modules \
  && mkdir -p /workspace/apps/admin/node_modules \
  && chown -R bun:bun /workspace/apps/admin/node_modules \
  && mkdir -p /workspace/apps/frontend-lib/node_modules \
  && chown -R bun:bun /workspace/apps/frontend-lib/node_modules

USER bun
WORKDIR /workspace

ENV PATH="/home/linuxbrew/.linuxbrew/bin:${PATH}"

# Homebrew のインストール時は NONINTERACTIVE=1 で確認プロンプトを抑止する。
# ビルド毎に最新のbrewパッケージをインストールする。
RUN NONINTERACTIVE=1 curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash \
  && brew tap hashicorp/tap \
  && brew update \
  && brew install hashicorp/tap/terraform cloudflare-wrangler gh rtk valkey mailpit \
  && brew install --cask claude-code \
  && HOME=/home/bun RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch

# Claude Codeのワークスペース信頼設定はコンテナ起動のたびに必要なため、常駐プロセスの起動より前に実行する。
# bindマウントで隠れない/usr/local/binへ置くことで、マウントの有無に依らず同じ内容が使われる(スクリプト更新時は要`--build`)。
COPY --chmod=755 scripts/claude-trust-plugins.sh /usr/local/bin/claude-trust-plugins.sh

# ローカル開発用常駐プロセスの起動処理はスクリプトへ切り出す。
COPY --chmod=755 scripts/start-local-services.sh /usr/local/bin/start-local-services.sh

# start-local-services.shは`.`(source)で読み込む。別プロセスとして実行すると常駐プロセスがPID1のshの子でなくなり、スクリプト内のtrapもスクリプト終了時に失われるため、停止時にValkeyへSIGTERMを転送できなくなる。
# `sleep infinity`は「何もせず永遠に待ち続けるだけ」のコマンドで、これをバックグラウンドで動かし続けることでPID1のshを終了させず、コンテナを生かし続ける(ValkeyやMailpitが落ちてもコンテナは生存する)。
# `wait $!`は直前にバックグラウンド実行した`sleep infinity`の終了を待つ組み込みコマンドで、シグナル(SIGTERMなど)を受けると即座に中断されるため、コンテナ停止時にスクリプト内の`trap`をすぐ発火できる。
CMD ["sh", "-c", "/usr/local/bin/claude-trust-plugins.sh; . /usr/local/bin/start-local-services.sh; sleep infinity & wait $!"]
