# Architecture

This document describes the architecture of the Resumable Uploads plugin, which implements the [TUS 1.0.0 protocol](https://tus.io/protocols/resumable-upload.html) for WordPress.

## Overview

The plugin enables resumable, chunked file uploads in WordPress by:

1. Intercepting standard WordPress media uploads
2. Routing them through a TUS-compliant REST API
3. Storing chunks temporarily until the upload completes
4. Creating WordPress attachments from completed uploads

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  index.ts    │  │ wp-uploader  │  │   media-utils.ts     │  │
│  │ (TUS Client) │  │    .ts       │  │ (Block Editor)       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └────────────────┼──────────────────────┘              │
│                          │                                      │
│  ┌───────────────────────┴───────────────────────────────────┐ │
│  │                  resumable-ui.ts                          │ │
│  │              (Pending Uploads UI)                         │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP (REST API)
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐ │
│  │               REST_TUS_Controller                         │ │
│  │                                                           │ │
│  │  POST   /wp/v2/media/tus      → Create upload session    │ │
│  │  HEAD   /wp/v2/media/tus/{id} → Get upload offset        │ │
│  │  PATCH  /wp/v2/media/tus/{id} → Upload chunk             │ │
│  │  DELETE /wp/v2/media/tus/{id} → Cancel upload            │ │
│  └───────────────────────────────────────────────────────────┘ │
│         │                                 │                     │
│         ▼                                 ▼                     │
│  ┌──────────────────┐           ┌──────────────────┐          │
│  │ TUS_Upload       │           │ TUS_Chunk        │          │
│  │    _Session      │           │    _Storage      │          │
│  │                  │           │                  │          │
│  │ (Transients)     │           │ (File System)    │          │
│  └──────────────────┘           └──────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Components

### index.ts - Core TUS Client

The main TUS client wrapper built on `tus-js-client`. Provides:

- `createUpload(file, options)` - Creates a TUS upload instance
- `uploadFile(file, options)` - Promise-based upload with auto-resume
- `abortUpload(upload)` - Cancels an in-progress upload

**Key Features:**
- 5MB default chunk size
- Exponential backoff retry (0, 1s, 3s, 5s, 10s)
- Fingerprint-based resume (stored in localStorage)
- Automatic cleanup on success

### wp-uploader.ts - Media Library Integration

Integrates with WordPress's plupload-based Media Library:

- Wraps `wp.Uploader` constructor to intercept new instances
- Binds to `BeforeUpload` event to redirect uploads to TUS
- Transforms REST API attachment format to legacy format
- Works on both `upload.php` and `media-new.php`

### media-utils.ts - Block Editor Integration

Integrates with the Block Editor's `wp.apiFetch` middleware:

- Intercepts POST requests to `/wp/v2/media`
- Extracts files from FormData
- Routes to TUS protocol instead
- Handles AbortSignal for cancellation

### resumable-ui.ts - Pending Uploads UI

Displays interrupted uploads that can be resumed:

- Parses localStorage for TUS fingerprints
- Shows Resume/Discard buttons
- Uses File System Access API when available
- Validates file matches before resuming

## Backend Components

### REST_TUS_Controller

The main REST API controller implementing TUS 1.0.0:

**Endpoints:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/wp/v2/media/tus` | Create upload session |
| HEAD | `/wp/v2/media/tus/{id}` | Get current offset |
| PATCH | `/wp/v2/media/tus/{id}` | Upload chunk |
| DELETE | `/wp/v2/media/tus/{id}` | Cancel upload |

**TUS Features Supported:**
- Creation with upload-defer-length
- Checksum verification (SHA256, SHA1, MD5)
- Concatenation (partial uploads)
- Expiration (24 hours)

**Security:**
- User authentication required
- Ownership verification
- File type validation
- Image content verification
- Multisite quota checks

### TUS_Upload_Session

Manages upload session metadata using WordPress transients:

- `create()` - Create new session with UUID
- `get()` - Retrieve session data
- `update_offset()` - Update upload progress
- `delete()` - Remove session
- `verify_ownership()` - Check user owns upload
- `is_expired()` - Check if session expired

**Session Data:**
```php
[
    'upload_id'  => 'uuid-v4',
    'user_id'    => 1,
    'filename'   => 'photo.jpg',
    'filetype'   => 'image/jpeg',
    'length'     => 5242880,
    'offset'     => 0,
    'created_at' => 1700000000,
    'expires_at' => 1700086400,
]
```

### TUS_Chunk_Storage

Manages physical chunk files on disk:

- Base directory: `wp-content/uploads/.tus-chunks/`
- Protected with `.htaccess` and `index.php`
- File-level locking for concurrent access
- Cleanup via WP-Cron (hourly)

**Methods:**
- `append()` - Write chunk data at offset
- `get_path()` - Get sanitized file path
- `get_size()` - Current file size
- `delete()` / `cleanup()` - Remove chunk file
- `cleanup_expired()` - Cron job for old files

## Data Flow

### Upload Creation

```
1. Client sends POST /wp/v2/media/tus
   Headers: Upload-Length, Upload-Metadata

2. REST_TUS_Controller::create_item()
   - Validates permissions
   - Parses metadata (filename, filetype)
   - Creates TUS_Upload_Session

3. Response: 201 Created
   Headers: Location, Upload-Offset: 0
```

### Chunk Upload

```
1. Client sends PATCH /wp/v2/media/tus/{id}
   Headers: Upload-Offset, Content-Type
   Body: Binary chunk data

2. REST_TUS_Controller::upload_chunk()
   - Validates session exists
   - Verifies offset matches
   - Optional checksum verification
   - Appends to TUS_Chunk_Storage
   - Updates session offset

3. If offset < length:
   Response: 204 No Content
   Headers: Upload-Offset: {new_offset}

4. If offset == length (complete):
   - finalize_upload() called
   - File validated and moved
   - WordPress attachment created
   Response: 200 OK
   Body: Attachment JSON
```

### Upload Resume

```
1. Client calls upload.findPreviousUploads()
   - Searches localStorage by fingerprint

2. Client sends HEAD /wp/v2/media/tus/{id}
   - Gets current server offset

3. Client resumes from offset
   - Sends remaining chunks
```

## Extension Points

### Filters

| Filter | Purpose |
|--------|---------|
| `resumable_uploads_max_upload_size` | Modify max file size |
| `resumable_uploads_session_data` | Add custom session data |
| `resumable_uploads_pre_finalize` | Validate before finalizing |
| `resumable_uploads_finalize_upload` | Custom finalization |
| `resumable_uploads_attachment_data` | Modify response |

### Actions

| Action | Purpose |
|--------|---------|
| `resumable_uploads_upload_created` | After session created |
| `resumable_uploads_chunk_received` | After each chunk |
| `resumable_uploads_upload_complete` | After finalization |
| `resumable_uploads_upload_deleted` | After cancellation |

See [docs/hooks.md](hooks.md) for detailed documentation.

## Security Considerations

1. **Authentication**: All endpoints require `upload_files` capability
2. **Ownership**: Users can only access their own uploads
3. **File Types**: Validated against WordPress allowed types
4. **Image Verification**: `wp_get_image_mime()` prevents PHP-in-image
5. **Path Traversal**: Upload IDs sanitized to alphanumeric + hyphens
6. **Directory Protection**: `.htaccess` denies direct chunk access
7. **Checksum Verification**: Optional integrity validation
8. **Quota Enforcement**: Multisite space limits respected
