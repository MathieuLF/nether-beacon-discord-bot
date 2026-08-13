FROM ghcr.io/museofficial/muse:2.11.5

WORKDIR /bot

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . /bot

RUN groupadd --gid 10001 netherbeacon && \
    useradd --uid 10001 --gid 10001 --home-dir /bot --shell /usr/sbin/nologin netherbeacon && \
    install -d -o 10001 -g 10001 -m 0750 /bot/runtime /bot/peer-state

USER 10001:10001

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/bot.js"]
