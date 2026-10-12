#!/bin/sh
# Builds the single-file app: dist/index.html = ui.html + all scripts inline.
set -e
cd "$(dirname "$0")"
mkdir -p dist
{ cat src/ui.html; echo '<script>'; grep -v "module.exports" src/optimizer.js; grep -v "module.exports" src/ref2men.js; cat src/pdf.js; cat src/app.js; echo '</script>'; } > dist/index.html
echo "dist/index.html built"
