# Versioning and release policy

The npm packages use Semantic Versioning independently of the deployable applications.

- **PATCH** fixes behavior without changing documented APIs.
- **MINOR** adds backward-compatible options, event types, or integrations.
- **MAJOR** changes documented behavior or removes/deprecates a public API.

Every release updates package versions and `CHANGELOG.md`, passes CI, and is tagged `sdk-vX.Y.Z`. The release workflow verifies the tag matches `packages/sdk/package.json`, performs tests/builds and dry-run package inspection, then publishes the shared contract before the SDK with npm provenance. Deprecations remain for at least one minor release where practical.

Release checklist:

1. Move relevant Unreleased entries into a dated version.
2. Update both public package versions and internal dependency ranges.
3. Run `npm test`, `npm run build`, and both `pack:check` scripts.
4. Merge through CI and create the signed `sdk-vX.Y.Z` tag.
5. Verify npm contents, declarations, CommonJS import, ESM import, and the quick start in a clean sample project.
