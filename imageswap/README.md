# Image Swapper Firefox Extension

A Firefox extension that replaces all images on web pages with a specified image from a URL.

## Features

- 🖼️ **Universal Image Replacement**: Swaps all images on any webpage with your chosen image
- 🎯 **Dynamic Detection**: Automatically detects and replaces dynamically loaded images
- 🔄 **Easy Toggle**: Simple popup interface to start/stop image swapping
- 💾 **Persistent Settings**: Remembers your image URL and settings across browser sessions
- 🌐 **All Pages**: Works on all websites (respecting Firefox security policies)
- 🖼️ **Background Images**: Also replaces CSS background images

## Installation

### Manual Installation (Development)

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox"
4. Click "Load Temporary Add-on..."
5. Select the `manifest.json` file from this directory
6. The extension will be loaded temporarily

### For Permanent Installation

1. Package the extension:
   - Zip all files in this directory
   - Rename the zip file to have a `.xpi` extension
2. Install the `.xpi` file in Firefox

## Usage

1. **Click the extension icon** in the Firefox toolbar (puzzle piece icon)
2. **Enter an image URL** in the text field (must be a valid HTTP/HTTPS URL)
3. **Click "Start Swapping"** to replace all images on the current page
4. **Click "Restore Images"** to return to original images
5. The extension will remember your settings and automatically apply them to new pages

## How It Works

- **Content Script**: Runs on all web pages and handles the actual image swapping
- **Popup Interface**: Provides the user interface for controlling the extension
- **Background Script**: Manages extension state and applies settings to new pages
- **Storage**: Saves your image URL and preferences using Firefox's storage API

## Technical Details

### Image Detection
- Finds all `<img>` elements and replaces their `src` attribute
- Detects CSS background images and replaces them
- Uses MutationObserver to catch dynamically loaded images
- Preserves original image URLs for restoration

### Permissions
- `activeTab`: Access to the current tab for image swapping
- `storage`: Save user preferences
- `<all_urls>`: Access to all websites for universal functionality

## Files Structure

```
imageswap/
├── manifest.json      # Extension configuration
├── content.js         # Main image swapping logic
├── popup.html         # Extension popup interface
├── popup.js           # Popup functionality
├── background.js      # Background script
├── icons/             # Extension icons
└── README.md          # This file
```

## Troubleshooting

- **Extension not working**: Try refreshing the page after enabling image swapping
- **Some images not replaced**: Some websites use advanced loading techniques that may bypass detection
- **CORS errors**: Some images may not load due to Cross-Origin Resource Sharing policies
- **Special pages**: The extension cannot run on Firefox internal pages (about:, moz-extension:, etc.)

## Development

To modify the extension:

1. Edit the relevant files
2. Go to `about:debugging` in Firefox
3. Click "Reload" next to the extension to apply changes

## Privacy

This extension:
- Only processes data locally in your browser
- Does not send any data to external servers
- Only stores your image URL preference locally
- Does not track or collect user information

## License

This project is open source. Feel free to modify and distribute according to your needs.