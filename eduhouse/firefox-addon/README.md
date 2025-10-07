# Eduhouse Auto Clicker Firefox Extension

This extension automatically finds the button with classes `course-addon__button totem-button large primary normal` on https://app.eduhouse.fi sites, removes its `disabled` attribute, and clicks it.

## Installation
1. Go to `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on" and select the `manifest.json` file in this folder.

## Usage
- Visit any https://app.eduhouse.fi page with the target button. The extension will automatically enable and click it.
