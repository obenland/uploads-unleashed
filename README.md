# Uploads Unleashed

TUS protocol support for resumable media uploads in WordPress.

## Overview

This plugin adds support for the [TUS resumable upload protocol](https://tus.io/) to WordPress, enabling reliable uploads of large files that can resume after network interruptions.

### Features

- **Resumable uploads** - Uploads automatically resume from where they left off after connection failures, with a resume UI that lets you pick up incomplete uploads
- **Large file support** - Bypasses PHP upload limits by chunking files
- **Progress tracking** - Real-time upload progress percentage in the media uploader
- **Block editor support** - Works natively in the block editor, classic editor, and Media Library
- **Checksum verification** - Validates upload integrity with checksum headers
- **Multisite quota support** - Respects network upload quotas on multisite installations
- **Extensible** - Filter and action hooks for custom workflows

## Requirements

- WordPress 6.4+
- PHP 7.4+

## Installation

Download the latest release zip and install through WordPress, or clone the repository:

```bash
cd wp-content/plugins
git clone https://github.com/obenland/uploads-unleashed.git
cd uploads-unleashed
npm install
npm run build
```

## How It Works

The plugin implements TUS 1.0.0 protocol by intercepting the existing media REST API:

1. **POST** `/wp/v2/media` - Create upload session (intercepted via `rest_pre_dispatch` when `Upload-Length` header is present)
2. **HEAD** `/wp/v2/media/{id}` - Get upload offset
3. **PATCH** `/wp/v2/media/{id}` - Upload chunk
4. **DELETE** `/wp/v2/media/{id}` - Cancel upload

Upload sessions expire after 24 hours. Incomplete uploads are cleaned up daily.

## Extending

The plugin provides filters and actions for custom workflows like video processing, custom authentication, and more. See [docs/hooks.md](docs/hooks.md) for the complete reference with examples.

## Development

### Setup

```bash
composer install
npm install
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test          # PHPUnit via wp-env (requires Docker)
npm run test:js   # Jest
```

### Linting

```bash
npm run lint
```

## License

GPL-2.0-or-later
