# Hooks Reference

The Resumable Uploads plugin provides filters and actions that allow other plugins to extend its functionality. This enables custom metadata handling, file processing, and more.

## Filters

### `resumable_uploads_max_upload_size`

Override the maximum allowed upload size.

**Parameters:**
- `$max_size` (int) - The maximum upload size in bytes.
- `$request` (WP_REST_Request) - The REST request object.

**Return:** int - The maximum upload size in bytes.

**Example:**
```php
add_filter( 'resumable_uploads_max_upload_size', function( $max_size, $request ) {
    // Premium users get larger uploads
    if ( current_user_can( 'upload_large_files' ) ) {
        return 10 * GB_IN_BYTES;
    }
    return $max_size;
}, 10, 2 );
```

---

### `resumable_uploads_session_data`

Filter session data before it's stored. Add custom fields to persist throughout the upload.

**Parameters:**
- `$session_data` (array) - The session data to be stored.
- `$request` (WP_REST_Request) - The REST request object.

**Return:** array - The filtered session data.

**Example:**
```php
add_filter( 'resumable_uploads_session_data', function( $session_data, $request ) {
    // Store custom data from a header with the session
    $custom = $request->get_header( 'X-Custom-Metadata' );
    if ( $custom ) {
        $session_data['custom'] = json_decode( base64_decode( $custom ), true );
    }
    return $session_data;
}, 10, 2 );
```

---

### `resumable_uploads_pre_finalize`

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
add_filter( 'resumable_uploads_pre_finalize', function( $proceed, $upload_id, $upload_data, $chunk_path ) {
    // Custom validation for video files
    if ( str_starts_with( $upload_data['filetype'], 'video/' ) ) {
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

### `resumable_uploads_finalize_upload`

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
add_filter( 'resumable_uploads_finalize_upload', function( $result, $upload_id, $upload_data, $chunk_path ) {
    // Custom handling for video files
    if ( ! str_starts_with( $upload_data['filetype'], 'video/' ) ) {
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

### `resumable_uploads_attachment_data`

Filter the attachment data returned after successful finalization. Add custom fields to the response.

**Parameters:**
- `$attachment_data` (array) - The attachment data from `wp_prepare_attachment_for_js()`.
- `$attachment_id` (int) - The attachment ID.
- `$upload_data` (array) - The upload session data.

**Return:** array - The filtered attachment data.

**Example:**
```php
add_filter( 'resumable_uploads_attachment_data', function( $data, $attachment_id, $upload_data ) {
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

## Actions

### `resumable_uploads_upload_created`

Fires after an upload session is created.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.
- `$request` (WP_REST_Request) - The REST request object.

**Example:**
```php
add_action( 'resumable_uploads_upload_created', function( $upload_id, $upload_data, $request ) {
    // Log upload start
    error_log( sprintf(
        'Upload started: %s (%s bytes)',
        $upload_data['filename'],
        $upload_data['length']
    ) );
}, 10, 3 );
```

---

### `resumable_uploads_chunk_received`

Fires after each chunk is received and stored.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$new_offset` (int) - The new byte offset after this chunk.
- `$upload_data` (array) - The upload session data.
- `$request` (WP_REST_Request) - The REST request object.

**Example:**
```php
add_action( 'resumable_uploads_chunk_received', function( $upload_id, $new_offset, $upload_data, $request ) {
    // Track progress
    $progress = ( $new_offset / $upload_data['length'] ) * 100;
    my_update_upload_progress( $upload_id, $progress );
}, 10, 4 );
```

---

### `resumable_uploads_upload_complete`

Fires after an upload is successfully finalized.

**Parameters:**
- `$attachment_id` (int) - The attachment ID (0 if custom finalization didn't create one).
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array) - The upload session data.

**Example:**
```php
add_action( 'resumable_uploads_upload_complete', function( $attachment_id, $upload_id, $upload_data ) {
    // Notify user
    wp_mail(
        get_userdata( $upload_data['user_id'] )->user_email,
        'Upload Complete',
        sprintf( 'Your file "%s" has been uploaded.', $upload_data['filename'] )
    );
}, 10, 3 );
```

---

### `resumable_uploads_upload_deleted`

Fires after an upload is canceled/deleted.

**Parameters:**
- `$upload_id` (string) - The upload ID.
- `$upload_data` (array|null) - The upload session data (null if already deleted).

**Example:**
```php
add_action( 'resumable_uploads_upload_deleted', function( $upload_id, $upload_data ) {
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
 * Plugin Name: Video Processor for Resumable Uploads
 * Description: Extends Resumable Uploads with video processing.
 */

// 1. Store Custom Data in Session
add_filter( 'resumable_uploads_session_data', 'vidproc_session_data', 10, 2 );
function vidproc_session_data( $session, $request ) {
    $custom_meta = $request->get_header( 'X-Video-Metadata' );
    if ( $custom_meta ) {
        $session['video'] = json_decode( base64_decode( $custom_meta ), true );
    }
    return $session;
}

// 2. Custom Video Finalization
add_filter( 'resumable_uploads_finalize_upload', 'vidproc_finalize', 10, 4 );
function vidproc_finalize( $result, $upload_id, $upload_data, $chunk_path ) {
    // Only handle videos
    if ( ! str_starts_with( $upload_data['filetype'], 'video/' ) ) {
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
add_filter( 'resumable_uploads_attachment_data', 'vidproc_attachment_data', 10, 3 );
function vidproc_attachment_data( $data, $attachment_id, $upload_data ) {
    $job_id = get_post_meta( $attachment_id, '_vidproc_job_id', true );
    if ( $job_id ) {
        $data['job_id'] = $job_id;
        $data['processing_status'] = vidproc_get_status( $job_id );
    }
    return $data;
}

// 4. Log Completed Uploads
add_action( 'resumable_uploads_upload_complete', 'vidproc_log_complete', 10, 3 );
function vidproc_log_complete( $attachment_id, $upload_id, $upload_data ) {
    do_action( 'vidproc_upload_complete', $attachment_id );
}
```

## Best Practices

1. **Return `null` to use defaults** - For `resumable_uploads_finalize_upload`, return `null` to let the default finalization handle files you don't need to customize.

2. **Clean up on errors** - If your custom finalization fails, return a `WP_Error`. The plugin will clean up the temporary files automatically.

3. **Store persistent data in session** - Use `resumable_uploads_session_data` to store data that needs to persist across chunks and be available during finalization.

4. **Use upload_data for context** - The `$upload_data` array contains useful information like `filename`, `filetype`, `length`, `user_id`, and any custom fields you added via `resumable_uploads_session_data`.
