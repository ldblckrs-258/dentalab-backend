# DentaLab Backend

Backend API for DentaLab — a dental clinic management system with RAG-powered chatbot. Built with NestJS 11, PostgreSQL (pgvector), Redis, RabbitMQ, and MinIO.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Database](#database)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Authentication & Authorization** — JWT-based auth with refresh tokens, password reset via email queue
- **Role-Based Access Control (RBAC)** — Roles, permissions, and per-user overrides with grant/deny and optional expiration
- **Patient Management** — Patient records, insurance, file uploads
- **Clinical Workflows** — Providers, appointments, treatment plans, clinical notes (SOAP format)
- **Scheduling** — Provider schedules with overrides, appointment types, appointment procedures
- **Forms & Kiosk** — Dynamic form builder, kiosk sessions for patient intake
- **Inventory Management** — Items, transactions, low-stock tracking
- **Document Management** — Internal documents with versioning
- **Email System** — Templated emails with send logging
- **RAG Chatbot** — Document ingestion, vector embeddings (pgvector), chat sessions with citations
- **Audit Logging** — Automatic audit trail via decorator-based interceptor
- **Health Checks** — Liveness and readiness endpoints with degraded state detection
- **File Storage** — S3/MinIO integration with presigned URLs and MIME validation
- **Rate Limiting** — Per-endpoint rate limiting with Redis-backed counters

## Tech Stack

| Category        | Technology                     |
| --------------- | ------------------------------ |
| Framework       | NestJS 11                      |
| Language        | TypeScript 5                   |
| Database        | PostgreSQL 16 + pgvector       |
| ORM             | Prisma 7.5                     |
| Cache           | Redis 7 (ioredis)              |
| Message Queue   | RabbitMQ 3 (amqplib)           |
| Object Storage  | MinIO / S3                     |
| Auth            | Passport JWT                   |
| Validation      | class-validator + Zod (config) |
| Package Manager | pnpm 10                        |

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Docker** and **Docker Compose** (for infrastructure services)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/ldblckrs-258/dentalab-backend.git
cd dentalab-backend
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start infrastructure services

```bash
docker-compose up -d
```

This starts:

| Service    | Port(s)      | Image                        |
| ---------- | ------------ | ---------------------------- |
| PostgreSQL | 5480         | pgvector/pgvector:pg16       |
| Redis      | 6380         | redis:7-alpine               |
| RabbitMQ   | 5672 / 15672 | rabbitmq:3-management-alpine |
| MinIO      | 9000 / 9001  | minio/minio                  |

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 5. Run database migrations and seed

```bash
pnpm run prisma:migrate:dev
pnpm run prisma:generate
```

The seed script creates an admin user and system roles.

### 6. Start the development server

```bash
pnpm run start:dev
```

The API is available at `http://localhost:3000/api/v1`.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable                    | Description                  | Default          |
| --------------------------- | ---------------------------- | ---------------- |
| `PORT`                      | Server port                  | `3000`           |
| `NODE_ENV`                  | Environment                  | `development`    |
| `DATABASE_URL`              | PostgreSQL connection string | —                |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection             | `localhost:6380` |
| `RABBITMQ_URL`              | RabbitMQ connection string   | —                |
| `S3_ENDPOINT`               | MinIO/S3 endpoint            | —                |
| `JWT_SECRET`                | JWT signing secret           | —                |
| `JWT_ACCESS_EXPIRY`         | Access token TTL             | `15m`            |
| `JWT_REFRESH_EXPIRY`        | Refresh token TTL            | `7d`             |

All environment variables are validated at startup using Zod schemas.

### Path Aliases

| Alias        | Maps to         |
| ------------ | --------------- |
| `@common/*`  | `src/common/*`  |
| `@modules/*` | `src/modules/*` |

## Architecture

### Request Pipeline

```
Request → RateLimitGuard → JwtAuthGuard → PermissionGuard
        → RequestContextInterceptor → Controller → ResponseInterceptor
        → AuditInterceptor → GlobalExceptionFilter → Response
```

- All endpoints require JWT auth by default; use `@Public()` to opt out
- All responses are wrapped in a standard `ApiResponse` envelope; use `@SkipResponseWrap()` to bypass
- Permission checks use `@RequirePermissions()` (AND) or `@RequireAnyPermission()` (OR)
- Permissions are cached in Redis with a 5-minute TTL

## Database

PostgreSQL with pgvector extension. Schema at `prisma/schema.prisma`.

### Conventions

- **UUIDs** for all primary keys
- **Timestamps** — `created_at` and `updated_at` on all models

### Key Model Groups

| Group       | Models                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Auth & RBAC | User, Role, Permission, UserRole, RolePermission, UserPermissionOverride, RefreshToken, PasswordResetToken |
| Clinical    | Provider, Appointment, AppointmentType, TreatmentPlan, ClinicalNote, Procedure                             |
| Patient     | Patient, PatientInsurance, PatientFile                                                                     |
| Operations  | Form, FormSubmission, KioskSession, InternalDocument, InventoryItem, EmailTemplate                         |
| RAG/AI      | RagDocument, ParentChunk, ChildChunk (vector embeddings), ChatSession, ChatMessage                         |
| Audit       | AuditLog                                                                                                   |

### Common Commands

```bash
pnpm run prisma:generate       # Regenerate Prisma Client
pnpm run prisma:migrate:dev    # Create and run migrations
pnpm run prisma:migrate:deploy # Deploy migrations (production)
pnpm run prisma:studio         # Open Prisma Studio UI
```

## Testing

```bash
pnpm run test              # Run unit tests
pnpm run test:watch        # Unit tests in watch mode
pnpm run test:cov          # Unit tests with coverage
pnpm run test:e2e          # End-to-end tests
```

Unit tests cover all modules: auth, rbac, common (filters, guards, interceptors), audit, pagination, redis, config, storage, and health.

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push to `master`/`main` and on pull requests:

| Job            | Trigger   | Description                                            |
| -------------- | --------- | ------------------------------------------------------ |
| **Commitlint** | PRs only  | Validates commit messages against conventional commits |
| **Lint**       | Push + PR | Runs ESLint                                            |
| **Test**       | Push + PR | Generates Prisma client, runs unit tests               |
| **Build**      | Push + PR | Builds the application (after lint + test pass)        |

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint and husky:

```
<type>(scope): description

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
```

### Git Hooks (Husky)

| Hook         | Action                          |
| ------------ | ------------------------------- |
| `pre-commit` | Runs ESLint                     |
| `commit-msg` | Validates commit message format |

## Scripts Reference

| Script                        | Description                 |
| ----------------------------- | --------------------------- |
| `pnpm run start:dev`          | Start with file watching    |
| `pnpm run start:debug`        | Start with debugger + watch |
| `pnpm run start:prod`         | Start production build      |
| `pnpm run build`              | Build the project           |
| `pnpm run lint`               | Run ESLint with auto-fix    |
| `pnpm run format`             | Run Prettier formatting     |
| `pnpm run test`               | Run unit tests              |
| `pnpm run test:e2e`           | Run e2e tests               |
| `pnpm run prisma:generate`    | Regenerate Prisma Client    |
| `pnpm run prisma:migrate:dev` | Create and run migrations   |
| `pnpm run prisma:studio`      | Open Prisma Studio          |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit using conventional commits (`feat: add new feature`)
4. Push to your branch (`git push origin feat/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
