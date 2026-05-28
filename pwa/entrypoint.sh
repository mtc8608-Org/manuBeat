#!/bin/bash
echo "Installing dependencies..."
npm install
echo "Done."
echo "Starting ionic $@..."
exec ionic "$@"
