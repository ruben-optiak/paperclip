FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8788
CMD ["node", "src/main.mjs"]
