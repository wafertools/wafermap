#!/bin/sh
# Start the local server for the wafermap examples package.
#   sh serve.sh [port]
#
# Invoked as `sh serve.sh` in the docs because some Windows extractors drop the
# executable bit, which would make ./serve.sh fail with "permission denied".
set -e

cd "$(dirname "$0")"

for py in python3 python py; do
  if command -v "$py" >/dev/null 2>&1; then
    exec "$py" serve.py "$@"
  fi
done

echo "No Python found. Install Python 3, or serve this folder any other way:" >&2
echo "  npx http-server -p 8080 ." >&2
echo "(Do not use 'npx serve' — it 404s on the .js files in dist/.)" >&2
exit 1
