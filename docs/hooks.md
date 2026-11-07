# Hooks Reference

The Uploads Unleashed plugin provides filters and actions that allow other plugins to extend its functionality. This enables custom metadata handling, file processing, and more.

## Filters

### `uploads_unleashed_max_upload_size`

Override the maximum allowed upload size.

**Parameters:**
- `$max_size` (int) - The maximum upload size in bytes.
- `$request` (WP_REST_Request) - The REST request object.

**Return:** int - The maximum upload size in bytes.

**Example:**
```php
add_filter( 'uploads_unleashed_max_upload_size', function( $max_size, $request ) {
    // Premium users get larger uploads
    if ( current_user_can( 'upload_large_files' ) ) {
        return 10 * GB_IN_BYTES;
    }
    return $max_size;
}, 10, 2 );
```

---

### `uploads_unleashed_max_chunk_size`

Override the maximum allowed chunk size per PATCH request.

Controls how large each individual PATCH request body can be. The default is 10 MB. The return value is clamped to a minimum of 1 MB.

The filter also runs when the scripts are registered, to pass the limit to the browser. That request has no upload ID. The browser sends chunks of at most 5 MB, or this limit if it's lower.

The filter also runs on `parse_request`, before the REST server reads the body, so that a PATCH whose `Content-Length` exceeds the limit is rejected with 413 without being loaded into memory. In that call, `$request` carries the route and headers but no body.

**Parameters:**
- `$max_chunk_size` (int) - The maximum chunk size in bytes. Default `10 * MB_IN_BYTES`.
- `$request` (WP_REST_Request) - The REST request object.

**Return:** int - The maximum chunk size in bytes.

**Example:**
```php
add_filter( 'uploads_unleashed_max_chunk_size', function( $max_chunk_size, $request ) {
    // Allow larger chunks for users on fast connections.
    return 50 * MB_IN_BYTES;
}, 10, 2 );
```

---

### `uploads_unleashed_upload_expiration`

Override how long an upload session lives, in seconds.

The session expires this long after it was created or last received a chunk, so an upload that keeps making progress doesn't expire. The resulting time is sent in `Upload-Expires`. The value is also passed to the browser, which keeps its record of an upload for that long after creating it. Values below 1 fall back to the default.

**Since:** 1.2.0

**Parameters:**
- `$expiration` (int) - The lifetime in seconds. Default `DAY_IN_SECONDS`.

**Return:** int - The lifetime in seconds.

**Example:**
```php
add_filter( 'uploads_unleashed_upload_expiration', function( $expiration ) {
    // Keep interrupted uploads resumable for a week.
    return WEEK_IN_SECONDS;
} );
```

---

### `uploads_unleashed_chunk_dir`

Override the directory that holds in-progress upload chunks until the upload completes. The default is `.tus-chunks` in the uploads directory.

**Sites whose uploads directory is a stream wrapper must set this filter.** That includes S3-Uploads (`s3://`) and WordPress VIP (`vip://`). Chunks are written with `flock()` and listed with `glob()`, and neither works on stream wrappers. Without the filter, creating an upload fails with `tus_chunk_dir_not_local`. When an upload completes, the file is copied from the chunk directory into the uploads directory as usual.

The directory must:

- Be a local or mounted path, not a stream wrapper, and be writable. Otherwise uploads fail at creation with `tus_chunk_dir_not_local` or `tus_chunk_dir_not_writable`.
- Support `flock()`. Check that a network mount (NFS, EFS) supports locking.
- Be shared by every web server when a load balancer can send the requests of one upload to different servers (unless sessions are sticky).
- Not be served by the web server. The plugin writes an `.htaccess` that denies access on Apache, but nginx ignores it, so prefer a directory outside the web root.
- Be separate for each site on multisite. Cleanup deletes chunk files that have no upload session on the current site.

Cleanup and uninstall use the filtered path too, so add the filter from a must-use plugin, which keeps it active when they run.

**Since:** 1.2.0

**Parameters:**
- `$chunk_dir` (string) - Absolute path to the chunk directory.

**Return:** string - Absolute path to the chunk directory.

**Example:**
```php
// wp-content/mu-plugins/uploads-unleashed-chunk-dir.php
add_filter( 'uploads_unleashed_chunk_dir', function( $chunk_dir ) {
    // S3/VIP uploads: keep chunks on a local (or shared) disk outside the web root, one directory per site.
    return '/srv/uploads-unleashed-chunks/' . get_current_blog_id();
} );
```

---

### `uploads_unleashed_session_data`

Filter session data before it's stored. Add custom fields to persist throughout the upload.

**Parameters:**
- `$session_data` (array) - The session data to be stored.
- `$request` (WP_REST_Request) - The REST request object.

**Return:** array - The filtered session data.

**Example:**
```php
add_filter( 'uploads_unleashed_session_data', function( $session_data, $request ) {
    // Store custom data from a header with the session
    $custom = $request->get_header( 'X-Custom-Metadata' );
    if ( $custom ) {
        $session_data['custom'] = json_decode( base64_decode( $custom ), true );
    }
    return $session_data;
}, 10, 2 );
```

---

### `uploads_unleashed_pre_finalize`

Validate or abort finalization before it begins. Use for custom validation rules.

**Parameters:**
- `$proceed` (true|WP_Error) - Whether to proceed with finalization.
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.
- `$chunk_path` (string) - Path to the uploaded file.

**Return:**
- `true` to proceed with finalization
- `WP_Error` to abort

**Example:**
```php
add_filter( 'uploads_unleashed_pre_finalize', function( $proceed, $upload_id, $upload_data, $chunk_path ) {
    // Custom validation for video files
    if ( 0 === strpos( $upload_data['filetype'], 'video/' ) ) {
        $duration = my_get_video_duration( $chunk_path );
        if ( $duration > 3600 ) {
            return new WP_Error(
                'video_too_long',
                'Videos must be under 1 hour.',
                array( 'status' => 400 )
            );
        }
    }
    return $proceed;
}, 10, 4 );
```

---

### `uploads_unleashed_finalize_upload`

Completely override the finalization process. Use for custom file handling (e.g., video transcoding, document processing).

**Parameters:**
- `$result` (array|WP_Error|null) - The result to return, or `null` to use default finalization.
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.
- `$chunk_path` (string) - Path to the uploaded file.

**Return:**
- Array to use as the response data (skips default finalization)
- `WP_Error` to abort with an error
- `null` to continue with default finalization

**Example:**
```php
add_filter( 'uploads_unleashed_finalize_upload', function( $result, $upload_id, $upload_data, $chunk_path ) {
    // Custom handling for video files
    if ( 0 !== strpos( $upload_data['filetype'], 'video/' ) ) {
        return null; // Use default for non-videos
    }

    // Create attachment via media_handle_sideload
    $file_data = array(
        'name'     => $upload_data['filename'],
        'type'     => $upload_data['filetype'],
        'tmp_name' => $chunk_path,
        'size'     => filesize( $chunk_path ),
        'error'    => 0,
    );

    $attachment_id = media_handle_sideload( $file_data, 0 );

    if ( is_wp_error( $attachment_id ) ) {
        return $attachment_id;
    }

    // Queue for processing
    $job_id = my_queue_video_processing( $attachment_id );

    return array(
        'id'        => $attachment_id,
        'job_id'    => $job_id,
        'status'    => 'processing',
    );
}, 10, 4 );
```

---

### `uploads_unleashed_attachment_data`

Filter the attachment data returned after successful finalization. Add custom fields to the response.

**Parameters:**
- `$attachment_data` (array) - The attachment data from `wp_prepare_attachment_for_js()`.
- `$attachment_id` (int) - The attachment ID.
- `$upload_data` (array) - The upload session data.

**Return:** array - The filtered attachment data.

**Example:**
```php
add_filter( 'uploads_unleashed_attachment_data', function( $data, $attachment_id, $upload_data ) {
    // Add processing status for videos
    $job_id = get_post_meta( $attachment_id, '_processing_job_id', true );
    if ( $job_id ) {
        $data['processing'] = array(
            'job_id' => $job_id,
            'status' => my_get_job_status( $job_id ),
        );
    }
    return $data;
}, 10, 3 );
```

---

### `uploads_unleashed_max_concurrent_uploads`

Override how many uploads run in parallel in the browser. Further files wait until an upload finishes. The limit applies to every upload that goes through the TUS client, in the Media Library, the block editor, and `media-new.php`.

Each running upload keeps a PHP worker busy with its current chunk. On hosts with only a few PHP workers, too many parallel uploads lead to 503 errors, so lower the limit there. Raise it on servers with many workers to upload batches of small files faster. The value is clamped to a minimum of 1.

**Since:** 1.2.0

**Parameters:**
- `$max_concurrent_uploads` (int) - Maximum number of parallel uploads. Default `3`.

**Return:** int - Maximum number of parallel uploads.

**Example:**
```php
add_filter( 'uploads_unleashed_max_concurrent_uploads', function() {
    // Shared host with two PHP workers: upload one file at a time.
    return 1;
} );
```

---

## Actions

### `uploads_unleashed_upload_created`

Fires after an upload session is created.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.
- `$request` (WP_REST_Request) - The REST request object.

**Example:**
```php
add_action( 'uploads_unleashed_upload_created', function( $upload_id, $upload_data, $request ) {
    // Log upload start
    error_log( sprintf(
        'Upload started: %s (%s bytes)',
        $upload_data['filename'],
        $upload_data['length']
    ) );
}, 10, 3 );
```

---

### `uploads_unleashed_chunk_received`

Fires after each chunk is received and stored.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$new_offset` (int) - The new byte offset after this chunk.
- `$upload_data` (array) - The upload session data.
- `$request` (WP_REST_Request) - The REST request object.

**Example:**
```php
add_action( 'uploads_unleashed_chunk_received', function( $upload_id, $new_offset, $upload_data, $request ) {
    // Track progress
    $progress = ( $new_offset / $upload_data['length'] ) * 100;
    my_update_upload_progress( $upload_id, $progress );
}, 10, 4 );
```

---

### `uploads_unleashed_upload_complete`

Fires after an upload is successfully finalized.

**Parameters:**
- `$attachment_id` (int) - The attachment ID (0 if custom finalization didn't create one).
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.

**Example:**
```php
add_action( 'uploads_unleashed_upload_complete', function( $attachment_id, $upload_id, $upload_data ) {
    // Notify user
    wp_mail(
        get_userdata( $upload_data['user_id'] )->user_email,
        'Upload Complete',
        sprintf( 'Your file "%s" has been uploaded.', $upload_data['filename'] )
    );
}, 10, 3 );
```

---

### `uploads_unleashed_upload_deleted`

Fires after an upload is canceled/deleted.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array|null) - The upload session data (null if already deleted).

**Example:**
```php
add_action( 'uploads_unleashed_upload_deleted', function( $upload_id, $upload_data ) {
    if ( $upload_data ) {
        error_log( sprintf( 'Upload canceled: %s', $upload_data['filename'] ) );
    }
}, 10, 2 );
```

---

## Complete Example: Video Processing Extension

This example shows how to build a complete extension that adds custom video processing:

```php
<?php
/**
 * Plugin Name: Video Processor for Uploads Unleashed
 * Description: Extends Uploads Unleashed with video processing.
 */

// 1. Store Custom Data in Session
add_filter( 'uploads_unleashed_session_data', 'vidproc_session_data', 10, 2 );
function vidproc_session_data( $session, $request ) {
    $custom_meta = $request->get_header( 'X-Video-Metadata' );
    if ( $custom_meta ) {
        $session['video'] = json_decode( base64_decode( $custom_meta ), true );
    }
    return $session;
}

// 2. Custom Video Finalization
add_filter( 'uploads_unleashed_finalize_upload', 'vidproc_finalize', 10, 4 );
function vidproc_finalize( $result, $upload_id, $upload_data, $chunk_path ) {
    // Only handle videos
    if ( 0 !== strpos( $upload_data['filetype'], 'video/' ) ) {
        return null;
    }

    // Create attachment via media_handle_sideload
    $file_data = array(
        'name'     => $upload_data['filename'],
        'type'     => $upload_data['filetype'],
        'tmp_name' => $chunk_path,
        'size'     => filesize( $chunk_path ),
        'error'    => 0,
    );

    $attachment_id = media_handle_sideload( $file_data, 0 );

    if ( is_wp_error( $attachment_id ) ) {
        return $attachment_id;
    }

    // Queue for processing and return custom response
    $job_id = vidproc_queue_transcode( $attachment_id );

    return array(
        'id'        => $attachment_id,
        'job_id'    => $job_id,
        'status'    => 'processing',
        'thumbnail' => '',
    );
}

// 3. Add Processing Status to All Responses
add_filter( 'uploads_unleashed_attachment_data', 'vidproc_attachment_data', 10, 3 );
function vidproc_attachment_data( $data, $attachment_id, $upload_data ) {
    $job_id = get_post_meta( $attachment_id, '_vidproc_job_id', true );
    if ( $job_id ) {
        $data['job_id'] = $job_id;
        $data['processing_status'] = vidproc_get_status( $job_id );
    }
    return $data;
}

// 4. Log Completed Uploads
add_action( 'uploads_unleashed_upload_complete', 'vidproc_log_complete', 10, 3 );
function vidproc_log_complete( $attachment_id, $upload_id, $upload_data ) {
    do_action( 'vidproc_upload_complete', $attachment_id );
}
```

## Best Practices

1. **Return `null` to use defaults** - For `uploads_unleashed_finalize_upload`, return `null` to let the default finalization handle files you don't need to customize.

2. **Clean up on errors** - If your custom finalization fails, return a `WP_Error`. The plugin will clean up the temporary files automatically.

3. **Store persistent data in session** - Use `uploads_unleashed_session_data` to store data that needs to persist across chunks and be available during finalization.

4. **Expect finalization to be replayed** - If a request dies during finalization, the next HEAD or PATCH for the upload resumes it. `uploads_unleashed_pre_finalize` and `uploads_unleashed_finalize_upload` run again if the file hadn't been moved yet; `uploads_unleashed_upload_complete` fires once. A custom finalization result is stored and returned for replays.

5. **Use upload_data for context** - The `$upload_data` array contains useful information like `filename`, `filetype`, `length`, `user_id`, and any custom fields you added via `uploads_unleashed_session_data`.
