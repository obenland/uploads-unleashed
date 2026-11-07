#!/usr/bin/env bash
#
# Prints the WordPress version that bin/install-wp-tests.sh installs for a
# version argument, so CI can key its caches on it.
#
# Usage: bin/resolve-wp-version.sh [latest|nightly|X.Y|X.Y.Z]
#
#   latest   the current stable release
#   nightly  the nightly build of trunk (also accepts `trunk`); printed as is
#   X.Y      the newest release of that branch, e.g. 6.4 → 6.4.x
#   X.Y.Z    printed as is

set -euo pipefail

WP_VERSION=${1:-latest}

case "$WP_VERSION" in
	nightly | trunk)
		echo nightly
		exit 0
		;;
	latest)
		# shellcheck disable=SC2016 # PHP code, not shell.
		VERSION=$(curl -fsSL https://api.wordpress.org/core/version-check/1.7/ | php -r 'echo json_decode( stream_get_contents( STDIN ) )->offers[0]->version;')
		;;
	*)
		if [[ "$WP_VERSION" =~ ^[0-9]+\.[0-9]+$ ]]; then
			# Lists every release; pick the newest one of the branch.
			# shellcheck disable=SC2016 # PHP code, not shell.
			VERSION=$(curl -fsSL https://api.wordpress.org/core/stable-check/1.0/ | php -r '
				$branch   = $argv[1];
				$versions = array_filter(
					array_keys( json_decode( stream_get_contents( STDIN ), true ) ),
					function ( $version ) use ( $branch ) {
						return $version === $branch || 0 === strpos( $version, "$branch." );
					}
				);
				usort( $versions, "version_compare" );
				echo end( $versions );
			' "$WP_VERSION")
		else
			VERSION=$WP_VERSION
		fi
		;;
esac

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
	echo "Could not resolve WordPress version '$WP_VERSION' (got '$VERSION')" >&2
	exit 1
fi

echo "$VERSION"
