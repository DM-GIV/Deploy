# Node.js 24 LTS (Alpine), pinned by digest (pulled and verified 2026-10-15).
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /app
COPY api ./api
COPY lib ./lib
COPY config ./config
COPY services/ai-search ./services/ai-search
USER node
EXPOSE 8080
CMD ["node", "services/ai-search/server.mjs"]
