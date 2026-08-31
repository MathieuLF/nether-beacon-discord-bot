ARG ALPHA_NODE_IMAGE=node:24-alpine
ARG MUSE_IMAGE=ghcr.io/museofficial/muse:2.11.7

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

RUN node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); pkg.resolutions=Object.assign({}, pkg.resolutions || {}, {'form-data':'4.0.6', tar:'7.5.19', esbuild:'0.25.7'}); fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');" && \
    yarn install --production --ignore-scripts --non-interactive && \
    yarn cache clean && \
    npm install -g npm@12.0.2 && \
    npm cache clean --force

WORKDIR /bot

COPY package.json package-lock.json ./
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci --omit=dev && \
    npm cache clean --force

COPY --chown=10001:10001 . /bot

RUN if ! getent group 10001 >/dev/null; then groupadd --gid 10001 netherbeacon; fi && \
    if ! getent passwd 10001 >/dev/null; then useradd --uid 10001 --gid 10001 --home-dir /bot --shell /usr/sbin/nologin netherbeacon; fi && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

USER 10001:10001

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/muse-runner.js"]
