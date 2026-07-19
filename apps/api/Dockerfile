FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/demo-service/package.json apps/demo-service/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN npm ci
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build -w @queue-monitor/shared && npm run build -w @queue-monitor/api
CMD ["sh", "-c", "npm run db:migrate -w @queue-monitor/api && npm run db:seed -w @queue-monitor/api && npm run start -w @queue-monitor/api"]
