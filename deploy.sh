#!/usr/bin/env bash

set -e

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

mode="${1:-}"
target=""

if [ "$mode" = "prod" ]; then
  target="${TARGET_PROD:-}"
elif [ "$mode" = "mobile" ]; then
  target="${TARGET_MOBILE:-}"
elif [ "$mode" = "dev" ] || [ -z "$mode" ]; then
  target="${TARGET_DEV:-}"
else
  echo "Usage: ./deploy.sh [dev|prod|mobile]"
  exit 1
fi

if [ -z "$target" ]; then
  if [ "$mode" = "prod" ]; then
    echo "Deploy: TARGET_PROD not set, skipping."
  elif [ "$mode" = "mobile" ]; then
    echo "Deploy: TARGET_MOBILE not set, using ADB deployment."
    target="/sdcard/Documents/Obsidian/plugin-hermes"
  else
    echo "Deploy: TARGET_DEV not set, skipping."
    exit 0
  fi
fi

# Create updating file with timestamp
updating_file="updating_$(date +%Y%m%d_%H%M%S)"
touch "$updating_file"
echo "Deploy: created updating file: $updating_file"

# Check for required build files
missing_files=""
for file in manifest.json main.js styles.css; do
  if [ ! -f "$file" ]; then
    missing_files="$missing_files $file"
  fi
done

if [ -n "$missing_files" ]; then
  echo "Deploy: missing build files:$missing_files"
  rm "$updating_file"
  exit 1
fi

plugin_dir="$target/.obsidian/plugins/plugin-hermes"

if [ "$mode" = "mobile" ]; then
  # ADB deployment for mobile
  echo "Deploy: using ADB to deploy to mobile device"
  
  # Check if ADB is available and device is connected
  if ! command -v adb &> /dev/null; then
    echo "Deploy: ADB not found. Please install Android SDK platform-tools."
    exit 1
  fi
  
  if ! adb devices | grep -q "device$"; then
    echo "Deploy: No Android device connected. Please connect your device and enable USB debugging."
    exit 1
  fi
  
  # Create plugin directory on device
  adb shell "mkdir -p '$plugin_dir'" 2>/dev/null || true
  
  # Push files using ADB
  echo "Deploy: pushing files via ADB to $plugin_dir"
  adb push manifest.json "$plugin_dir/"
  adb push main.js "$plugin_dir/"
  adb push styles.css "$plugin_dir/"
  
  # Create hot-reload file on device
  adb shell "touch '$plugin_dir/.hotreload'"
  echo "Deploy: created hot-reload trigger file on device"
  
else
  # Regular file system deployment for dev/prod
  if [ -d "$plugin_dir" ]; then
    echo "ALERT: target plugin folder exists: $plugin_dir"
  else
    mkdir -p "$plugin_dir"
  fi

  cp manifest.json main.js styles.css "$plugin_dir"/
  echo "Deploy: copied files to $plugin_dir"

  # Touch dummy file to trigger hot-reload
  touch "$plugin_dir"/.hotreload
  echo "Deploy: touched dummy file to trigger hot-reload"
fi

# Delete updating file when done
rm "$updating_file"
echo "Deploy: deleted updating file: $updating_file"
