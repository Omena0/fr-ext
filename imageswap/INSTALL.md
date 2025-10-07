# 🔧 Firefox Extension Installation & Troubleshooting Guide

## Quick Installation Steps

### 1. **Open Firefox Developer Tools**
   - Type `about:debugging` in the address bar
   - OR go to Firefox Menu → More Tools → Web Developer Tools → about:debugging

### 2. **Load the Extension**
   - Click **"This Firefox"** in the left sidebar
   - Click **"Load Temporary Add-on..."**
   - Navigate to `/home/omena0/Desktop/imageswap/`
   - Select **`manifest.json`**
   - Click **"Open"**

### 3. **Verify Installation**
   - Look for "Image Swapper" in the extension list
   - You should see it with a puzzle piece icon
   - Check that it says "Extension" (not "Internal")

## 🧪 Testing the Extension

### 1. **Open Test Page**
   - Open the `test.html` file in Firefox
   - OR visit any website with images (like `https://picsum.photos`)

### 2. **Use the Extension**
   - Click the **extension icon** in the Firefox toolbar (puzzle piece)
   - Enter a test image URL: `https://picsum.photos/400/300`
   - Click **"Enable Global Swapping"**
   - All images should be replaced immediately!

### 3. **Test Cross-Site Functionality**
   - Navigate to a different website
   - Images should automatically be swapped
   - Open new tabs - swapping should work automatically

## 🐛 Troubleshooting

### **Extension Not Appearing**
```
Solution:
1. Make sure you selected manifest.json (not the folder)
2. Check the Firefox console for errors (F12 → Console)
3. Try refreshing about:debugging and reloading
```

### **Extension Icon Not Clickable**
```
Solution:
1. Check that popup.html and popup.js exist
2. Right-click the extension in about:debugging → Inspect
3. Look for errors in the popup console
```

### **Images Not Swapping**
```
Solution:
1. Check the browser console (F12 → Console)
2. Look for error messages
3. Try a different image URL (ensure HTTPS)
4. Test on a simple page like test.html first
```

### **Cross-Origin Errors**
```
Solution:
1. Use HTTPS image URLs only
2. Try URLs from sites that allow cross-origin access:
   - https://picsum.photos/400/300
   - https://httpbin.org/image/png
   - https://via.placeholder.com/400x300
```

### **Storage Errors**
```
Solution:
1. Make sure Firefox allows extension storage
2. Try clearing extension data:
   - about:debugging → This Firefox → Find extension → Remove
   - Reinstall the extension
```

## 📝 Debug Commands

### Check Extension Storage:
```javascript
// Open Firefox console (F12) and run:
browser.storage.sync.get().then(console.log);
```

### Check Content Script Status:
```javascript
// On any webpage, open console and run:
console.log('Content script loaded:', typeof browser !== 'undefined');
```

### Manual Storage Set:
```javascript
// Force enable swapping:
browser.storage.sync.set({
    swappingEnabled: true,
    replacementImageUrl: 'https://picsum.photos/400/300'
});
```

## 🔄 Common Fixes

### **Complete Reset**
1. Remove extension from about:debugging
2. Close all Firefox tabs
3. Restart Firefox
4. Reinstall extension
5. Test on test.html first

### **Permissions Issues**
- Make sure the extension has permissions for the sites you're testing
- Some sites (like about: pages) will never work
- Try testing on regular HTTP/HTTPS websites

### **Background Script Issues**
- Check about:debugging → This Firefox → Image Swapper → Inspect
- Look for errors in the background script console
- Background script should log "Image Swapper background script starting..."

## ✅ Success Indicators

When working correctly, you should see:
- ✅ Extension icon appears in toolbar
- ✅ Popup opens when clicking icon
- ✅ Console logs "Image Swapper background script starting..."
- ✅ Console logs "Image Swapper content script loaded" on web pages
- ✅ Images swap immediately when enabled
- ✅ Status shows "Global image swapping is ACTIVE"
- ✅ New tabs automatically have swapped images

## 📞 Still Not Working?

If you're still having issues:
1. Check the exact error messages in the console
2. Test on the included `test.html` file first
3. Try different image URLs
4. Make sure you're using Firefox (not Chrome)
5. Check Firefox version compatibility (should work on Firefox 57+)