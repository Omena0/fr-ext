// Background script for Image Swapper extension - Firefox compatible
console.log('Image Swapper background script starting...');

// Use browser API for Firefox compatibility
const api = typeof browser !== 'undefined' ? browser : chrome;

// Use local storage as fallback if sync storage fails
const storage = api.storage.sync || api.storage.local;

api.runtime.onInstalled.addListener(() => {
    console.log('Image Swapper extension installed');
    
    // Initialize default settings
    storage.get(['swappingEnabled']).then(result => {
        if (result.swappingEnabled === undefined) {
            storage.set({
                swappingEnabled: false,
                replacementImageUrl: ''
            });
        }
    }).catch(err => {
        console.log('Storage init error:', err);
        // Try local storage as fallback
        api.storage.local.set({
            swappingEnabled: false,
            replacementImageUrl: ''
        }).catch(localErr => {
            console.log('Local storage init error:', localErr);
        });
    });
});

// Handle tab updates to apply swapping if enabled
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only proceed when page is fully loaded and URL is available
    if (changeInfo.status === 'complete' && tab.url) {
        // Skip special Firefox pages
        if (tab.url.startsWith('about:') || 
            tab.url.startsWith('moz-extension:') || 
            tab.url.startsWith('chrome:') ||
            tab.url.startsWith('chrome-extension:') ||
            tab.url.startsWith('file:')) {
            return;
        }
        
        console.log('Tab completed loading:', tab.url);
        
        // Check if swapping is enabled globally
        storage.get(['swappingEnabled', 'replacementImageUrl']).then(result => {
            if (result.swappingEnabled && result.replacementImageUrl) {
                console.log('Applying swapping to:', tab.url);
                // Small delay to ensure content script is loaded
                setTimeout(() => {
                    api.tabs.sendMessage(tabId, {
                        action: 'swapImages',
                        imageUrl: result.replacementImageUrl
                    }).then(response => {
                        console.log('Applied image swapping to:', tab.url);
                    }).catch(error => {
                        console.log('Could not inject into tab:', tab.url, error);
                    });
                }, 1000);
            }
        }).catch(err => {
            console.log('Storage get error:', err);
        });
    }
});

// Handle new tab creation
api.tabs.onCreated.addListener((tab) => {
    console.log('New tab created:', tab.id);
});

// Handle tab activation (switching between tabs)
api.tabs.onActivated.addListener((activeInfo) => {
    api.tabs.get(activeInfo.tabId).then(tab => {
        if (tab.url && !tab.url.startsWith('about:') && 
            !tab.url.startsWith('moz-extension:') && 
            !tab.url.startsWith('chrome:') &&
            !tab.url.startsWith('chrome-extension:') &&
            !tab.url.startsWith('file:')) {
            
            storage.get(['swappingEnabled', 'replacementImageUrl', 'swapImages', 'swapSvgs', 'swapObjects', 'swapBackgrounds', 'swapVideoPoster']).then(result => {
                if (result.swappingEnabled && result.replacementImageUrl) {
                    // Check if this tab already has swapping applied
                    api.tabs.sendMessage(activeInfo.tabId, {
                        action: 'getStatus'
                    }).then(response => {
                        if (!response || !response.isSwapping) {
                            // Apply swapping to this tab with options
                            api.tabs.sendMessage(activeInfo.tabId, {
                                action: 'swapImages',
                                imageUrl: result.replacementImageUrl,
                                swapImages: result.swapImages !== false,
                                swapSvgs: result.swapSvgs !== false,
                                swapObjects: result.swapObjects !== false,
                                swapBackgrounds: result.swapBackgrounds !== false,
                                swapVideoPoster: result.swapVideoPoster !== false
                            }).catch(error => {
                                console.log('Could not apply swapping to active tab:', error);
                            });
                        }
                    }).catch(error => {
                        // Apply swapping anyway if we can't get status
                        api.tabs.sendMessage(activeInfo.tabId, {
                            action: 'swapImages',
                            imageUrl: result.replacementImageUrl
                        }).catch(err => {
                            console.log('Could not apply swapping to active tab:', err);
                        });
                    });
                }
            }).catch(err => {
                console.log('Storage get error on tab activation:', err);
            });
        }
    }).catch(err => {
        console.log('Tab get error:', err);
    });
});

// Listen for storage changes to apply/remove swapping globally
api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log('Storage changed:', changes);
        if (changes.swappingEnabled || changes.replacementImageUrl) {
            const newEnabled = changes.swappingEnabled ? changes.swappingEnabled.newValue : undefined;
            const newImageUrl = changes.replacementImageUrl ? changes.replacementImageUrl.newValue : undefined;
            
            // Get current values if not changed
            storage.get(['swappingEnabled', 'replacementImageUrl']).then(result => {
                const enabled = newEnabled !== undefined ? newEnabled : result.swappingEnabled;
                const imageUrl = newImageUrl !== undefined ? newImageUrl : result.replacementImageUrl;
                
                console.log('Storage sync - enabled:', enabled, 'imageUrl:', imageUrl);
                
                if (enabled && imageUrl) {
                    // Apply to all tabs
                    applyToAllTabs('swapImages', imageUrl);
                } else if (newEnabled === false) {
                    // Restore all tabs
                    applyToAllTabs('restoreImages');
                }
            }).catch(err => {
                console.log('Storage get error in change listener:', err);
            });
        }
    }
});

// Function to apply action to all tabs
function applyToAllTabs(action, imageUrl = null) {
    console.log('Applying', action, 'to all tabs');
    api.tabs.query({}).then(tabs => {
        tabs.forEach(tab => {
            // Skip special pages
            if (tab.url && !tab.url.startsWith('about:') && 
                !tab.url.startsWith('moz-extension:') && 
                !tab.url.startsWith('chrome:') &&
                !tab.url.startsWith('chrome-extension:') &&
                !tab.url.startsWith('file:')) {
                
                const message = { action: action };
                if (imageUrl) {
                    message.imageUrl = imageUrl;
                }
                
                api.tabs.sendMessage(tab.id, message).then(response => {
                    console.log(`Applied ${action} to:`, tab.url);
                }).catch(error => {
                    console.log(`Could not ${action} in tab:`, tab.url, error);
                });
            }
        });
    }).catch(err => {
        console.log('Tabs query error:', err);
    });
}

// Handle extension icon click (if no popup is set)
api.browserAction.onClicked.addListener((tab) => {
    console.log('Browser action clicked');
    // This won't be called since we have a popup, but keeping for reference
    api.tabs.sendMessage(tab.id, {action: 'toggleSwapping'}).catch(err => {
        console.log('Toggle swapping error:', err);
    });
});