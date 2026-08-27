FROM node:22.14.0-alpine3.21

WORKDIR /app

COPY --chown=node:node server.mjs ./server.mjs

ENV NODE_ENV=production \
    MOCK_HOST=0.0.0.0 \
    MOCK_PORT=8080

USER node

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "server.mjs"]
