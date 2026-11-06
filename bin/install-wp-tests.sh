#!/usr/bin/env bash
#
# Installs WordPress and the WordPress PHPUnit test library, so the plugin's
# PHPUnit tests can run against a local MySQL server without wp-env.
#
# Usage: bin/install-wp-tests.sh <db-name> <db-user> <db-pass> [db-host] [wp-version]
#
# Honors WP_CORE_DIR and WP_TESTS_DIR (default: $TMPDIR/wordpress and
# $TMPDIR/wordpress-tests-lib). Existing installs of the same version are
# reused, so both directories can be cached between runs.

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

if [ "$WP_VERSION" = 'latest' ]; then
	WP_VERSION=$(curl -fsSL https://api.wordpress.org/core/version-check/1.7/ | php -r 'echo json_decode( stream_get_contents( STDIN ) )->offers[0]->version;')
fi

echo "Installing WordPress $WP_VERSION"

# wordpress-develop tags x.y releases as x.y.0.
TESTS_TAG=$WP_VERSION
if [[ "$TESTS_TAG" =~ ^[0-9]+\.[0-9]+$ ]]; then
	TESTS_TAG=$TESTS_TAG.0
fi

# Replace an existing install of a different version.
if [ -f "$WP_CORE_DIR/wp-includes/version.php" ]; then
	# shellcheck disable=SC2016 # PHP code, not shell.
	CORE_VERSION=$(php -r 'include $argv[1]; echo $wp_version;' "$WP_CORE_DIR/wp-includes/version.php")
	if [ "$CORE_VERSION" != "$WP_VERSION" ]; then
		rm -rf "$WP_CORE_DIR"
	fi
fi

if [ -f "$WP_TESTS_DIR/includes/functions.php" ] && [ "$(cat "$WP_TESTS_DIR/.version" 2>/dev/null)" != "$WP_VERSION" ]; then
	rm -rf "$WP_TESTS_DIR"
fi

if [ ! -f "$WP_CORE_DIR/wp-includes/version.php" ]; then
	mkdir -p "$WP_CORE_DIR"
	curl -fsSL "https://wordpress.org/wordpress-$WP_VERSION.tar.gz" | tar -xz --strip-components=1 -C "$WP_CORE_DIR"
fi

if [ ! -f "$WP_TESTS_DIR/includes/functions.php" ]; then
	DEVELOP_DIR=$(mktemp -d)
	git clone --quiet --depth=1 --filter=blob:none --sparse --branch "$TESTS_TAG" https://github.com/WordPress/wordpress-develop.git "$DEVELOP_DIR"
	git -C "$DEVELOP_DIR" sparse-checkout set tests/phpunit/includes tests/phpunit/data
	mkdir -p "$WP_TESTS_DIR"
	cp -R "$DEVELOP_DIR/tests/phpunit/includes" "$DEVELOP_DIR/tests/phpunit/data" "$DEVELOP_DIR/wp-tests-config-sample.php" "$WP_TESTS_DIR/"
	echo "$WP_VERSION" > "$WP_TESTS_DIR/.version"
	rm -rf "$DEVELOP_DIR"
fi

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
				"\x27youremptytestdbnamehere\x27"     => var_export( $name, true ),
				"\x27yourusernamehere\x27"            => var_export( $user, true ),
				"\x27yourpasswordhere\x27"            => var_export( $pass, true ),
				"\x27localhost\x27"                   => var_export( $host, true ),
			)
		)
	);
' "$WP_TESTS_DIR/wp-tests-config-sample.php" "$WP_TESTS_DIR/wp-tests-config.php" "$WP_CORE_DIR" "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"

# Uses PHP's mysqli rather than the mysql client, which isn't always installed.
# shellcheck disable=SC2016 # PHP code, not shell.
php -r '
	list( , $name, $user, $pass, $host ) = $argv;
	list( $hostname, $suffix ) = array_pad( explode( ":", $host, 2 ), 2, "" );
	$port   = ctype_digit( $suffix ) ? (int) $suffix : 3306;
	$socket = ( "" !== $suffix && ! ctype_digit( $suffix ) ) ? $suffix : null;
	mysqli_report( MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT );
	$mysqli = new mysqli( $hostname, $user, $pass, "", $port, $socket );
	$mysqli->query( "CREATE DATABASE IF NOT EXISTS `" . $mysqli->real_escape_string( $name ) . "`" );
' "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"

echo "Done. Run: WP_TESTS_DIR=$WP_TESTS_DIR vendor/bin/phpunit"
