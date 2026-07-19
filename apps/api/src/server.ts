import process from "node:process";
import pg from "pg";
import { Server as SocketServer } from "socket.io";
import type { IngestEvent } from "@queue-monitor/shared";
import { parseCookies, SESSION_COOKIE, verifySessionToken } from "./auth.js";
import { buildApp, hashApiKey } from "./app.js";
import { loadApiConfig } from "./config.js";
import { PostgresEventStore } from "./store.js";
import { createInvitationSender, createPasswordResetSender } from "./email.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const config = loadApiConfig();

const pool = new pg.Pool({ connectionString: config.databaseUrl, application_name: "queue-monitor-api" });
const store = new PostgresEventStore(pool);
let publishAcceptedEvents = (_environmentId: string, _events: IngestEvent[]): void => {};
const app = buildApp({
  store,
  jwtSecret: config.jwtSecret,
  secureCookies: config.secureCookies,
  logger: {
    level: config.logLevel,
    base: { service: "queue-monitor-api", environment: config.nodeEnvironment },
  },
  telemetryDataAllowlist: config.telemetryDataAllowlist,
  version: {
    version: config.version,
    gitCommitSha: config.gitCommitSha,
    buildTimestamp: config.buildTimestamp,
    environment: config.nodeEnvironment,
  },
  onEventsAccepted: (environmentId, events) => publishAcceptedEvents(environmentId, events),
  inviteBaseUrl: config.appUrl,
  sendInvitation: createInvitationSender(config.smtp),
  sendPasswordReset: createPasswordResetSender(config.smtp),
  enforceHttps: config.enforceHttps,
  trustProxy: config.trustProxy,
  maxRequestBytes: config.maxRequestBytes,
  maxEventBytes: config.maxEventBytes,
  maxBatchSize: config.maxBatchSize,
  maxNestingDepth: config.maxNestingDepth,
});

const io = new SocketServer(app.server, {
  path: "/socket.io",
  cors: config.webOrigin
    ? { origin: config.webOrigin, credentials: true }
    : undefined,
});

io.use(async (socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
  const session = token ? verifySessionToken(token, config.jwtSecret) : null;
  if (!token || !session || !(await store.isSessionActive(session.sid, session.sub, hashApiKey(token)))) {
    return next(new Error("authentication required"));
  }
  socket.data.userId = session.sub;
  return next();
});

io.on("connection", (socket) => {
  socket.on(
    "environment:subscribe",
    async (environmentId: unknown, acknowledge?: (value: { ok: boolean; error?: string }) => void) => {
      if (
        typeof environmentId !== "string" ||
        !UUID_RE.test(environmentId) ||
        !(await store.getEnvironmentAccess(socket.data.userId as string, environmentId))
      ) {
        acknowledge?.({ ok: false, error: "environment access denied" });
        return;
      }
      for (const room of socket.rooms) {
        if (room.startsWith("environment:")) await socket.leave(room);
      }
      await socket.join(`environment:${environmentId}`);
      acknowledge?.({ ok: true });
    },
  );
});

publishAcceptedEvents = (environmentId, events) => {
  io.to(`environment:${environmentId}`).emit("events:accepted", {
    environmentId,
    events,
    acceptedAt: new Date().toISOString(),
  });
};

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  io.close();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({
  port: config.port,
  host: config.host,
});
