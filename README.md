# Resumable Uploads

TUS protocol support for resumable media uploads in WordPress.

## Overview

This plugin adds support for the [TUS resumable upload protocol](https://tus.io/) to WordPress, enabling reliable uploads of large files that can resume after network interruptions.

### Features

- **Resumable uploads** - Uploads automatically resume from where they left off after connection failures
- **Large file support** - Bypasses PHP upload limits by chunking files
- **Progress tracking** - Real-time upload progress in the media uploader
- **Transparent integration** - Works with the existing WordPress media library interface
- **Extensible** - Filter and action hooks for custom workflows

## Requirements

- WordPress 6.4+
- PHP 7.4+

## Installation

Download the latest release zip and install through WordPress, or clone the repository:

```bash
cd wp-content/plugins
git clone https://github.com/obenland/resumable-uploads.git
cd resumable-uploads
composer install --no-dev
npm install
npm run build
```

## How It Works

The plugin implements TUS 1.0.0 protocol via a REST API endpoint at `/wp/v2/media/tus`:

1. **POST** `/wp/v2/media/tus` - Create upload session
2. **HEAD** `/wp/v2/media/tus/{id}` - Get upload offset
3. **PATCH** `/wp/v2/media/tus/{id}` - Upload chunk
4. **DELETE** `/wp/v2/media/tus/{id}` - Cancel upload

Upload sessions expire after 24 hours. Incomplete uploads are cleaned up hourly.

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
npm test
```

This runs PHPUnit tests via wp-env. Requires Docker.

### Linting

```bash
composer run lint
npm run lint
```

## License

GPL-2.0-or-later
