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
# その他Git管理に含まれていないディレクトリを作成し実行時エラーを回避する。
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
  && chown -R bun:bun /workspace/apps/frontend-lib/node_modules \
  && mkdir -p /workspace/apps/db/data \
  && chown -R bun:bun /workspace/apps/db \
  && mkdir -p /workspace/apps/email \
  && chown -R bun:bun /workspace/apps/email

USER bun
WORKDIR /workspace

ENV PATH="/home/linuxbrew/.linuxbrew/bin:${PATH}"

# Homebrew のインストール時は NONINTERACTIVE=1 で確認プロンプトを抑止する。
RUN NONINTERACTIVE=1 curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash \
  && brew tap hashicorp/tap \
  && brew install hashicorp/tap/terraform cloudflare-wrangler \
  && brew install --cask claude-code \
  && brew install gh \
  && brew install rtk \
  && HOME=/home/bun RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch

CMD ["sleep", "infinity"]
