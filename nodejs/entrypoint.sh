#!/bin/bash
echo "Installing dependencies..."
rm -rf node_modules &>/dev/null

### Uncomment if you want to remove package-lock.json to
### avoid conflicts with npm install and force a fresh install
#rm -f package-lock.json &>/dev/null


npm install
echo "Done."
echo "Starting $@..."
exec node_modules/.bin/nodemon $@.js

