#!/usr/bin/env bash
#
# Installs a fresh WordPress site with the plugin active and serves it with
# PHP's built-in server, so the e2e tests can run without wp-env.
#
# Usage: bin/start-e2e-wordpress.sh <db-user> <db-pass> [db-host] [wp-version]
#
# Matches the wp-env defaults the tests expect: admin / password on
# http://localhost:${WP_ENV_PORT:-8888}. Honors WP_E2E_DIR (default:
# $TMPDIR/wordpress-e2e); an existing download of the same version is reused,
# the database is recreated on every run. The server keeps running in the
# background, logs to $WP_E2E_DIR/server.log and writes its PID to
# $WP_E2E_DIR/server.pid; a rerun stops the previous server first.

set -euo pipefail

if [ $# -lt 2 ]; then
	echo "Usage: $0 <db-user> <db-pass> [db-host] [wp-version]" >&2
	exit 1
fi

DB_USER=$1
DB_PASS=$2
DB_HOST=${3:-localhost}
WP_VERSION=${4:-latest}
DB_NAME=wordpress_e2e

TMPDIR=${TMPDIR:-/tmp}
TMPDIR=${TMPDIR%/}
WP_E2E_DIR=${WP_E2E_DIR:-$TMPDIR/wordpress-e2e}
PORT=${WP_ENV_PORT:-8888}
URL="http://localhost:$PORT"
PLUGIN_DIR=$(cd "$(dirname "$0")/.." && pwd)
PID_FILE="$WP_E2E_DIR/server.pid"

if [ "$WP_VERSION" = 'latest' ]; then
	WP_VERSION=$(curl -fsSL https://api.wordpress.org/core/version-check/1.7/ | php -r 'echo json_decode( stream_get_contents( STDIN ) )->offers[0]->version;')
fi

# Workers outlive a killed parent, so stop them along with it.
if [ -f "$PID_FILE" ]; then
	OLD_PID=$(cat "$PID_FILE")
	if ps -p "$OLD_PID" -o command= | grep -q 'php -S'; then
		read -ra OLD_PIDS <<<"$OLD_PID $(pgrep -P "$OLD_PID" | xargs || true)"
		kill "${OLD_PIDS[@]}" 2>/dev/null || true
		for pid in "${OLD_PIDS[@]}"; do
			while kill -0 "$pid" 2>/dev/null; do
				sleep 0.1
			done
		done
	fi
	rm -f "$PID_FILE"
fi

if curl -s -o /dev/null --max-time 2 "$URL"; then
	echo "Port $PORT is already in use; set WP_ENV_PORT to a free port" >&2
	exit 1
fi

# shellcheck disable=SC2016 # PHP code, not shell.
if [ -f "$WP_E2E_DIR/wp-includes/version.php" ] && [ "$(php -r 'include $argv[1]; echo $wp_version;' "$WP_E2E_DIR/wp-includes/version.php")" != "$WP_VERSION" ]; then
	rm -rf "$WP_E2E_DIR"
fi

if [ ! -f "$WP_E2E_DIR/wp-includes/version.php" ]; then
	echo "Downloading WordPress $WP_VERSION"
	mkdir -p "$WP_E2E_DIR"
	curl -fsSL "https://wordpress.org/wordpress-$WP_VERSION.tar.gz" | tar -xz --strip-components=1 -C "$WP_E2E_DIR"
fi

ln -sfn "$PLUGIN_DIR" "$WP_E2E_DIR/wp-content/plugins/uploads-unleashed"
rm -rf "$WP_E2E_DIR/wp-content/uploads"

# Same debug settings as .wp-env.json.
# shellcheck disable=SC2016 # PHP code, not shell.
php -r '
	list( , $dir, $name, $user, $pass, $host ) = $argv;
	$config = strtr(
		file_get_contents( "$dir/wp-config-sample.php" ),
		array(
			"database_name_here" => $name,
			"username_here"      => $user,
			"password_here"      => $pass,
			"localhost"          => $host,
			"define( \x27WP_DEBUG\x27, false );" => "define( \x27WP_DEBUG\x27, true );\ndefine( \x27WP_DEBUG_LOG\x27, true );\ndefine( \x27SCRIPT_DEBUG\x27, true );",
		)
	);
	file_put_contents( "$dir/wp-config.php", $config );

	list( $hostname, $port ) = array_pad( explode( ":", $host, 2 ), 2, 3306 );
	mysqli_report( MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT );
	$mysqli = new mysqli( $hostname, $user, $pass, "", (int) $port );
	$db     = "`" . $mysqli->real_escape_string( $name ) . "`";
	$mysqli->query( "DROP DATABASE IF EXISTS $db" );
	$mysqli->query( "CREATE DATABASE $db" );
' "$WP_E2E_DIR" "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"

# shellcheck disable=SC2016 # PHP code, not shell.
php -r '
	list( , $dir, $url ) = $argv;
	$done = false;
	register_shutdown_function(
		function () use ( &$done ) {
			// wp_die() exits with status 0, so treat any early exit as a failure.
			if ( ! $done ) {
				exit( 1 );
			}
		}
	);
	define( "WP_INSTALLING", true );
	$_SERVER["HTTP_HOST"] = parse_url( $url, PHP_URL_HOST ) . ":" . parse_url( $url, PHP_URL_PORT );
	require "$dir/wp-load.php";
	require_once ABSPATH . "wp-admin/includes/upgrade.php";
	wp_install( "Uploads Unleashed E2E", "admin", "admin@example.org", true, "", "password" );
	if ( ! is_blog_installed() ) {
		fwrite( STDERR, "WordPress installation failed." . PHP_EOL );
		exit( 1 );
	}
	update_option( "siteurl", $url );
	update_option( "home", $url );
	require_once ABSPATH . "wp-admin/includes/plugin.php";
	$activated = activate_plugin( "uploads-unleashed/uploads-unleashed.php" );
	if ( is_wp_error( $activated ) ) {
		fwrite( STDERR, $activated->get_error_message() . PHP_EOL );
		exit( 1 );
	}
	$done = true;
' "$WP_E2E_DIR" "$URL"

# Several workers, so wp-admin's parallel asset requests don't queue up.
PHP_CLI_SERVER_WORKERS=${PHP_CLI_SERVER_WORKERS:-4} nohup php -S "localhost:$PORT" -t "$WP_E2E_DIR" >"$WP_E2E_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

for _ in $(seq 1 30); do
	if ! kill -0 "$SERVER_PID" 2>/dev/null; then
		break
	fi
	if curl -fs -o /dev/null "$URL/wp-login.php"; then
		echo "WordPress $WP_VERSION is running at $URL"
		exit 0
	fi
	sleep 1
done

echo "WordPress did not start; see $WP_E2E_DIR/server.log" >&2
exit 1
