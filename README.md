# Last Tab

A Chrome extension that lets you quickly return to the last tab you were viewing with a keyboard shortcut.

## Features

- Return to your most recently viewed tab by pressing `Ctrl+B` (or `Command+B` on Mac)
- Works even if the tab is in a different window
- Automatically focuses the window containing the last tab
- Tracks tabs when switching between windows and tabs within the same window

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked" and select the directory containing this extension
5. The extension should now be installed and ready to use

## Usage

1. Browse normally in Chrome, switching between different tabs
2. When you want to go back to your previous tab, press `Ctrl+B` (or `Command+B` on Mac)
3. The extension will immediately switch you back to the previous tab
4. If that tab was in a different window, the window will be focused automatically

## Customizing the Keyboard Shortcut

1. Go to `chrome://extensions/shortcuts`
2. Find "Last Tab" in the list
3. Click the pencil icon next to "Switch to the last active tab"
4. Press the key combination you want to use
5. Click "OK" to save

## Files

- `manifest.json`: Extension configuration
- `background.js`: Core functionality for tracking and switching tabs
- `icons/`: Directory containing extension icons

## Requirements

- Google Chrome or Chromium-based browser that supports Manifest V3

## Notes

- You need to replace the placeholder icon files with real PNG images before publishing the extension. 