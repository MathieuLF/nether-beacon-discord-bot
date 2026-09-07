ARG ALPHA_NODE_IMAGE=node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
ARG MUSE_IMAGE=ghcr.io/museofficial/muse:2.11.7@sha256:441024557b543e5f693c2825811320f771fec7357fc40c5518a54c2da1e1c65c

FROM ${ALPHA_NODE_IMAGE} AS alpha

WORKDIR /bot

RUN apk add --no-cache tini && \
    addgroup --gid 10001 --system netherbeacon && \
    adduser --uid 10001 --system --disabled-password --no-create-home --ingroup netherbeacon netherbeacon && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=10001:10001 . /bot

USER 10001:10001

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/bot.js"]

FROM ${MUSE_IMAGE} AS muse

USER root
WORKDIR /usr/app

COPY config/muse-package.json ./package.json
COPY config/muse-yarn.lock ./yarn.lock
RUN yarn install --frozen-lockfile --production --ignore-scripts --non-interactive && \
    yarn cache clean && \
    npm install -g npm@12.0.2 && \
    npm cache clean --force

WORKDIR /bot

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

COPY --chown=10001:10001 muse-runner.js muse-healthcheck.js /bot/
COPY --chown=10001:10001 lib/muse-env.js lib/service-health.js lib/atomic-json.js /bot/lib/

RUN if ! getent group 10001 >/dev/null; then groupadd --gid 10001 netherbeacon; fi && \
    if ! getent passwd 10001 >/dev/null; then useradd --uid 10001 --gid 10001 --home-dir /bot --shell /usr/sbin/nologin netherbeacon; fi && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

USER 10001:10001

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/muse-runner.js"]
