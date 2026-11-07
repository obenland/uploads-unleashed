# Contributing to Uploads Unleashed

Thank you for your interest in contributing to Uploads Unleashed! This guide will help you get started.

## Development Environment Setup

### Prerequisites

- PHP 7.4 or higher
- Node.js 26 (see `.nvmrc`)
- Docker (for wp-env)
- MySQL or MariaDB (only to run the tests without wp-env, as CI does)
- Composer

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/obenland/uploads-unleashed.git
   cd uploads-unleashed
   ```

2. Install PHP dependencies:
   ```bash
   composer install
   ```

3. Install Node dependencies:
   ```bash
   npm install
   ```

4. Start the WordPress development environment:
   ```bash
   npm run start
   ```

   This starts a Docker-based WordPress instance at http://localhost:8888

5. Build the JavaScript:
   ```bash
   npm run build
   ```

   To rebuild on every change:
   ```bash
   npm run dev
   ```

## Running Tests

### PHP Tests

PHPUnit tests run inside a separate wp-env tests environment on port 8889:

```bash
npm run start:tests
npm test
```

To run a specific test file:
```bash
npm test -- --filter Test_Uploads_Unleashed_TUS_Controller
```

CI skips wp-env and runs PHPUnit directly against a MySQL server. To do the same locally, install WordPress and the test library once (defaults to `$TMPDIR/wordpress` and `$TMPDIR/wordpress-tests-lib`), then run PHPUnit:

```bash
bin/install-wp-tests.sh wordpress_test <db-user> <db-pass> [db-host] [wp-version]
WP_TESTS_DIR="${TMPDIR:-/tmp}/wordpress-tests-lib" vendor/bin/phpunit
```

### JavaScript Tests

Vitest tests run locally:

```bash
npm run test:js
```

For watch mode during development:
```bash
npm run test:js:watch
```

### End-to-End Tests

Playwright tests run against the wp-env site on port 8888:

```bash
npm run test:e2e:install   # once, installs Chromium
npm run start
npm run test:e2e
```

CI skips wp-env and serves a fresh WordPress install with PHP's built-in server instead. To do the same locally, point it at a MySQL server and a free port:

```bash
WP_ENV_PORT=8890 bin/start-e2e-wordpress.sh <db-user> <db-pass> [db-host] [wp-version]
WP_ENV_PORT=8890 npm run test:e2e
```

The server keeps running in the background. Rerunning the script replaces it; `pkill -f 'php -S localhost:8890'` stops it.

### Code Coverage Reports

The coverage configuration is already set up in `phpunit.xml.dist` to analyze the code in the `includes` directory. To generate code coverage reports, you'll need to start the tests environment with Xdebug enabled for coverage:

```bash
# Start the environment with Xdebug enabled
npm run start:tests -- --xdebug=coverage
```

```bash
# Run tests with text coverage report
npm run test:coverage:text
```

For a detailed HTML report:

```bash
# Generate HTML coverage report
npm run test:coverage
```

```bash
# Open the coverage report in your default browser (macOS)
open coverage/index.html
```

The HTML report will be generated in the `coverage` directory, showing a detailed analysis of which lines of code are covered by tests.

For JavaScript coverage:

```bash
npm run test:js:coverage
```

## Code Standards

We follow WordPress Coding Standards for PHP and use the WordPress ESLint configuration for JavaScript/TypeScript. Check everything with:

```bash
npm run lint
```

You can also run linters individually:

```bash
composer lint          # PHP only
composer lint:fix      # PHP auto-fix
npm run lint:js        # JS/TS only
npm run lint:js:fix    # JS/TS auto-fix
npm run format         # Prettier
```

## Project Structure

```
uploads-unleashed/
├── uploads-unleashed.php   # Bootstrap, script registration, TUS creation intercept
├── includes/               # PHP backend classes
│   ├── class-uploads-unleashed-tus-controller.php
│   ├── class-uploads-unleashed-tus-upload-session.php
│   ├── class-uploads-unleashed-tus-chunk-storage.php
│   └── class-uploads-unleashed-cli-command.php
├── src/                    # JavaScript source
│   ├── tus-client.js       # Core TUS client wrapper
│   ├── plupload.js         # Media Library integration
│   ├── block-editor.js     # Block Editor integration
│   ├── resume-ui.js        # Pending uploads UI
│   └── vendor/tus.js       # Vendored tus-js-client
├── tests/
│   ├── phpunit/            # PHP unit tests
│   ├── js/                 # JavaScript unit tests (Vitest)
│   └── e2e/                # End-to-end tests (Playwright)
├── bin/                    # CI scripts for running tests without wp-env
├── build/                  # Compiled JS (generated)
├── docs/                   # Documentation
└── .github/workflows/      # CI configuration
```

## Making Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes, following the code standards

3. Add or update tests as needed

4. Run the test suite to ensure everything passes:
   ```bash
   npm test
   npm run test:js
   npm run test:e2e
   npm run lint
   ```

5. Commit your changes with a descriptive message

6. Push your branch and create a pull request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Update documentation if needed
- Ensure all CI checks pass
- Write a clear PR description explaining the change

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for an overview of how the plugin works.

## Hooks Reference

See [docs/hooks.md](docs/hooks.md) for the available filters and actions.

## Stopping the Development Environment

To stop the WordPress environments:
```bash
npm run stop
npm run stop:tests
```

## Questions?

If you have questions or need help, please open an issue on GitHub.
