// Popup script for Image Swapper extension - Firefox compatible
console.log('Popup script loaded');

// Use browser API for Firefox compatibility
const api = typeof browser !== 'undefined' ? browser : chrome;

// Use local storage as fallback if sync storage fails
const storage = api.storage.sync || api.storage.local;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup DOM loaded');
    
    try {
        const imageUrlInput = document.getElementById('imageUrl');
        const swapBtn = document.getElementById('swapBtn');
        const restoreBtn = document.getElementById('restoreBtn');
        const statusDiv = document.getElementById('status');
        const urlError = document.getElementById('urlError');
        const preview = document.getElementById('preview');
        const previewImg = document.getElementById('previewImg');
        
        // Content type checkboxes
        const swapImages = document.getElementById('swapImages');
        const swapSvgs = document.getElementById('swapSvgs');
        const swapObjects = document.getElementById('swapObjects');
        const swapBackgrounds = document.getElementById('swapBackgrounds');
        const swapVideoPoster = document.getElementById('swapVideoPoster');
        
        console.log('Elements found:', {
            imageUrlInput: !!imageUrlInput,
            swapBtn: !!swapBtn,
            restoreBtn: !!restoreBtn,
            statusDiv: !!statusDiv,
            urlError: !!urlError,
            preview: !!preview,
            previewImg: !!previewImg,
            swapImages: !!swapImages,
            swapSvgs: !!swapSvgs,
            swapObjects: !!swapObjects,
            swapBackgrounds: !!swapBackgrounds,
            swapVideoPoster: !!swapVideoPoster
        });
        
        if (!imageUrlInput || !swapBtn || !restoreBtn || !statusDiv) {
            console.error('Required elements not found!');
            if (statusDiv) {
                statusDiv.textContent = 'Error: UI elements not found';
                statusDiv.className = 'status error';
            }
            return;
        }
        
        // Test API availability
        console.log('Testing API availability...');
        console.log('browser object:', typeof browser);
        console.log('chrome object:', typeof chrome);
        console.log('api object:', typeof api);
        
        if (!api) {
            console.error('Extension API not available!');
            statusDiv.textContent = 'Error: Extension API not available';
            statusDiv.className = 'status error';
            return;
        }
    
        // Load saved settings
        console.log('Loading saved settings...');
        storage.get(['replacementImageUrl', 'swappingEnabled', 'swapImages', 'swapSvgs', 'swapObjects', 'swapBackgrounds', 'swapVideoPoster']).then(result => {
        console.log('Loaded settings:', result);
        if (result.replacementImageUrl) {
            imageUrlInput.value = result.replacementImageUrl;
            showPreview(result.replacementImageUrl);
        }
        
        // Load content type preferences (default to true if not set)
        swapImages.checked = result.swapImages !== false;
        swapSvgs.checked = result.swapSvgs !== false;
        swapObjects.checked = result.swapObjects !== false;
        swapBackgrounds.checked = result.swapBackgrounds !== false;
        swapVideoPoster.checked = result.swapVideoPoster !== false;
        
        updateStatus(result.swappingEnabled || false);
    }).catch(err => {
        console.log('Error loading settings:', err);
        // Try local storage as fallback
        api.storage.local.get(['replacementImageUrl', 'swappingEnabled']).then(result => {
            console.log('Loaded settings from local storage:', result);
            if (result.replacementImageUrl) {
                imageUrlInput.value = result.replacementImageUrl;
                showPreview(result.replacementImageUrl);
            }
            updateStatus(result.swappingEnabled || false);
        }).catch(localErr => {
            console.log('Error loading from local storage:', localErr);
        });
    });
    
    // Preview image when URL changes
    imageUrlInput.addEventListener('input', () => {
        const url = imageUrlInput.value.trim();
        if (url) {
            showPreview(url);
        } else {
            hidePreview();
        }
        hideError();
    });
    
    // Start swapping images globally
    swapBtn.addEventListener('click', () => {
        console.log('Swap button clicked');
        const imageUrl = imageUrlInput.value.trim();
        
        if (!imageUrl) {
            showError('Please enter an image URL');
            return;
        }
        
        if (!isValidUrl(imageUrl)) {
            showError('Please enter a valid URL');
            return;
        }
        
        console.log('Setting storage with URL:', imageUrl);
        // Save settings to enable global swapping
        const settings = {
            replacementImageUrl: imageUrl,
            swappingEnabled: true,
            swapImages: swapImages.checked,
            swapSvgs: swapSvgs.checked,
            swapObjects: swapObjects.checked,
            swapBackgrounds: swapBackgrounds.checked,
            swapVideoPoster: swapVideoPoster.checked
        };
        
        storage.set(settings).then(() => {
            console.log('Settings saved successfully');
            updateStatus(true);
            // The background script will automatically apply to all tabs
            // via the storage change listener
        }).catch(err => {
            console.log('Error saving settings:', err);
            // Try local storage as fallback
            api.storage.local.set({
                replacementImageUrl: imageUrl,
                swappingEnabled: true
            }).then(() => {
                console.log('Settings saved to local storage');
                updateStatus(true);
                showError('Settings saved locally (sync unavailable)');
            }).catch(localErr => {
                console.log('Error saving to local storage:', localErr);
                showError('Error saving settings');
            });
        });
    });
    
    // Restore original images globally  
    restoreBtn.addEventListener('click', () => {
        console.log('Restore button clicked');
        // Save settings to disable global swapping
        storage.set({
            swappingEnabled: false
        }).then(() => {
            console.log('Swapping disabled');
            updateStatus(false);
            // The background script will automatically restore all tabs
            // via the storage change listener
        }).catch(err => {
            console.log('Error disabling swapping:', err);
            // Try local storage as fallback
            api.storage.local.set({
                swappingEnabled: false
            }).then(() => {
                console.log('Swapping disabled in local storage');
                updateStatus(false);
            }).catch(localErr => {
                console.log('Error disabling in local storage:', localErr);
            });
        });
    });
    
    // Check current status
    api.tabs.query({active: true, currentWindow: true}).then(tabs => {
        if (tabs[0]) {
            api.tabs.sendMessage(tabs[0].id, {
                action: 'getStatus'
            }).then(response => {
                console.log('Status response:', response);
                if (response) {
                    updateStatus(response.isSwapping);
                    if (response.imageUrl && !imageUrlInput.value) {
                        imageUrlInput.value = response.imageUrl;
                        showPreview(response.imageUrl);
                    }
                }
            }).catch(error => {
                console.log('Could not get status from content script:', error);
            });
        }
    }).catch(err => {
        console.log('Error querying tabs:', err);
    });
    
    function updateStatus(isSwapping) {
        if (isSwapping) {
            statusDiv.textContent = 'Global image swapping is ACTIVE across all sites';
            statusDiv.className = 'status active';
            swapBtn.textContent = 'Update Global Swapping';
        } else {
            statusDiv.textContent = 'Global image swapping is disabled';
            statusDiv.className = 'status inactive';
            swapBtn.textContent = 'Enable Global Swapping';
        }
    }
    
    function showError(message) {
        urlError.textContent = message;
        urlError.style.display = 'block';
    }
    
    function hideError() {
        urlError.style.display = 'none';
    }
    
    function showPreview(url) {
        previewImg.src = url;
        previewImg.onload = () => {
            preview.style.display = 'block';
            hideError();
        };
        previewImg.onerror = () => {
            hidePreview();
            showError('Invalid image URL or image could not be loaded');
        };
    }
    
    function hidePreview() {
        preview.style.display = 'none';
    }
    
    function isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }
    
    } catch (error) {
        console.error('Popup initialization error:', error);
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = 'Error: ' + error.message;
            statusDiv.className = 'status error';
        }
    }
});