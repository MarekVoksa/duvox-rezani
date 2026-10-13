#!/bin/sh
# Builds the app from src/:
#   dist/               the website for Cloudflare Pages (index.html + icons + manifest)
#   build/artifact.html the same app as one fragment for the claude.ai artifact
set -e
cd "$(dirname "$0")"
mkdir -p dist build
{ cat src/ui.html; echo '<script>'; grep -v "module.exports" src/optimizer.js; grep -v "module.exports" src/ref2men.js; cat src/pdf.js; cat src/app.js; echo '</script>'; } > build/artifact.html
{
  echo '<!doctype html><html lang="cs"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  echo '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="apple-touch-icon.png">'
  echo '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Řezání">'
  echo '</head><body>'
  cat build/artifact.html
  echo '</body></html>'
} > dist/index.html
cp public/* dist/
echo "built dist/ and build/artifact.html"
