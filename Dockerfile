FROM ghcr.io/museofficial/muse:2.11.5

WORKDIR /bot

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . /bot

ENTRYPOINT ["tini", "--"]
CMD ["node", "/bot/supervisor.js"]
