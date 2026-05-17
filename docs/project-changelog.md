# Changelog

## [Unreleased]

### Added

- Patient SOAP Note module (`clinical-note`): 9 new endpoints under `/clinical-notes`, `/patients/:patientId/clinical-notes`, and `/appointments/:appointmentId/clinical-notes` with create, read, update, sign, addendum, and delete operations. Requires `clinical_notes:*` permissions.

### Changed

- `StorageService.getPresignedUrl()` now defaults to `inline` content-disposition so browsers render files in-tab. Callers that need a download prompt pass `{ forceAttachment: true }`.
