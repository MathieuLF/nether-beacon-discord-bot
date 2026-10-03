ARG ALPHA_NODE_IMAGE=node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
ARG MUSE_IMAGE=ghcr.io/museofficial/muse:2.11.7@sha256:441024557b543e5f693c2825811320f771fec7357fc40c5518a54c2da1e1c65c
ARG MUSE_NODE_IMAGE=node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
ARG FFMPEG_IMAGE=mwader/static-ffmpeg:9.0.1@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7

FROM ${ALPHA_NODE_IMAGE} AS alpha

WORKDIR /bot

RUN apk upgrade --no-cache && \
    apk add --no-cache tini && \
    addgroup --gid 10001 --system netherbeacon && \
    adduser --uid 10001 --system --disabled-password --no-create-home --ingroup netherbeacon netherbeacon && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

COPY package.json package-lock.json ./
RUN npm install --global npm@12.0.2 && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --chown=10001:10001 . /bot
RUN rm -f /bot/config/muse-package.json /bot/config/muse-yarn.lock

USER 10001:10001

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/bot.js"]

FROM ${MUSE_IMAGE} AS muse-upstream

FROM ${FFMPEG_IMAGE} AS muse-ffmpeg

FROM ${MUSE_NODE_IMAGE} AS muse-base

ARG YT_DLP_VERSION=2026.08.19
ENV MUSE_BUNDLED_YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    DATA_DIR=/data \
    NODE_ENV=production \
    ENV_FILE=/config

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates openssl python3 py3-pip tini && \
    python3 -m venv /opt/yt-dlp && \
    /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YT_DLP_VERSION}" && \
    ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp && \
    apk del py3-pip && \
    /opt/yt-dlp/bin/pip uninstall --yes pip && \
    rm -rf /usr/lib/python3.14/ensurepip

FROM muse-base AS muse-dependencies

USER root
WORKDIR /usr/app

RUN apk add --no-cache build-base

COPY --chmod=0644 config/muse-package.json ./package.json
COPY --chmod=0644 config/muse-yarn.lock ./yarn.lock
COPY --from=muse-upstream /usr/app/schema.prisma ./schema.prisma
RUN yarn install --frozen-lockfile --production --non-interactive && \
    ./node_modules/.bin/prisma generate && yarn cache clean

FROM muse-base AS muse

USER root
WORKDIR /usr/app

COPY --from=muse-upstream /usr/app/dist ./dist
COPY --from=muse-upstream /usr/app/migrations ./migrations
COPY --from=muse-upstream /usr/app/schema.prisma ./schema.prisma
COPY --from=muse-upstream /usr/app/LICENSE ./LICENSE
COPY --from=muse-dependencies /usr/app/node_modules ./node_modules
COPY --chmod=0644 config/muse-package.json ./package.json
COPY --chmod=0644 config/muse-yarn.lock ./yarn.lock
COPY --from=muse-ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=muse-ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY --from=muse-ffmpeg /versions.json /licenses/ffmpeg-versions.json
COPY config/ffmpeg-notice.txt /licenses/FFMPEG-NOTICE.txt
ADD --checksum=sha256:8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903 https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.1/COPYING.GPLv3 /licenses/GPL-3.0.txt

RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v1.22.22 && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /bot

COPY --chown=10001:10001 muse-runner.js muse-healthcheck.js /bot/
COPY --chown=10001:10001 lib/muse-env.js lib/service-health.js lib/atomic-json.js /bot/lib/

RUN addgroup --gid 10001 --system netherbeacon && \
    adduser --uid 10001 --system --disabled-password --no-create-home --ingroup netherbeacon netherbeacon && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

USER 10001:10001

RUN node -e "const fs = require('fs'); for (const path of ['/usr/app/package.json', '/usr/app/yarn.lock', '/usr/app/dist/scripts/migrate-and-start.js']) fs.accessSync(path, fs.constants.R_OK); for (const path of ['/usr/app/node_modules/.bin/prisma', '/usr/local/bin/ffmpeg', '/opt/yt-dlp/bin/yt-dlp']) fs.accessSync(path, fs.constants.R_OK | fs.constants.X_OK)"

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/muse-runner.js"]
