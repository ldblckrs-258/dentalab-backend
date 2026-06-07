# Changelog

## [Unreleased]

### Added

- Patient SOAP Note module (`clinical-note`): 9 new endpoints under `/clinical-notes`, `/patients/:patientId/clinical-notes`, and `/appointments/:appointmentId/clinical-notes` with create, read, update, sign, addendum, and delete operations. Requires `clinical_notes:*` permissions.

### Changed

- `StorageService.getPresignedUrl()` now defaults to `inline` content-disposition so browsers render files in-tab. Callers that need a download prompt pass `{ forceAttachment: true }`.
- Operatory occupancy query consolidated into a single `operatoryOccupancyWhere()` helper (`common/utils`) shared by `OperatoryService.getBusyOperatoryIds`, `BookingSlotService.getFreeOperatoryIds`, and `getBookableSlots` — one source of truth mirroring the `appointments_operatory_no_overlap` gist predicate.

### Fixed

- `OperatoryService.create()` displayOrder allocation is now race-free: the `max(displayOrder)` read + insert run inside one transaction guarded by a `pg_advisory_xact_lock`, preventing duplicate orders from concurrent creates (plain transactions are insufficient under READ COMMITTED).
