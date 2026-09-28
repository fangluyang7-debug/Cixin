# Scheduling protocol v1

The current increment contains a shared generic envelope, not the complete shopping payload schemas.
Authoritative paired implementations are `apps/harmony/scheduler/src/main/ets/api/SchedulingProtocol.ets` and `services/api-server/src/core/runtime/scheduling-protocol.ts`.
`npm run protocol:test` checks source parity and the common fixtures. Change both consumers and fixtures together.

- TaskContract describes stable capability semantics. TaskInstance identifies one attempt and its remaining budget.
- ArtifactRef identifies immutable content by ID, content version, SHA-256, schema ID and schema version. Knowing an ID grants no access.
- COMMITTED manifests require a known byte length and a location. Locations contain private resolver IDs, never signed URLs or phone file paths.
- Model compatibility compares model/version, embedding kind, dimensions, dtype, normalization, preprocessing and index space together.
- Canonical JSON v1 uses UTF-8, sorted object keys, preserved array order and JSON scalar encoding. Decimal prices remain strings. Non-JSON values are rejected. This is the project's v1 encoding, not a claim of RFC 8785 implementation.
- Artifact metadata only becomes available when `ARTIFACT_PROTOCOL_ENABLED=true` after the additive migration. Binary image upload also works with legacy asset IDs when disabled.

`ShoppingResult.payloadJson` is a private transitional API snapshot. It is not a validated generic shopping Artifact payload and must not be included in telemetry. Full business schemas, lifecycle, persistent stage commits and recovery are tracked in `docs/architecture-change-acceptance.md`.
