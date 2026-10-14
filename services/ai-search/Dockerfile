FROM node:20.18.0-alpine3.20
WORKDIR /app
COPY api ./api
COPY lib ./lib
COPY services/ai-search ./services/ai-search
USER node
EXPOSE 8080
CMD ["node", "services/ai-search/server.mjs"]
