# Contributing to Resumable Uploads

Thank you for your interest in contributing to Resumable Uploads! This guide will help you get started.

## Development Environment Setup

### Prerequisites

- PHP 7.4 or higher
- Node.js 22 or higher
- Docker (for wp-env)
- Composer

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/obenland/resumable-uploads.git
   cd resumable-uploads
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

5. Build the JavaScript/TypeScript:
   ```bash
   npm run build
   ```

   For development with hot reloading:
   ```bash
   npm run start:js
   ```

## Running Tests

### PHP Tests

PHPUnit tests run inside the wp-env Docker container:

```bash
npm test
```

To run a specific test file:
```bash
npm test -- --filter Test_REST_TUS_Controller
```

### JavaScript Tests

Jest tests run locally:

```bash
npm run test:js
```

For watch mode during development:
```bash
npm run test:js:watch
```

## Code Standards

### PHP

We follow WordPress Coding Standards. Check your code with:

```bash
composer lint
```

Auto-fix issues where possible:
```bash
composer lint:fix
```

### JavaScript/TypeScript

We use WordPress ESLint configuration. Check your code with:

```bash
npm run lint:js
```

Auto-fix issues:
```bash
npm run lint:js:fix
```

Format code with Prettier:
```bash
npm run format
```

## Project Structure

```
resumable-uploads/
├── includes/               # PHP backend classes
│   ├── class-rest-tus-controller.php
│   ├── class-tus-upload-session.php
│   └── class-tus-chunk-storage.php
├── src/                    # TypeScript frontend source
│   ├── index.ts            # Core TUS client wrapper
│   ├── wp-uploader.ts      # Media Library integration
│   ├── media-utils.ts      # Block Editor integration
│   └── resumable-ui.ts     # Pending uploads UI
├── tests/
│   ├── phpunit/            # PHP unit tests
│   └── js/                 # JavaScript unit tests
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
   composer lint
   npm run lint:js
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

To stop the WordPress environment:
```bash
npm run stop
```

To completely remove it:
```bash
npm run destroy
```

## Questions?

If you have questions or need help, please open an issue on GitHub.
