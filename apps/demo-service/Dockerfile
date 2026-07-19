FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/demo-service/package.json apps/demo-service/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN npm ci
COPY apps/demo-service apps/demo-service
COPY packages/shared packages/shared
COPY packages/sdk packages/sdk
RUN npm run build -w @queue-monitor/shared && npm run build -w @queue-monitor/node && npm run build -w @queue-monitor/demo-service
CMD ["npm", "run", "start", "-w", "@queue-monitor/demo-service"]
