// background.js — injects content.js into matching tabs so extension works on reload
function injectScript(tabId) {
  try {
    // inject into main frame
    if (typeof browser !== 'undefined') browser.tabs.executeScript(tabId, {file: 'content.js'}).catch(function(err){ console.log('injectScript error', err); });
    else chrome.tabs.executeScript(tabId, {file: 'content.js'});
  } catch (e) { console.log('injectScript top-level error', e); }
}

// Inject into all existing matching tabs on startup
function injectIntoAll() {
  try {
    // query all eduhouse.fi pages (not just app.eduhouse.fi) so coma.eduhouse.fi tabs are included
    browser.tabs.query({url: '*://*.eduhouse.fi/*'}).then(function(tabs){
      for (var i=0;i<tabs.length;i++) injectScript(tabs[i].id);
    }).catch(function(){
      // chrome fallback
      chrome.tabs.query({url: '*://*.eduhouse.fi/*'}, function(tabs){
        for (var i=0;i<tabs.length;i++) injectScript(tabs[i].id);
      });
    });
  } catch (e) {
    // older API
    try { chrome.tabs.query({url: 'https://app.eduhouse.fi/*'}, function(tabs){ for (var i=0;i<tabs.length;i++) injectScript(tabs[i].id); }); } catch (ee) {}
  }
}

// On update of a tab, inject if it matches
try {
    // watch for any eduhouse.fi tab updates (include coma.eduhouse.fi)
    browser.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url && tab.url.indexOf('eduhouse.fi') !== -1) {
      injectScript(tabId);
      // inject into frames
      try {
        browser.webNavigation.getAllFrames({tabId: tabId}).then(function(frames) {
          frames.forEach(function(f) {
            try {
              if (f.url && f.url.indexOf('eduhouse.fi') !== -1) {
                browser.tabs.executeScript(tabId, {file: 'content.js', frameId: f.frameId});
              }
            } catch (e) {}
          });
        });
      } catch (e) {
        // ignore
      }
    }
  });
} catch (e) {
  chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url && tab.url.indexOf('eduhouse.fi') !== -1) {
      injectScript(tabId);
      try {
        chrome.webNavigation.getAllFrames({tabId: tabId}, function(frames) {
          if (!frames) return;
          frames.forEach(function(f) {
            try {
              if (f.url && f.url.indexOf('eduhouse.fi') !== -1) {
                chrome.tabs.executeScript(tabId, {file: 'content.js', frameId: f.frameId});
              }
            } catch (e) {}
          });
        });
      } catch (e) {}
    }
  });
}

// Run on extension startup
if (typeof browser !== 'undefined') browser.runtime.onStartup.addListener(injectIntoAll);
if (typeof chrome !== 'undefined') chrome.runtime.onStartup && chrome.runtime.onStartup.addListener && chrome.runtime.onStartup.addListener(injectIntoAll);

// Also run once now
injectIntoAll();

// Inject into frames when they complete navigation (useful for iframes that load later)
try {
  if (typeof browser !== 'undefined' && browser.webNavigation && browser.webNavigation.onCompleted) {
    browser.webNavigation.onCompleted.addListener(function(details) {
      try {
        if (details && details.frameId !== 0 && details.url && details.url.indexOf('eduhouse.fi') !== -1) {
          browser.tabs.executeScript(details.tabId, {file: 'content.js', frameId: details.frameId});
        }
      } catch (e) {}
    });
  }
} catch (e) {}

try {
  if (typeof chrome !== 'undefined' && chrome.webNavigation && chrome.webNavigation.onCompleted) {
    chrome.webNavigation.onCompleted.addListener(function(details) {
      try {
        if (details && details.frameId !== 0 && details.url && details.url.indexOf('eduhouse.fi') !== -1) {
          chrome.tabs.executeScript(details.tabId, {file: 'content.js', frameId: details.frameId});
        }
      } catch (e) {}
    });
  }
} catch (e) {}
