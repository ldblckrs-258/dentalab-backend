# Realtime Events

## Namespace `/schedule`

Connection: `ws://host/schedule` with `Authorization: Bearer <jwt>` header or `auth.token` payload.
Required permission (any): `provider_schedules:read`, `schedule_overrides:read`.

### Event: `schedule.updated`

Direction: server → client
Payload (`ScheduleUpdatedEvent`):

| Field      | Type                  | Description |
|------------|-----------------------|-------------|
| providerId | string (uuid)         | Affected provider |
| effectFrom | string (ISO 8601 UTC) | Start of effect window |
| effectTo   | string \| null        | End or null for open-ended |

Triggered by: `provider_schedules` create/update/delete.

### Event: `override.requested`

Direction: server → client
Payload (`OverrideRequestedEvent`):

| Field        | Type                  | Description |
|--------------|-----------------------|-------------|
| id           | string (uuid)         | Override request ID |
| providerId   | string (uuid)         | Affected provider |
| specificDate | string (ISO 8601)     | Date of the override |

Triggered by: new schedule override request created.

### Event: `override.reviewed`

Direction: server → client
Payload (`OverrideReviewedEvent`):

| Field      | Type                                    | Description |
|------------|-----------------------------------------|-------------|
| id         | string (uuid)                           | Override request ID |
| status     | `"approved"` \| `"rejected"` \| `"cancelled"` | Review outcome |
| reviewerId | string (uuid) \| null                   | Reviewer identity |

Triggered by: override request approved/rejected/cancelled.

---

## Error Frames

All namespaces emit `ws:error` frames on failure.

Direction: server → client
Payload (`WsErrorFrame`):

| Field   | Type   | Description |
|---------|--------|-------------|
| event   | string | Always `"ws:error"` |
| code    | string | Error code from `WsErrorCode` enum |
| message | string | Human-readable description |
| details | any    | Optional additional context |

### Error Codes (`WsErrorCode`)

| Code                   | Description |
|------------------------|-------------|
| `WS_NO_TOKEN`          | Missing or empty auth token |
| `WS_INVALID_TOKEN`     | Token expired, malformed, or invalid signature |
| `WS_NO_PERMISSION`     | Authenticated but lacks required permission |
| `WS_RATE_LIMITED`      | Handshake rate limit exceeded |
| `WS_VALIDATION_ERROR`  | Malformed event payload |
| `WS_UNAUTHORIZED`      | Generic authorization failure |
| `WS_INTERNAL_ERROR`    | Unexpected server error |
