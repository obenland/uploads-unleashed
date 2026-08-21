# Uploads Unleashed
Contributors: obenland
Tags: uploads, photos, import, video, media
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Upload large files to WordPress without hitting size limits or losing progress when your connection drops.

## Description

Ever tried uploading a video or large image to WordPress and hit the dreaded "exceeds the maximum upload size" error? Or watched a long upload fail at 90% because your connection blipped?

Uploads Unleashed fixes both problems. Instead of sending your files all at once, it splits them into small pieces behind the scenes. This means:

* **Get past upload size limits.** Upload files larger than what your server normally allows — no need to contact your host or edit config files.
* **No more starting over.** If your connection drops, or you close your browser, come back and pick up right where you left off.
* **Real-time progress.** Watch your upload progress as it happens.

It works everywhere you upload in WordPress — the Media Library, the block editor, and the classic editor. Just activate the plugin and you're done. There are no settings to configure.

## Installation

1. Upload the plugin files to `/wp-content/plugins/uploads-unleashed/`
2. Activate the plugin through the 'Plugins' screen in WordPress
3. That's it — start uploading.

## Frequently Asked Questions

### How does it get around my server's upload limit?

Instead of sending the entire file in one go, the plugin sends it in small pieces. Each piece is well within your server's limit, so the full file gets through without any issues.

### What happens if my upload gets interrupted?

Your progress is saved for 24 hours. When you come back and select the same file, the upload picks up right where it stopped.

### Where does this work?

Everywhere you upload media in WordPress: the Media Library, the block editor, the classic editor, and anywhere else that uses the standard media uploader.

### Do I need to change any server settings?

No. Just install and activate the plugin. It works out of the box on any standard WordPress host.

### Is there a file size limit?

The only limit is your available disk space. On multisite, your network's upload quota still applies. The plugin itself doesn't impose any additional cap.

### Does this work on multisite?

Yes. Network upload quotas are still respected.

### Does this plugin collect any data?

No. Upload session data is stored temporarily on your server and automatically deleted after 24 hours.

### What happens if I deactivate the plugin?

WordPress goes back to handling uploads the way it normally does. Files you already uploaded stay in your Media Library. Any temporary upload data will be automatically cleaned up.

## Screenshots

1. Resumable uploads — pick up where you left off after a connection drop.

## Changelog

### 1.1.0
* Fix HEAD request 404 on nginx servers by @obenland in #53
* Use proper package imports for WordPress dependencies by @obenland in #56
* Add pre-flight multisite quota check by @obenland in #55
* Add accessibility to resume UI by @obenland in #54
* Add snackbar warning on block editor TUS fallback by @obenland in #57
* Add WP-CLI command for upload session management by @obenland in #60
* Replace alert() with inline help text and error in resume UI by @obenland in #58
* Add @subcommand annotation for WP-CLI list command by @obenland in #62
* Add pending uploads notice to Block Editor and Media Library by @obenland in #61

### 1.0.0
* Add uploadsUnleashed.shouldUseTus filter for VideoPress compatibility.
* Add plupload and VideoPress compat tests, improve detection.
* Add uninstall handler to clean up chunk data.
* Validate Upload-Length minimum and enforce chunk size limits.
* Clear stat cache before finalization.
* Use wp.media.attachment for legacy format after TUS upload.
* Use DOM APIs instead of innerHTML in pending uploads UI.
* Show upload progress percentage for pending uploads.
* Improve test coverage to 100% JS lines and 93% PHP lines.
* Automate version bumps in release workflow.

### 0.1.0
* Initial release.
