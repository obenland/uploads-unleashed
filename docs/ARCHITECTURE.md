# Architecture

This document describes the architecture of the Uploads Unleashed plugin, which implements the [TUS 1.0.0 protocol](https://tus.io/protocols/resumable-upload.html) for WordPress.

## Overview

The plugin enables resumable, chunked file uploads in WordPress by:

1. Intercepting standard WordPress media uploads
2. Routing them through a TUS-compliant REST API
3. Storing chunks temporarily until the upload completes
4. Creating WordPress attachments from completed uploads

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│                             Frontend                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   plupload.js   │  │ block-editor.js │  │   resume-ui.js  │  │
│  │ (Media Library) │  │  (Block Editor) │  │(Pending Uploads)│  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌────────┴────────────────────┴────────────────────┴────────┐  │
│  │                       tus-client.js                       │  │
│  │             (TUS Client, wraps tus-js-client)             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼ HTTP (REST API)
┌─────────────────────────────────────────────────────────────────┐
│                             Backend                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Uploads_Unleashed_TUS_Controller             │  │
│  │                                                           │  │
│  │  POST   /wp/v2/media        → Create upload session       │  │
│  │  HEAD   /wp/v2/media/{id}   → Get upload offset           │  │
│  │  PATCH  /wp/v2/media/{id}   → Upload chunk                │  │
│  │  DELETE /wp/v2/media/{id}   → Cancel upload               │  │
│  └──────────────┬──────────────────────────────┬─────────────┘  │
│                 │                              │                │
│                 ▼                              ▼                │
│  ┌────────────────────────────┐ ┌────────────────────────────┐  │
│  │   Uploads_Unleashed_TUS    │ │   Uploads_Unleashed_TUS    │  │
│  │      _Upload_Session       │ │       _Chunk_Storage       │  │
│  │                            │ │                            │  │
│  │        (Transients)        │ │       (File System)        │  │
│  └────────────────────────────┘ └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Components

### tus-client.js - Core TUS Client

The main TUS client wrapper built on `tus-js-client`, exposed to other scripts as `window.uploadsUnleashed.tusClient`. Provides:

- `upload(file, options)` - Promise-based upload with auto-resume, resolves with the attachment
- `abort(tusUpload)` - Cancels an in-progress upload and cleans up storage
- `getPendingUploads()` - Lists resumable uploads from localStorage
- `discardPendingUpload(pendingUpload)` - Deletes a pending upload on the server and locally

**Key Features:**
- 5MB default chunk size
- Retries with a backoff capped at one minute; while the browser is offline, requests wait for the connection to come back
- Fingerprint-based resume (stored in localStorage, scoped to the site and user; uploads still work without storage)
- Automatic cleanup on success
- At most 3 parallel uploads (`uploads_unleashed_max_concurrent_uploads`); further uploads wait in a queue

### plupload.js - Media Library Integration

Integrates with WordPress's plupload-based Media Library:

- Wraps `wp.Uploader` constructor to intercept new instances
- Binds to `BeforeUpload` event to redirect uploads to TUS
- Transforms REST API attachment format to legacy format
- Works on both `upload.php` and `media-new.php` (which uses a raw plupload instance)
- Reports server-side rejections through core's upload error UI

### block-editor.js - Block Editor Integration

Integrates with the Block Editor's `wp.apiFetch` middleware:

- Intercepts POST requests to `/wp/v2/media`
- Extracts files from FormData
- Routes to TUS protocol instead
- Handles AbortSignal for cancellation
- Falls back to a standard upload if the TUS endpoint is unavailable, and passes server rejections through

### resume-ui.js - Pending Uploads UI

Displays interrupted uploads that can be resumed:

- Parses localStorage for TUS fingerprints
- Shows Resume/Discard buttons; Discard asks for an inline confirmation
- Uses File System Access API when available
- Validates file matches before resuming
- Announces mismatches and resumed upload progress (every 10%, at most every 5 seconds) via `wp.a11y.speak()`, and moves focus to the next item when one is removed

## Backend Components

### Uploads_Unleashed_TUS_Controller

The main REST API controller implementing TUS 1.0.0:

**Endpoints:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/wp/v2/media` (with `Upload-Length`) | Create upload session |
| HEAD | `/wp/v2/media/{id}` | Get current offset |
| PATCH | `/wp/v2/media/{id}` | Upload chunk |
| DELETE | `/wp/v2/media/{id}` | Cancel upload |

`{id}` is a UUID. Creation shares core's attachment route: a `rest_pre_dispatch` filter in `uploads-unleashed.php` hands `POST /wp/v2/media` requests that carry an `Upload-Length` header to the controller, and lets every other request through to core. HEAD is registered as GET so WordPress's HEAD-to-GET fallback works on nginx, and a POST with `X-HTTP-Method-Override` stands in for HEAD, PATCH, or DELETE where those verbs are blocked.

**TUS Features Supported:**
- Creation
- Termination
- Checksum verification (SHA256, SHA1, MD5)
- Expiration (24 hours)

**Security:**
- User authentication required
- Ownership verification
- File type validation
- Image content verification
- Multisite quota and max upload file size checks

### Uploads_Unleashed_TUS_Upload_Session

Manages upload session metadata using WordPress transients:

- `create()` - Create new session with UUID
- `get()` - Retrieve session data
- `update_offset()` - Update upload progress
- `delete()` - Remove session
- `delete_all()` - Remove every session (uninstall)

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

### Uploads_Unleashed_TUS_Chunk_Storage

Manages physical chunk files on disk:

- Base directory: `wp-content/uploads/.tus-chunks/`, overridable with the `uploads_unleashed_chunk_dir` filter. It must be local: when it's a stream wrapper (S3-Uploads `s3://`, VIP `vip://`), which can't lock or list files, creating an upload fails with `tus_chunk_dir_not_local`, so those sites must set the filter.
- Protected with `.htaccess` (Apache 2.2 and 2.4 rules) and `index.php`; nginx ignores `.htaccess`
- File-level locking for concurrent access
- Cleanup via WP-Cron (daily)

**Methods:**
- `get_chunk_dir()` - Resolved chunk directory for the current site (static, filtered, doesn't create it)
- `check_directory()` - Whether chunks can be stored (local and writable), checked when an upload is created
- `create()` - Create the empty chunk file when an upload is created, so it counts as pending
- `append()` - Write chunk data at offset
- `get_path()` - Get sanitized file path
- `get_size()` - Current file size
- `exists()` - Whether a chunk file exists
- `delete()` - Remove chunk file
- `get_total_pending_size()` - Bytes held by in-progress uploads (multisite quota)
- `list_active_sessions()` - Active uploads (used by `wp tus list`)
- `cleanup_expired()` - Cron job for old files
- `delete_all()` - Remove the chunk directory (uninstall)

## Data Flow

### Upload Creation

```
1. Client sends POST /wp/v2/media
   Headers: Upload-Length, Upload-Metadata

2. uploads_unleashed_intercept_tus_creation()
   - Validates permissions (create_item_permissions_check())
   Uploads_Unleashed_TUS_Controller::create_item()
   - Parses metadata (filename, filetype)
   - Rejects a missing filename or a disallowed file type (400),
     unless the user can `unfiltered_upload`
   - Creates Uploads_Unleashed_TUS_Upload_Session
   - Creates an empty chunk file, which reserves the upload's length

3. Response: 201 Created
   Headers: Location, Upload-Offset: 0
```

### Chunk Upload

```
1. Client sends PATCH /wp/v2/media/{id}
   Headers: Upload-Offset, Content-Type
   Body: Binary chunk data

   uploads_unleashed_skip_oversized_chunk_body() (parse_request)
   - If Content-Length exceeds the chunk size limit, keeps the REST
     server from reading the body into memory

2. Uploads_Unleashed_TUS_Controller::upload_chunk()
   - Validates session exists
   - Verifies offset matches the chunk file's size (the source of truth)
   - Rejects chunks over the size limit (413)
   - Optional checksum verification
   - Appends to Uploads_Unleashed_TUS_Chunk_Storage
   - Updates session offset (reconciled from the file size if it falls behind)

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

2. Client sends HEAD /wp/v2/media/{id}
   - Gets current server offset (the chunk file's size)

3. Client resumes from offset
   - Sends remaining chunks
```

## Extension Points

### Filters

| Filter | Purpose |
|--------|---------|
| `uploads_unleashed_max_upload_size` | Modify max file size |
| `uploads_unleashed_max_chunk_size` | Modify max chunk size per PATCH |
| `uploads_unleashed_chunk_dir` | Move the chunk directory (required for S3/VIP uploads) |
| `uploads_unleashed_session_data` | Add custom session data |
| `uploads_unleashed_pre_finalize` | Validate before finalizing |
| `uploads_unleashed_finalize_upload` | Custom finalization |
| `uploads_unleashed_attachment_data` | Modify response |
| `uploads_unleashed_max_concurrent_uploads` | Limit parallel uploads in the browser |

### Actions

| Action | Purpose |
|--------|---------|
| `uploads_unleashed_upload_created` | After session created |
| `uploads_unleashed_chunk_received` | After each chunk |
| `uploads_unleashed_upload_complete` | After finalization |
| `uploads_unleashed_upload_deleted` | After cancellation |

See [docs/hooks.md](hooks.md) for detailed documentation.

## Security Considerations

1. **Authentication**: All endpoints require `upload_files` capability
2. **Ownership**: Users can only access their own uploads
3. **File Types**: Validated against WordPress allowed types with `wp_check_filetype_and_ext()`, unless the user can `unfiltered_upload`
4. **Image Verification**: `wp_check_filetype_and_ext()` checks the content, and `wp_get_image_mime()` must match the validated type when it can read the image, which prevents PHP-in-image
5. **Path Traversal**: Upload IDs sanitized to alphanumeric + hyphens
6. **Directory Protection**: `.htaccess` denies direct chunk access
7. **Checksum Verification**: Optional integrity validation
8. **Quota Enforcement**: Multisite space limits respected
