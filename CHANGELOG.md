# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Transactional invitation-email outbox delivery and billing controls are planned for the public launch.
- Persistent revocable sessions, logout-all, and single-use password-reset links that revoke compromised sessions.
- Organization/environment/API-key token buckets, monthly quotas, plan metering, retained-storage accounting, and Free/Team/Business plan definitions.
- Immutable audit logs, optional environment IP allowlists, retention automation, secure exports/deletions, and a public status page.
- Server-side PII/credential redaction, configurable payload/depth limits, HTTPS enforcement, and modern security headers.
- Client-encrypted backup scripts, scheduled backup/retention workflows, failure alerts, and automated monthly restore drills.
- Dedicated read-only demo organization/project/environment, hidden generator key, deterministic 30-day historical fixtures, isolated reset, and a live eight-step BullMQ failure command.

## [1.0.0] - 2026-07-17

### Added

- Stable `monitor.init()`, capture, flush, shutdown, and diagnostic APIs.
- Publishable ESM/CommonJS packages with declarations and source maps.
- Bounded buffering, sampling, recursive redaction, overflow policies, exponential backoff, jitter, and safe drops.
- Express, Fastify, BullMQ, UUID, and W3C `traceparent` interoperability.
- External signup, four-role organization access, expiring invitations, persisted onboarding, key rotation UI, and support entry point.
- Optional SMTP invitation delivery with a safe copy-link fallback.

### Changed

- Telemetry and API keys are isolated by organization, project, and environment.
- The former `member` role migrates to `developer`.

### Fixed

- Delivery failures cannot crash the instrumented process.
- Trace read filters accept OpenTelemetry trace IDs without weakening UUID event IDs.

### Security

- API keys are displayed once and stored as hashes; revoked keys stop authenticating immediately.
- Browser sessions use HttpOnly cookies and sensitive SDK fields are redacted recursively.

[Unreleased]: https://github.com/queue-monitor/queue-monitor/compare/sdk-v1.0.0...HEAD
[1.0.0]: https://github.com/queue-monitor/queue-monitor/releases/tag/sdk-v1.0.0
