# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

ARG OPENCODE_VERSION=1.18.31
RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" \
  && opencode --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data /workspace
VOLUME ["/app/data"]

EXPOSE 4096
CMD ["node", "dist/index.js"]
