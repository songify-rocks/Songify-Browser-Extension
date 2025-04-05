# Songify YouTube Integration

A browser extension that seamlessly integrates YouTube and YouTube Music with Songify, allowing you to display your currently playing songs in your stream or other applications.

## Features

- **Automatic Song Detection**: Works with both YouTube and YouTube Music
- **Custom Title Filtering**: Remove unwanted text from video titles
- **Direct Manual Fixes**: Ability to manually correct titles directly from the extension
- **Cover Art Support**: Extracts album artwork from YouTube Music
- **Artist Information**: Separates artist and song title when available

## How It Works

The extension monitors YouTube and YouTube Music pages in real-time, extracting information about currently playing videos/songs. This data is then sent to Songify via a WebSocket connection, allowing streamers to display current song information on their streams.

### Title Filtering

The extension includes a powerful filtering system that can:

- Remove text in brackets `[like this]`
- Remove text in parentheses `(like this)`
- Remove text in curly braces `{like this}`
- Remove custom text patterns you define

## Installation

1. Download from the Chrome Web Store (link coming soon)
2. Make sure Songify is installed and running on your computer
3. Enable the extension in your browser

## Usage

### Basic Usage

1. Open YouTube or YouTube Music in your browser
2. Set the webserver port in the extension (you can find in Songify -> Settings -> Web Server)
3. Play any video/song
4. The extension automatically sends song information to Songify
5. Songify displays this information based on your configured layout

### Title Filtering

1. Click the extension icon in your browser toolbar
2. Go to the "Title Filters" tab
3. Add terms to filter from titles (e.g., "Official Video", "[HD]")
4. Special filters:
   - `[*]` - Removes all text in square brackets
   - `(*)` - Removes all text in parentheses
   - `{*}` - Removes all text in curly braces

## Compatibility

- Works with YouTube and YouTube Music
- Compatible with Chrome, Edge, and other Chromium-based browsers
- Requires Songify to be running for full functionality

## Privacy

This extension only accesses data from YouTube and YouTube Music pages. The extracted information is only sent locally to the Songify application running on your computer via WebSocket.

## Development

This extension is built using vanilla JavaScript with Chrome Extension Manifest V3 standards.

## License

[MIT License](LICENSE)

## Support

If you encounter any issues or have questions, please open an issue on GitHub or contact us through our support channels. 
