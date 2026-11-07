# Uploads Unleashed

WordPress plugin that routes media uploads through a [TUS](https://tus.io/) resumable upload REST API. Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together, [docs/hooks.md](docs/hooks.md) for the public hooks, and [CONTRIBUTING.md](CONTRIBUTING.md) for environment setup.

## Commands

```bash
npm run build          # webpack (src/ → build/) plus the minified tus-js-client
npm run lint           # phpcs, ESLint, package.json lint
npm run test:js        # Vitest
npm run start:tests && npm test   # PHPUnit in the wp-env tests environment (port 8889)
npm run test:e2e:install          # once, installs Chromium
npm run start && npm run test:e2e # Playwright against wp-env (port 8888)
```

CI doesn't use wp-env: `bin/install-wp-tests.sh` (PHPUnit) and `bin/start-e2e-wordpress.sh` (e2e) set up WordPress against a plain MySQL server, and work locally too (see CONTRIBUTING.md).

The plugin `require`s the generated `build/*.asset.php` files, so run `npm run build` before PHPUnit, the e2e tests, or loading the site from a fresh clone or worktree; otherwise it fatals.

## Layout

- `uploads-unleashed.php`: bootstrap, script registration, and the `rest_pre_dispatch` filter that turns a `POST /wp/v2/media` with an `Upload-Length` header into a TUS upload.
- `includes/`: REST controller (`wp/v2/media/<uuid>`), upload session (transients), chunk storage (`uploads/.tus-chunks/` by default, resolved by `Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir()`; S3/VIP sites must set the `uploads_unleashed_chunk_dir` filter), WP-CLI `wp tus` command.
- `src/`: `tus-client.js` (upload API), `plupload.js` (media library and `media-new.php`), `block-editor.js` (`apiFetch` middleware), `resume-ui.js` and `resume-ui.css` (interrupted-uploads UI). Plain JS, built with `@wordpress/scripts`.
- `webpack.config.js` externalizes both `tus-js-client` (the vendored `src/vendor/tus.js`, shipped as `build/tus.min.js` and exposed as `window.tus`) and `@uploads-unleashed/tus-client` (exposed as `window.uploadsUnleashed.tusClient`), so each is loaded once as its own registered script. When replacing the vendored file, update its script version (`4.3.1`) in `uploads-unleashed.php`.
- `tests/phpunit`, `tests/js` (Vitest), `tests/e2e` (Playwright, TypeScript).

## Conventions

- WordPress coding standards; `phpcs` and ESLint must pass with no errors or warnings.
- New PHP files declare `declare( strict_types = 1 );` after the file docblock and type every parameter and return. Existing files stay as they are.
- PHP must run on 7.4 and WordPress on 6.4. PHPUnit runs on PHP 7.4, 8.1 and 8.4, as multisite, on WordPress 6.4, and on nightly (allowed to fail).
- New functions, classes, and hooks get `@since` set to the next minor version (`1.2.0` after `1.1.0`).
- New filters and actions are documented in `docs/hooks.md` and the Extension Points tables in `docs/ARCHITECTURE.md`.
- Comments: `/** */` docblocks on every function, class, property and constant; `/* */` for multi-line comments in a function body; never stack `//` lines.
- JS tests use Vitest, not Jest. WordPress packages and the TUS client are mocked through aliases in `vitest.config.mjs`; tests that need a fresh module call `vi.resetModules()` and re-`import()` it.
- New top-level files or directories that shouldn't ship to WordPress.org go in `.distignore`.
- The default branch is `trunk`. Releases are cut by pushing an `X.Y.Z` tag; `release.yml` bumps the plugin version and the changelog itself, so don't edit the plugin version by hand.
- Every PR gets exactly one changelog label: `enhancement`, `bug`, `documentation`, or `maintenance` (CI, tests, tooling). The release notes are built from these labels, and an unlabeled PR lands on the `**Full Changelog**` line, which drops it from the README changelog. The `Changelog label` check fails until a PR has exactly one. Dependabot PRs are the exception: their `dependencies` label is in `ignore_labels` in `.github/changelog_configuration.json`, which keeps them out of the changelog.

## CI

- PHPUnit and Playwright E2E are required checks. Don't add `paths:` filters to their workflows: a skipped required check blocks the PR.
- Pin third-party actions to a full commit SHA with the version in a comment, set `persist-credentials: false` on checkouts, and give each workflow least-privilege `permissions:`.
- Dependabot PRs auto-merge through `dependabot-auto-merge.yml`; changes to workflows or the Dependabot config must keep that working.
