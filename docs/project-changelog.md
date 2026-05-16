# Changelog

## [Unreleased]

### Changed

- `StorageService.getPresignedUrl()` now defaults to `inline` content-disposition so browsers render files in-tab. Callers that need a download prompt pass `{ forceAttachment: true }`.
