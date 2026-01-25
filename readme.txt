=== Uploads Unleashed ===
Contributors: obenland
Tags: large files, upload limit, media upload, file upload, video upload, upload failed, big files, upload timeout, upload size, reliable upload, resumable, media
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Upload large files to WordPress without hitting size limits or losing progress when your connection drops.

== Description ==

Uploads Unleashed removes the frustrating barriers to uploading large files in WordPress. Upload videos, high-resolution images, or any large media file without running into PHP size limits or starting over when your connection hiccups.

What it fixes:

* Upload files larger than your server's PHP limit normally allows.
* If your connection drops mid-upload, pick up where you left off instead of starting over.
* See real-time progress as your file uploads.

Just activate the plugin. No settings to configure - your media uploader automatically gets these improvements.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/uploads-unleashed/`
2. Activate the plugin through the 'Plugins' screen in WordPress
3. That's it - start uploading.

== Frequently Asked Questions ==

= How does it handle large files? =

The plugin uploads files in small pieces instead of all at once. This bypasses PHP's upload size limit and makes uploads more reliable on slower connections.

= What happens if my upload gets interrupted? =

Your progress is saved for 24 hours. Come back and the upload resumes from where it stopped - no need to start over.

= Where does this work? =

Everywhere you upload media in WordPress: the Media Library, block editor, classic editor, and anywhere else that uses the standard media uploader.

= Does this work on multisite? =

Yes. Upload quotas are still respected.

= Does this plugin collect any data? =

No. Upload session data is stored temporarily on your server and automatically deleted after 24 hours.

= What's the actual file size limit? =

Your available disk space. There's no artificial cap.

== Changelog ==

= 0.1.0 =
* Initial release.
