=== Resumable Uploads ===
Contributors: obenland
Tags: uploads, media, tus, resumable, large files
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.2.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

TUS protocol support for resumable media uploads in WordPress.

== Description ==

Resumable Uploads adds support for the [TUS resumable upload protocol](https://tus.io/) to WordPress, enabling reliable uploads of large files that can resume after network interruptions.

= Features =

* **Resumable uploads** - Uploads automatically resume from where they left off after connection failures
* **Large file support** - Bypasses PHP upload limits by chunking files
* **Progress tracking** - Real-time upload progress in the media uploader
* **Transparent integration** - Works with the existing WordPress media library interface
* **Extensible** - Filter and action hooks for custom workflows

= How It Works =

The plugin implements TUS 1.0.0 protocol via a REST API endpoint at `/wp/v2/media/tus`. When you upload a file through the media library, the plugin:

1. Creates an upload session with metadata
2. Sends the file in chunks
3. Automatically resumes if the connection drops
4. Finalizes the upload and creates a media attachment

= Requirements =

* WordPress 6.4 or higher
* PHP 7.4 or higher

= Third-Party Libraries =

This plugin includes [tus-js-client](https://github.com/tus/tus-js-client) (MIT License) for implementing the TUS protocol on the client side.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/resumable-uploads/`
2. Activate the plugin through the 'Plugins' screen in WordPress
3. That's it! The media uploader will automatically use resumable uploads

== Frequently Asked Questions ==

= Does this work with the block editor? =

Yes, resumable uploads work anywhere the WordPress media uploader is used, including the block editor.

= What happens to in-progress uploads if my browser crashes? =

Upload sessions are stored for 24 hours. If you return within that time, the upload can resume from where it stopped.

= Can I upload files larger than my server's PHP limit? =

Yes! Since files are uploaded in chunks, the PHP `upload_max_filesize` limit doesn't apply. The actual limit is your available disk space.

= Does this work on multisite? =

Yes, the plugin respects multisite upload quotas.

= Does this plugin collect any user data? =

No. Upload session data is stored temporarily on your server and automatically deleted after 24 hours.

== Changelog ==

= 0.2.0 =
* Initial release.
