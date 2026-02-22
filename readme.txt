=== Uploads Unleashed ===
Contributors: obenland
Tags: uploads, photos, import, video, media
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.0.1-test.1
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Upload large files to WordPress without hitting size limits or losing progress when your connection drops.

== Description ==

Ever tried uploading a video or large image to WordPress and hit the dreaded "exceeds the maximum upload size" error? Or watched a long upload fail at 90% because your connection blipped?

Uploads Unleashed fixes both problems. Instead of sending your files all at once, it splits them into small pieces behind the scenes. This means:

* **Get past upload size limits.** Upload files larger than what your server normally allows — no need to contact your host or edit config files.
* **No more starting over.** If your connection drops, or you close your browser, come back and pick up right where you left off.
* **Real-time progress.** Watch your upload progress as it happens.

It works everywhere you upload in WordPress — the Media Library, the block editor, and the classic editor. Just activate the plugin and you're done. There are no settings to configure.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/uploads-unleashed/`
2. Activate the plugin through the 'Plugins' screen in WordPress
3. That's it — start uploading.

== Frequently Asked Questions ==

= How does it get around my server's upload limit? =

Instead of sending the entire file in one go, the plugin sends it in small pieces. Each piece is well within your server's limit, so the full file gets through without any issues.

= What happens if my upload gets interrupted? =

Your progress is saved for 24 hours. When you come back and select the same file, the upload picks up right where it stopped.

= Where does this work? =

Everywhere you upload media in WordPress: the Media Library, the block editor, the classic editor, and anywhere else that uses the standard media uploader.

= Do I need to change any server settings? =

No. Just install and activate the plugin. It works out of the box on any standard WordPress host.

= Is there a file size limit? =

On a regular WordPress site, the only limit is your available disk space. On multisite, your network's upload quota still applies. The plugin itself doesn't impose any additional cap.

= Does this work on multisite? =

Yes. Network upload quotas are still respected.

= Does this plugin collect any data? =

No. Upload session data is stored temporarily on your server and automatically deleted after 24 hours.

= What happens if I deactivate the plugin? =

WordPress goes back to handling uploads the way it normally does. Files you already uploaded stay in your Media Library. Any temporary upload data will be automatically cleaned up.

== Changelog ==

= 0.1.0 =
* Initial release.
