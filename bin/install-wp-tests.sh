#!/usr/bin/env bash
#
# Installs WordPress and the WordPress PHPUnit test library, so the plugin's
# PHPUnit tests can run against a local MySQL server without wp-env.
#
# Usage: bin/install-wp-tests.sh <db-name> <db-user> <db-pass> [db-host] [wp-version]
#
# Honors WP_CORE_DIR and WP_TESTS_DIR (default: $TMPDIR/wordpress and
# $TMPDIR/wordpress-tests-lib). Existing installs are reused, so both
# directories can be cached between runs.

set -euo pipefail

if [ $# -lt 3 ]; then
	echo "Usage: $0 <db-name> <db-user> <db-pass> [db-host] [wp-version]" >&2
	exit 1
fi

DB_NAME=$1
DB_USER=$2
DB_PASS=$3
DB_HOST=${4:-localhost}
WP_VERSION=${5:-latest}

TMPDIR=${TMPDIR:-/tmp}
TMPDIR=${TMPDIR%/}
WP_CORE_DIR=${WP_CORE_DIR:-$TMPDIR/wordpress}
WP_TESTS_DIR=${WP_TESTS_DIR:-$TMPDIR/wordpress-tests-lib}
PLUGIN_DIR=$(cd "$(dirname "$0")/.." && pwd)

if [ "$WP_VERSION" = 'latest' ]; then
	WP_VERSION=$(curl -fsSL https://api.wordpress.org/core/version-check/1.7/ | php -r 'echo json_decode( stream_get_contents( STDIN ) )->offers[0]->version;')
fi

echo "Installing WordPress $WP_VERSION"

if [ ! -f "$WP_CORE_DIR/wp-includes/version.php" ]; then
	mkdir -p "$WP_CORE_DIR"
	curl -fsSL "https://wordpress.org/wordpress-$WP_VERSION.tar.gz" | tar -xz --strip-components=1 -C "$WP_CORE_DIR"
fi

if [ ! -f "$WP_TESTS_DIR/includes/functions.php" ]; then
	DEVELOP_DIR=$(mktemp -d)
	git clone --quiet --depth=1 --filter=blob:none --sparse --branch "$WP_VERSION" https://github.com/WordPress/wordpress-develop.git "$DEVELOP_DIR"
	git -C "$DEVELOP_DIR" sparse-checkout set tests/phpunit/includes tests/phpunit/data
	mkdir -p "$WP_TESTS_DIR"
	cp -R "$DEVELOP_DIR/tests/phpunit/includes" "$DEVELOP_DIR/tests/phpunit/data" "$DEVELOP_DIR/wp-tests-config-sample.php" "$WP_TESTS_DIR/"
	rm -rf "$DEVELOP_DIR"
fi

# Some tests read the plugin from WP_PLUGIN_DIR, as wp-env mounts it there.
ln -sfn "$PLUGIN_DIR" "$WP_CORE_DIR/wp-content/plugins/uploads-unleashed"

# Written on every run so changed credentials take effect with a cached install.
# shellcheck disable=SC2016 # PHP code, not shell.
php -r '
	list( , $sample, $target, $abspath, $name, $user, $pass, $host ) = $argv;
	file_put_contents(
		$target,
		strtr(
			file_get_contents( $sample ),
			array(
				"dirname( __FILE__ ) . \x27/src/\x27" => var_export( rtrim( $abspath, "/" ) . "/", true ),
				"youremptytestdbnamehere"             => $name,
				"yourusernamehere"                    => $user,
				"yourpasswordhere"                    => $pass,
				"localhost"                           => $host,
			)
		)
	);
' "$WP_TESTS_DIR/wp-tests-config-sample.php" "$WP_TESTS_DIR/wp-tests-config.php" "$WP_CORE_DIR" "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"

# Uses PHP's mysqli rather than the mysql client, which isn't always installed.
# shellcheck disable=SC2016 # PHP code, not shell.
php -r '
	list( , $name, $user, $pass, $host ) = $argv;
	list( $hostname, $port ) = array_pad( explode( ":", $host, 2 ), 2, 3306 );
	$mysqli = new mysqli( $hostname, $user, $pass, "", (int) $port );
	$mysqli->query( "CREATE DATABASE IF NOT EXISTS `" . $mysqli->real_escape_string( $name ) . "`" );
' "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"

echo "Done. Run: WP_TESTS_DIR=$WP_TESTS_DIR vendor/bin/phpunit"
