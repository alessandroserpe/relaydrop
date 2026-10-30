FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 RELAYDROP_DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node skills ./skills
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 8787
CMD ["node", "src/server.mjs"]
