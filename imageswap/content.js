// Content script that swaps images - Firefox compatible
console.log('Image Swapper content script loaded');

// Use browser API for Firefox compatibility
const api = typeof browser !== 'undefined' ? browser : chrome;

// Use local storage as fallback if sync storage fails
const storage = api.storage.sync || api.storage.local;

let isSwapping = false;
let replacementImageUrl = '';
let originalImages = new Map(); // Store original image sources
let originalBackgrounds = new Map(); // Store original background images
let delayedSweepTimeout = null; // For debounced final sweeps

// Helper function to check if an element is one we created or already processed
function isOurElement(element) {
  if (!element || !element.hasAttribute) return false;
  
  // Check if this element was created by us
  return element.hasAttribute('data-original-src') ||
         element.hasAttribute('data-original-svg') ||
         element.hasAttribute('data-original-object') ||
         element.hasAttribute('data-original-embed') ||
         element.hasAttribute('data-original-poster') ||
         element.hasAttribute('data-original-bg') ||
         element.hasAttribute('data-was-svg') ||
         element.hasAttribute('data-was-object') ||
         element.hasAttribute('data-was-embed') ||
         originalImages.has(element) ||
         originalBackgrounds.has(element);
}

// Schedule a debounced sweep to catch content that loads after DOM activity settles
function scheduleDelayedSweep(imageUrl) {
  // Clear any existing timeout
  if (delayedSweepTimeout) {
    clearTimeout(delayedSweepTimeout);
  }
  
  // Schedule a sweep after DOM activity settles (skeleton loaders typically finish)
  delayedSweepTimeout = setTimeout(() => {
    if (isSwapping) {
      console.log('Performing delayed sweep for skeleton-loaded content...');
      sweepForNewImages(imageUrl);
      
      // Schedule additional sweeps for very slow loading content
      setTimeout(() => {
        if (isSwapping) sweepForNewImages(imageUrl);
      }, 2000);
      
      setTimeout(() => {
        if (isSwapping) sweepForNewImages(imageUrl);
      }, 5000);
    }
  }, 1000); // Wait 1 second after last DOM activity
}

// Function to swap all images
function swapImages(imageUrl, options = {}) {
  if (!imageUrl) return;
  
  replacementImageUrl = imageUrl;
  isSwapping = true;
  
  // Default options (all enabled if not specified)
  const swapOptions = {
    swapImages: options.swapImages !== false,
    swapSvgs: options.swapSvgs !== false,
    swapObjects: options.swapObjects !== false,
    swapBackgrounds: options.swapBackgrounds !== false,
    swapVideoPoster: options.swapVideoPoster !== false,
    ...options
  };
  
  // Store options globally for mutation observer
  window.swapOptions = swapOptions;
  
  console.log('Swapping with options:', swapOptions);
  
  // Preload the replacement image for instant swapping
  const preloadImg = new Image();
  preloadImg.onload = () => {
    console.log('Replacement image preloaded, starting instant swap with continuous monitoring');
    performInstantSwap(imageUrl, swapOptions);
    // Set up continuous monitoring for dynamically loaded images
    observeNewImages(imageUrl, swapOptions);
  };
  preloadImg.onerror = () => {
    console.log('Could not preload replacement image, proceeding anyway');
    performInstantSwap(imageUrl, swapOptions);
    // Set up continuous monitoring even if preload failed
    observeNewImages(imageUrl, swapOptions);
  };
  preloadImg.src = imageUrl;
}

// Perform instant image swapping without visible transitions
function performInstantSwap(imageUrl, options = {}) {
  console.log('Starting instant swap with URL:', imageUrl, 'Options:', options);
  
  // Log what we're about to process
  const allImages = document.querySelectorAll('img');
  const allSvgs = document.querySelectorAll('svg');
  const allObjects = document.querySelectorAll('object');
  const allEmbeds = document.querySelectorAll('embed');
  
  console.log(`Found elements - Images: ${allImages.length}, SVGs: ${allSvgs.length}, Objects: ${allObjects.length}, Embeds: ${allEmbeds.length}`);
  // Hide all images temporarily to prevent flash
  const style = document.createElement('style');
  style.id = 'image-swapper-hide';
  style.textContent = `
    img, svg, object[type*="image"], embed[src*=".gif"], embed[src*=".svg"], 
    video[poster], [style*="background-image"] {
      visibility: hidden !important;
      transition: none !important;
    }
    /* Prevent any replaced images from being oversized */
    img[data-was-svg], img[data-was-object], img[data-was-embed] {
      max-width: 500px !important;
      max-height: 400px !important;
      object-fit: contain !important;
    }
  `;
  document.head.appendChild(style);
  
  // Swap all img elements (including GIFs, SVGs as img)
  const images = document.querySelectorAll('img');
  if (options.swapImages) {
    console.log(`Processing ${images.length} img elements`);
    images.forEach(img => {
      // Store original src if not already stored
      if (!originalImages.has(img)) {
        originalImages.set(img, {
          src: img.src,
          srcset: img.srcset,
          type: img.type || 'image'
        });
        img.setAttribute('data-original-src', img.src);
        img.setAttribute('data-original-srcset', img.srcset || '');
      }
      
      // Replace with new image - instant swap
      img.src = imageUrl;
      img.srcset = ''; // Clear srcset to prevent conflicts
      
      // Ensure GIFs autoplay
      if (imageUrl.toLowerCase().includes('.gif')) {
        img.style.animationPlayState = 'running';
        img.removeAttribute('paused');
      }
    });
  } else {
    console.log('Skipping img elements (disabled in options)');
  }
  
  // Handle SVG elements directly embedded
  const svgs = document.querySelectorAll('svg');
  if (options.swapSvgs) {
    console.log(`Processing ${svgs.length} SVG elements`);
    svgs.forEach((svg, index) => {
      // Skip hidden or icon SVGs that shouldn't be replaced
      const rect = svg.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(svg);
      
      // More comprehensive checks for UI icons and hidden elements
      const isHidden = computedStyle.display === 'none' || 
                       computedStyle.visibility === 'hidden' ||
                       rect.width <= 24 || rect.height <= 24 ||  // Increased threshold for icons
                       svg.getAttribute('aria-hidden') === 'true' ||
                       svg.getAttribute('focusable') === 'false' ||
                       svg.hasAttribute('focusable') ||  // Any focusable attribute usually means UI icon
                       (svg.style.position === 'absolute' && 
                        (svg.style.height === '0' || svg.style.width === '0')) ||
                       // Check for common icon indicators
                       svg.getAttribute('fill') === 'currentColor' ||
                       svg.classList.contains('icon') ||
                       svg.classList.contains('svg-icon') ||
                       // Check parent containers that suggest icons
                       svg.closest('button') ||
                       svg.closest('[role="button"]') ||
                       svg.closest('.icon') ||
                       svg.closest('nav') ||
                       svg.closest('header') ||
                       svg.closest('[class*="icon"]') ||
                       svg.closest('[class*="btn"]');
      
      if (isHidden) {
        console.log(`Skipping icon/hidden SVG ${index} (${rect.width}x${rect.height}) - Reason:`, {
          tooSmall: rect.width <= 24 || rect.height <= 24,
          ariaHidden: svg.getAttribute('aria-hidden') === 'true',
          focusable: svg.getAttribute('focusable') === 'false',
          currentColor: svg.getAttribute('fill') === 'currentColor',
          inButton: !!svg.closest('button'),
          inNav: !!svg.closest('nav')
        });
        return;
      }
      
      console.log(`Processing SVG ${index}: ${rect.width}x${rect.height}px`);
      
      // Debug the SVG attributes
      console.log(`SVG ${index} details:`, {
        width: rect.width,
        height: rect.height,
        ariaHidden: svg.getAttribute('aria-hidden'),
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        position: svg.style.position,
        styleHeight: svg.style.height,
        styleWidth: svg.style.width,
        viewBox: svg.getAttribute('viewBox'),
        focusable: svg.getAttribute('focusable')
      });
    
    if (!originalImages.has(svg)) {
      const svgId = 'svg-' + Date.now() + '-' + index;
      originalImages.set(svg, {
        outerHTML: svg.outerHTML,
        type: 'svg',
        parentNode: svg.parentNode,
        nextSibling: svg.nextSibling,
        svgId: svgId
      });
      svg.setAttribute('data-original-svg', 'true');
      svg.setAttribute('data-svg-id', svgId);
    }
    
    // Replace SVG with img element
    const imgReplacement = document.createElement('img');
    imgReplacement.src = imageUrl;
    
    // Copy the SVG ID for tracking
    const svgData = originalImages.get(svg);
    if (svgData && svgData.svgId) {
      imgReplacement.setAttribute('data-svg-id', svgData.svgId);
    }
    
    // Get dimensions - try multiple approaches with better fallbacks
    let width = svg.style.width || svg.getAttribute('width');
    let height = svg.style.height || svg.getAttribute('height');
    
    // If no explicit dimensions, use computed/bounding rect
    if (!width && rect.width > 0) {
      width = rect.width + 'px';
    }
    if (!height && rect.height > 0) {
      height = rect.height + 'px';
    }
    
    // Final fallback to reasonable defaults
    if (!width || width === '0px') width = '150px';
    if (!height || height === '0px') height = '100px';
    
    // Ensure we have proper pixel values and aren't oversized
    width = parseFloat(width);
    height = parseFloat(height);
    
    // Limit maximum size to prevent page-filling images
    const maxWidth = Math.min(width, window.innerWidth * 0.8, 500);
    const maxHeight = Math.min(height, window.innerHeight * 0.8, 400);
    
    imgReplacement.style.width = maxWidth + 'px';
    imgReplacement.style.height = maxHeight + 'px';
    imgReplacement.style.objectFit = 'contain'; // Maintain aspect ratio
    imgReplacement.style.maxWidth = '100%';
    imgReplacement.style.maxHeight = '100%';
    
    // Copy classes and styles - fix className issue
    if (svg.className && typeof svg.className === 'object' && svg.className.baseVal) {
      imgReplacement.className = svg.className.baseVal;
    } else if (svg.className && typeof svg.className === 'string') {
      imgReplacement.className = svg.className;
    } else if (svg.getAttribute('class')) {
      imgReplacement.className = svg.getAttribute('class');
    }
    
    // Copy computed styles
    imgReplacement.style.display = computedStyle.display;
    imgReplacement.style.margin = computedStyle.margin;
    imgReplacement.style.padding = computedStyle.padding;
    imgReplacement.style.border = computedStyle.border;
    imgReplacement.style.borderRadius = computedStyle.borderRadius;
    
    imgReplacement.setAttribute('data-was-svg', 'true');
    imgReplacement.setAttribute('data-svg-index', index);
    
    // Ensure GIF autoplay
    if (imageUrl.toLowerCase().includes('.gif')) {
      imgReplacement.style.animationPlayState = 'running';
    }
    
    try {
      svg.parentNode.replaceChild(imgReplacement, svg);
      console.log(`Successfully replaced SVG ${index} with IMG (ID: ${svgData?.svgId})`);
    } catch (error) {
      console.error(`SVG replacement failed for SVG ${index}:`, error);
    }
  });
  } else {
    console.log('Skipping SVG elements (disabled in options)');
  }
  
  // Handle object/embed elements (for SVGs, GIFs)
  const objects = document.querySelectorAll('object[type*="image"], object[data*=".svg"], object[data*=".gif"]');
  objects.forEach(obj => {
    if (!originalImages.has(obj)) {
      originalImages.set(obj, {
        data: obj.data,
        type: obj.type,
        outerHTML: obj.outerHTML,
        elementType: 'object'
      });
      obj.setAttribute('data-original-object', 'true');
    }
    
    // Replace with img
    const imgReplacement = document.createElement('img');
    imgReplacement.src = imageUrl;
    imgReplacement.style.width = obj.style.width || obj.getAttribute('width') || '100px';
    imgReplacement.style.height = obj.style.height || obj.getAttribute('height') || '100px';
    imgReplacement.className = obj.className;
    imgReplacement.setAttribute('data-was-object', 'true');
    
    if (imageUrl.toLowerCase().includes('.gif')) {
      imgReplacement.style.animationPlayState = 'running';
    }
    
    obj.parentNode.replaceChild(imgReplacement, obj);
  });
  
  // Handle embed elements
  const embeds = document.querySelectorAll('embed[src*=".gif"], embed[src*=".svg"], embed[src*=".jpg"], embed[src*=".png"], embed[src*=".webp"]');
  embeds.forEach(embed => {
    if (!originalImages.has(embed)) {
      originalImages.set(embed, {
        src: embed.src,
        outerHTML: embed.outerHTML,
        elementType: 'embed'
      });
      embed.setAttribute('data-original-embed', 'true');
    }
    
    // Replace with img
    const imgReplacement = document.createElement('img');
    imgReplacement.src = imageUrl;
    imgReplacement.style.width = embed.style.width || embed.getAttribute('width') || '100px';
    imgReplacement.style.height = embed.style.height || embed.getAttribute('height') || '100px';
    imgReplacement.className = embed.className;
    imgReplacement.setAttribute('data-was-embed', 'true');
    
    if (imageUrl.toLowerCase().includes('.gif')) {
      imgReplacement.style.animationPlayState = 'running';
    }
    
    embed.parentNode.replaceChild(imgReplacement, embed);
  });
  
  // Handle CSS background images (including SVGs)
  const allElements = document.querySelectorAll('*');
  allElements.forEach(element => {
    const style = window.getComputedStyle(element);
    const backgroundImage = style.backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none' && backgroundImage.includes('url(')) {
      // Store original background if not already stored
      if (!originalBackgrounds.has(element)) {
        const originalBg = element.style.backgroundImage || backgroundImage;
        originalBackgrounds.set(element, originalBg);
        element.setAttribute('data-original-bg', originalBg);
      }
      
      // Replace background image instantly
      element.style.backgroundImage = `url("${imageUrl}")`;
      
      // Ensure background animations play
      if (imageUrl.toLowerCase().includes('.gif')) {
        element.style.backgroundRepeat = element.style.backgroundRepeat || 'no-repeat';
        element.style.animationPlayState = 'running';
      }
    }
  });
  
  // Handle video poster images
  const videos = document.querySelectorAll('video[poster]');
  videos.forEach(video => {
    if (!originalImages.has(video)) {
      originalImages.set(video, {
        poster: video.poster,
        type: 'video-poster'
      });
      video.setAttribute('data-original-poster', video.poster);
    }
    video.poster = imageUrl;
  });
  
  // Wait a moment then show all images again for smooth reveal
  setTimeout(() => {
    const hideStyle = document.getElementById('image-swapper-hide');
    if (hideStyle) {
      hideStyle.remove();
    }
    
    // Additional SVG check - sometimes SVGs are missed in the initial pass
    const remainingSvgs = document.querySelectorAll('svg:not([data-original-svg])');
        if (remainingSvgs.length > 0) {
          console.log('Found remaining SVGs after initial pass:', remainingSvgs.length);
          remainingSvgs.forEach((svg, index) => {
            // Skip hidden SVGs here too
            const rect = svg.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(svg);
            const isHidden = computedStyle.display === 'none' || 
                             computedStyle.visibility === 'hidden' ||
                             rect.width <= 1 || rect.height <= 1 ||
                             svg.getAttribute('aria-hidden') === 'true' ||
                             (svg.style.position === 'absolute' && 
                              (svg.style.height === '0' || svg.style.width === '0'));
            
            if (isHidden) {
              return;
            }
            
            // Store original
            originalImages.set(svg, {
              outerHTML: svg.outerHTML,
              type: 'svg',
              parentNode: svg.parentNode,
              nextSibling: svg.nextSibling
            });
            svg.setAttribute('data-original-svg', 'true');
            
            // Create replacement
            const imgReplacement = document.createElement('img');
            imgReplacement.src = imageUrl;
            
            let width = svg.style.width || svg.getAttribute('width');
            let height = svg.style.height || svg.getAttribute('height');
            
            if (!width && rect.width > 0) {
              width = rect.width + 'px';
            }
            if (!height && rect.height > 0) {
              height = rect.height + 'px';
            }
            
            if (!width || width === '0px') width = '150px';
            if (!height || height === '0px') height = '100px';
            
            // Parse and limit dimensions to prevent oversized images
            width = parseFloat(width);
            height = parseFloat(height);
            
            const maxWidth = Math.min(width, window.innerWidth * 0.5, 300);
            const maxHeight = Math.min(height, window.innerHeight * 0.5, 200);
            
            imgReplacement.style.width = maxWidth + 'px';
            imgReplacement.style.height = maxHeight + 'px';
            imgReplacement.style.objectFit = 'contain';
            imgReplacement.style.maxWidth = '100%';
            imgReplacement.style.maxHeight = '100%';
            
            // Fix className handling
            if (svg.className && typeof svg.className === 'object' && svg.className.baseVal) {
              imgReplacement.className = svg.className.baseVal;
            } else if (svg.className && typeof svg.className === 'string') {
              imgReplacement.className = svg.className;
            } else if (svg.getAttribute('class')) {
              imgReplacement.className = svg.getAttribute('class');
            }
            
            imgReplacement.setAttribute('data-was-svg', 'true');
            imgReplacement.setAttribute('data-svg-index', index);
            
            if (imageUrl.toLowerCase().includes('.gif')) {
              imgReplacement.style.animationPlayState = 'running';
            }
            
            try {
              svg.parentNode.replaceChild(imgReplacement, svg);
            } catch (error) {
              console.error('Remaining SVG replacement failed:', error);
            }
          });
        }    // Force a repaint for instant display
    document.body.offsetHeight;
  }, 50);
  
  // Handle dynamically loaded images
  observeNewImages(imageUrl);
  
  console.log('Instant image swapping applied with URL:', imageUrl);
}

// Function to restore original images
function restoreImages() {
  isSwapping = false;
  replacementImageUrl = '';
  
  // Hide images during restoration for smooth transition
  const style = document.createElement('style');
  style.id = 'image-swapper-restore';
  style.textContent = `
    img, svg, object, embed, video {
      visibility: hidden !important;
      transition: none !important;
    }
  `;
  document.head.appendChild(style);
  
  // Restore img elements using our Map
  originalImages.forEach((originalData, element) => {
    if (element.parentNode) { // Check if element still exists in DOM
      if (originalData.type === 'svg' && originalData.outerHTML) {
        // Restore SVG from stored HTML
        console.log('Restoring SVG:', originalData.outerHTML);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = originalData.outerHTML;
        const restoredSvg = tempDiv.firstChild;
        if (restoredSvg) {
          try {
            element.parentNode.replaceChild(restoredSvg, element);
            console.log('SVG restoration successful');
          } catch (error) {
            console.error('SVG restoration failed:', error);
          }
        }
      } else if (originalData.elementType === 'object' && originalData.outerHTML) {
        // Restore object element
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = originalData.outerHTML;
        const restoredObj = tempDiv.firstChild;
        element.parentNode.replaceChild(restoredObj, element);
      } else if (originalData.elementType === 'embed' && originalData.outerHTML) {
        // Restore embed element
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = originalData.outerHTML;
        const restoredEmbed = tempDiv.firstChild;
        element.parentNode.replaceChild(restoredEmbed, element);
      } else if (originalData.type === 'video-poster') {
        // Restore video poster
        element.poster = originalData.poster;
      } else {
        // Restore regular img
        element.src = originalData.src || originalData;
        if (originalData.srcset) {
          element.srcset = originalData.srcset;
        }
      }
      element.removeAttribute('data-original-src');
      element.removeAttribute('data-original-srcset');
      element.removeAttribute('data-original-svg');
      element.removeAttribute('data-original-object');
      element.removeAttribute('data-original-embed');
      element.removeAttribute('data-original-poster');
    }
  });
  originalImages.clear();
  
  // Restore background images using our Map
  originalBackgrounds.forEach((originalBg, element) => {
    if (element.parentNode) { // Check if element still exists in DOM
      if (originalBg === 'none') {
        element.style.backgroundImage = '';
      } else {
        element.style.backgroundImage = originalBg;
      }
      element.removeAttribute('data-original-bg');
    }
  });
  originalBackgrounds.clear();
  
  // Also restore using attributes as fallback
  const imagesWithAttr = document.querySelectorAll('img[data-original-src]');
  imagesWithAttr.forEach(img => {
    img.src = img.getAttribute('data-original-src');
    const originalSrcset = img.getAttribute('data-original-srcset');
    if (originalSrcset) {
      img.srcset = originalSrcset;
    }
    img.removeAttribute('data-original-src');
    img.removeAttribute('data-original-srcset');
  });
  
  // Restore SVGs that were replaced with img elements
  const replacedSvgs = document.querySelectorAll('img[data-was-svg]');
  console.log('Found replaced SVG images to restore:', replacedSvgs.length);
  replacedSvgs.forEach(img => {
    const svgIndex = img.getAttribute('data-svg-index');
    console.log('Attempting to restore SVG with index:', svgIndex);
    // Try to find the original SVG data
    for (let [originalElement, data] of originalImages.entries()) {
      if (data.type === 'svg' && data.outerHTML) {
        console.log('Found SVG data to restore:', data.outerHTML);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = data.outerHTML;
        const restoredSvg = tempDiv.firstChild;
        if (restoredSvg && img.parentNode) {
          try {
            img.parentNode.replaceChild(restoredSvg, img);
            console.log('Restored SVG successfully');
            originalImages.delete(originalElement);
            break;
          } catch (error) {
            console.error('Failed to restore SVG:', error);
          }
        }
      }
    }
  });
  
  const elementsWithBg = document.querySelectorAll('[data-original-bg]');
  elementsWithBg.forEach(element => {
    const originalBg = element.getAttribute('data-original-bg');
    if (originalBg === 'none') {
      element.style.backgroundImage = '';
    } else {
      element.style.backgroundImage = originalBg;
    }
    element.removeAttribute('data-original-bg');
  });
  
  // Restore video posters
  const videosWithPoster = document.querySelectorAll('video[data-original-poster]');
  videosWithPoster.forEach(video => {
    video.poster = video.getAttribute('data-original-poster');
    video.removeAttribute('data-original-poster');
  });
  
  // Stop observing and cleanup continuous monitoring
  if (window.imageObserver) {
    window.imageObserver.disconnect();
    window.imageObserver = null;
  }
  
  // Clear any pending delayed sweeps
  if (delayedSweepTimeout) {
    clearTimeout(delayedSweepTimeout);
    delayedSweepTimeout = null;
  }
  
  // Clean up lazy loading event listeners
  if (window.imageSwapperListeners) {
    window.imageSwapperListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    window.imageSwapperListeners = [];
  }
  
  // Show images again after restoration
  setTimeout(() => {
    const restoreStyle = document.getElementById('image-swapper-restore');
    if (restoreStyle) {
      restoreStyle.remove();
    }
    
    // Force repaint
    document.body.offsetHeight;
  }, 50);
  
  console.log('Images restored to original state');
}

// Observer for dynamically loaded images
function observeNewImages(imageUrl, options = {}) {
  if (window.imageObserver) {
    window.imageObserver.disconnect();
  }
  
  // Store options globally for mutation observer access
  window.swapOptions = options;
  
  console.log('Setting up continuous image monitoring with options:', options);
  
  // Main MutationObserver for DOM changes
  window.imageObserver = new MutationObserver(mutations => {
    if (!isSwapping) return; // Don't process if swapping is disabled
    
    let hasNewImages = false;
    
    mutations.forEach(mutation => {
      // Check for new nodes added
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && !isOurElement(node)) {
          hasNewImages = true;
          processNewElement(node, imageUrl, window.swapOptions);
        }
      });
      
      // Check for attribute changes that might reveal new images
      if (mutation.type === 'attributes' && 
          (mutation.attributeName === 'src' || 
           mutation.attributeName === 'data-src' ||
           mutation.attributeName === 'style' ||
           mutation.attributeName === 'class')) {
        const element = mutation.target;
        // Skip if this is our own element or already processed
        if (!isOurElement(element) && 
            (element.tagName === 'IMG' || element.tagName === 'SVG' || 
             element.tagName === 'OBJECT' || element.tagName === 'EMBED')) {
          hasNewImages = true;
          processNewElement(element, imageUrl, window.swapOptions);
        }
      }
    });
    
    if (hasNewImages) {
      console.log('New images detected, processing...');
      // Schedule a debounced final sweep to catch anything that loads after skeleton animations
      scheduleDelayedSweep(imageUrl);
    }
  });
  
  window.imageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'style', 'class', 'data', 'poster']
  });
  
  // Add event listeners for common lazy loading events
  setupLazyLoadListeners(imageUrl);
}

// Set up event listeners for lazy loading scenarios
function setupLazyLoadListeners(imageUrl) {
  // Initialize listener tracking if not exists
  if (!window.imageSwapperListeners) {
    window.imageSwapperListeners = [];
  }
  
  // Throttle function to limit how often events can fire
  function throttle(func, delay) {
    let timeoutId;
    let lastExecTime = 0;
    return function (...args) {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }
  
  // Scroll event handler for lazy loading (throttled)
  const scrollHandler = throttle(() => {
    if (!isSwapping) return;
    sweepForNewImages(imageUrl);
  }, 250); // Only check every 250ms max
  
  // Load event handler for image loading
  const loadHandler = (event) => {
    if (!isSwapping) return;
    const target = event.target;
    if (target.tagName === 'IMG' || target.tagName === 'SVG') {
      // Skip if it's our own element
      if (!isOurElement(target)) {
        processNewElement(target, imageUrl, window.swapOptions || {});
      }
    }
  };
  
  // Resize event handler for responsive images (throttled)
  const resizeHandler = throttle(() => {
    if (!isSwapping) return;
    sweepForNewImages(imageUrl);
  }, 500); // Only check every 500ms max
  
  // Add event listeners and track them for cleanup
  document.addEventListener('scroll', scrollHandler, { passive: true });
  document.addEventListener('load', loadHandler, true); // Use capture phase
  window.addEventListener('resize', resizeHandler, { passive: true });
  
  // Listen for when skeleton loaders complete (common class changes)
  const skeletonHandler = throttle(() => {
    if (!isSwapping) return;
    // Check for skeleton completion after a brief delay
    setTimeout(() => sweepForNewImages(imageUrl), 500);
  }, 1000);
  
  // Listen for animation and transition end events (skeleton animations finishing)
  document.addEventListener('animationend', skeletonHandler, { passive: true });
  document.addEventListener('transitionend', skeletonHandler, { passive: true });
  
  // Listen for common loading completion events
  document.addEventListener('DOMContentLoaded', () => {
    if (isSwapping) {
      setTimeout(() => sweepForNewImages(imageUrl), 1000);
    }
  });
  
  window.addEventListener('load', () => {
    if (isSwapping) {
      setTimeout(() => sweepForNewImages(imageUrl), 1500);
    }
  });
  
  // Track listeners for cleanup
  window.imageSwapperListeners.push(
    { element: document, event: 'scroll', handler: scrollHandler },
    { element: document, event: 'load', handler: loadHandler },
    { element: window, event: 'resize', handler: resizeHandler },
    { element: document, event: 'animationend', handler: skeletonHandler },
    { element: document, event: 'transitionend', handler: skeletonHandler }
  );
  
  // Listen for intersection observer callbacks (modern lazy loading)
  const originalIntersectionObserver = window.IntersectionObserver;
  if (originalIntersectionObserver && !window.imageSwapperIOPatched) {
    window.imageSwapperIOPatched = true;
    window.IntersectionObserver = function(...args) {
      const observer = new originalIntersectionObserver(...args);
      const originalObserve = observer.observe;
      observer.observe = function(target) {
        // When an element starts being observed, check if it's an image
        if (isSwapping && (target.tagName === 'IMG' || target.tagName === 'SVG')) {
          setTimeout(() => processNewElement(target, imageUrl), 50);
        }
        return originalObserve.call(this, target);
      };
      return observer;
    };
  }
}

// Process a single new element
function processNewElement(node, imageUrl, options = {}) {
  // Skip if this is our own element or already processed
  if (isOurElement(node)) {
    return;
  }
  
  // Handle newly added img elements
  if (node.tagName === 'IMG' && options.swapImages) {
    if (!originalImages.has(node) && node.src && !node.hasAttribute('data-original-src')) {
      originalImages.set(node, {
        src: node.src,
        srcset: node.srcset,
        type: 'image'
      });
      node.setAttribute('data-original-src', node.src);
      node.setAttribute('data-original-srcset', node.srcset || '');
    }
    node.src = imageUrl;
    node.srcset = '';
    
    // Ensure GIF autoplay
    if (imageUrl.toLowerCase().includes('.gif')) {
      node.style.animationPlayState = 'running';
    }
  }
  
  // Handle newly added SVG elements
  if (node.tagName === 'SVG' && options.swapSvgs) {
    console.log('Processing dynamic SVG element:', node);
    // Skip hidden SVGs with improved detection
    const rect = node.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(node);
    
    const isHidden = computedStyle.display === 'none' || 
                     computedStyle.visibility === 'hidden' ||
                     rect.width <= 24 || rect.height <= 24 ||  // Increased threshold
                     node.getAttribute('aria-hidden') === 'true' ||
                     node.getAttribute('focusable') === 'false' ||
                     node.hasAttribute('focusable') ||
                     (node.style.position === 'absolute' && 
                      (node.style.height === '0' || node.style.width === '0')) ||
                     // Check for common icon indicators
                     node.getAttribute('fill') === 'currentColor' ||
                     node.classList.contains('icon') ||
                     node.classList.contains('svg-icon') ||
                     // Check parent containers that suggest icons
                     node.closest('button') ||
                     node.closest('[role="button"]') ||
                     node.closest('.icon') ||
                     node.closest('nav') ||
                     node.closest('header') ||
                     node.closest('[class*="icon"]') ||
                     node.closest('[class*="btn"]');
    
    if (isHidden) {
      console.log('Skipping dynamic icon/hidden SVG:', {
        tooSmall: rect.width <= 24 || rect.height <= 24,
        ariaHidden: node.getAttribute('aria-hidden') === 'true',
        focusable: node.getAttribute('focusable') === 'false',
        currentColor: node.getAttribute('fill') === 'currentColor',
        inButton: !!node.closest('button'),
        inNav: !!node.closest('nav')
      });
      return;
    }
    
    if (!originalImages.has(node)) {
      originalImages.set(node, {
        outerHTML: node.outerHTML,
        type: 'svg',
        parentNode: node.parentNode,
        nextSibling: node.nextSibling
      });
      node.setAttribute('data-original-svg', 'true');
    }
    
    // Replace with img
    const imgReplacement = document.createElement('img');
    imgReplacement.src = imageUrl;
    
    // Get dimensions with proper size limits
    let width = node.style.width || node.getAttribute('width');
    let height = node.style.height || node.getAttribute('height');
    
    if (!width && rect.width > 0) {
      width = rect.width + 'px';
    }
    if (!height && rect.height > 0) {
      height = rect.height + 'px';
    }
    
    if (!width || width === '0px') width = '150px';
    if (!height || height === '0px') height = '100px';
    
    // Parse and limit to prevent oversized replacements
    width = parseFloat(width);
    height = parseFloat(height);
    
    const maxWidth = Math.min(width, window.innerWidth * 0.8, 500);
    const maxHeight = Math.min(height, window.innerHeight * 0.8, 400);
    
    imgReplacement.style.width = maxWidth + 'px';
    imgReplacement.style.height = maxHeight + 'px';
    imgReplacement.style.objectFit = 'contain';
    imgReplacement.style.maxWidth = '100%';
    imgReplacement.style.maxHeight = '100%';
    
    // Fix className handling
    if (node.className && typeof node.className === 'object' && node.className.baseVal) {
      imgReplacement.className = node.className.baseVal;
    } else if (node.className && typeof node.className === 'string') {
      imgReplacement.className = node.className;
    } else if (node.getAttribute('class')) {
      imgReplacement.className = node.getAttribute('class');
    }
    
    imgReplacement.setAttribute('data-was-svg', 'true');
    
    if (imageUrl.toLowerCase().includes('.gif')) {
      imgReplacement.style.animationPlayState = 'running';
    }
    
    try {
      node.parentNode.replaceChild(imgReplacement, node);
    } catch (error) {
      console.error('Dynamic SVG replacement failed:', error);
    }
  }
  
  // Handle newly added object/embed elements
  if (node.tagName === 'OBJECT' || node.tagName === 'EMBED') {
    const src = node.data || node.src;
    if (src && (src.includes('.svg') || src.includes('.gif') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
      if (!originalImages.has(node)) {
        originalImages.set(node, {
          src: src,
          outerHTML: node.outerHTML,
          elementType: node.tagName.toLowerCase()
        });
        node.setAttribute(`data-original-${node.tagName.toLowerCase()}`, 'true');
      }
      
      // Replace with img
      const imgReplacement = document.createElement('img');
      imgReplacement.src = imageUrl;
      imgReplacement.style.width = node.style.width || node.getAttribute('width') || '100px';
      imgReplacement.style.height = node.style.height || node.getAttribute('height') || '100px';
      imgReplacement.className = node.className;
      imgReplacement.setAttribute(`data-was-${node.tagName.toLowerCase()}`, 'true');
      
      if (imageUrl.toLowerCase().includes('.gif')) {
        imgReplacement.style.animationPlayState = 'running';
      }
      
      try {
        node.parentNode.replaceChild(imgReplacement, node);
      } catch (error) {
        console.error('Dynamic object/embed replacement failed:', error);
      }
    }
  }
  
  // Check for images within the added node
  if (node.querySelectorAll) {
    const newImages = node.querySelectorAll('img:not([data-original-src]):not([data-was-svg]):not([data-was-object]):not([data-was-embed]), svg:not([data-original-svg]), object[type*="image"]:not([data-original-object]), object[data*=".svg"]:not([data-original-object]), object[data*=".gif"]:not([data-original-object]), embed[src*=".gif"]:not([data-original-embed]), embed[src*=".svg"]:not([data-original-embed]), embed[src*=".jpg"]:not([data-original-embed]), embed[src*=".png"]:not([data-original-embed]), embed[src*=".webp"]:not([data-original-embed])');
    newImages.forEach(element => {
      // Skip if already processed by us
      if (!isOurElement(element)) {
        processNewElement(element, imageUrl);
      }
    });
  }
  
  // Check for background images
  if (node.style) {
    const style = window.getComputedStyle(node);
    const backgroundImage = style.backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none' && backgroundImage.includes('url(')) {
      if (!originalBackgrounds.has(node)) {
        const originalBg = node.style.backgroundImage || backgroundImage;
        originalBackgrounds.set(node, originalBg);
        node.setAttribute('data-original-bg', originalBg);
      }
      node.style.backgroundImage = `url("${imageUrl}")`;
      
      if (imageUrl.toLowerCase().includes('.gif')) {
        node.style.animationPlayState = 'running';
      }
    }
  }
}

// Sweep for any new images that might have been missed (called only when needed)
function sweepForNewImages(imageUrl, options = {}) {
  // Use global options if not provided
  const swapOptions = options.swapImages !== undefined ? options : (window.swapOptions || {
    swapImages: true,
    swapSvgs: true,
    swapObjects: true,
    swapBackgrounds: true,
    swapVideoPoster: true
  });
  
  console.log('Sweeping with options:', swapOptions);
  // Find unprocessed images (exclude our own elements)
  const newImages = document.querySelectorAll('img:not([data-original-src]):not([data-was-svg]):not([data-was-object]):not([data-was-embed])');
  const newSvgs = document.querySelectorAll('svg:not([data-original-svg])');
  const newObjects = document.querySelectorAll('object[type*="image"]:not([data-original-object]), object[data*=".svg"]:not([data-original-object]), object[data*=".gif"]:not([data-original-object])');
  const newEmbeds = document.querySelectorAll('embed[src*=".gif"]:not([data-original-embed]), embed[src*=".svg"]:not([data-original-embed]), embed[src*=".jpg"]:not([data-original-embed]), embed[src*=".png"]:not([data-original-embed]), embed[src*=".webp"]:not([data-original-embed])');
  
  // Also check for images that might have had their src changed (common with skeleton loaders)
  const changedImages = document.querySelectorAll('img[data-original-src]');
  const imagesToRecheck = Array.from(changedImages).filter(img => {
    const originalSrc = img.getAttribute('data-original-src');
    const currentSrc = img.src;
    // If the current src doesn't match our replacement URL and has changed from original, process it
    return currentSrc !== imageUrl && currentSrc !== originalSrc && currentSrc !== '';
  });
  
  const totalNew = newImages.length + newSvgs.length + newObjects.length + newEmbeds.length + imagesToRecheck.length;
  
  if (totalNew > 0) {
    console.log(`Found ${totalNew} new/changed images to process (imgs: ${newImages.length}, svgs: ${newSvgs.length}, objects: ${newObjects.length}, embeds: ${newEmbeds.length}, changed: ${imagesToRecheck.length})`);
    
    // Filter out our own elements before processing
    if (swapOptions.swapImages) {
      Array.from(newImages).filter(img => !isOurElement(img) && img.src && img.src !== imageUrl).forEach(img => processNewElement(img, imageUrl, swapOptions));
    }
    if (swapOptions.swapSvgs) {
      Array.from(newSvgs).filter(svg => !isOurElement(svg)).forEach(svg => processNewElement(svg, imageUrl, swapOptions));
    }
    if (swapOptions.swapObjects) {
      Array.from(newObjects).filter(obj => !isOurElement(obj)).forEach(obj => processNewElement(obj, imageUrl, swapOptions));
    }
    if (swapOptions.swapObjects) {
      Array.from(newEmbeds).filter(embed => !isOurElement(embed)).forEach(embed => processNewElement(embed, imageUrl, swapOptions));
    }
    
    // Re-process images that have changed (skeleton -> real content)
    imagesToRecheck.forEach(img => {
      // Update the original src to the new real content
      originalImages.set(img, {
        src: img.src,
        srcset: img.srcset,
        type: 'image'
      });
      img.setAttribute('data-original-src', img.src);
      img.setAttribute('data-original-srcset', img.srcset || '');
      // Apply our replacement
      img.src = imageUrl;
      img.srcset = '';
    });
  }
}

// Listen for messages from popup/background
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  
  if (request.action === 'swapImages') {
    const options = {
      swapImages: request.swapImages !== false,
      swapSvgs: request.swapSvgs !== false,
      swapObjects: request.swapObjects !== false,
      swapBackgrounds: request.swapBackgrounds !== false,
      swapVideoPoster: request.swapVideoPoster !== false
    };
    swapImages(request.imageUrl, options);
    sendResponse({success: true, isSwapping: true});
  } else if (request.action === 'restoreImages') {
    restoreImages();
    sendResponse({success: true, isSwapping: false});
  } else if (request.action === 'getStatus') {
    sendResponse({
      isSwapping: isSwapping, 
      imageUrl: replacementImageUrl,
      originalCount: originalImages.size
    });
  }
  return true; // Keep message channel open for async response
});

// Check if swapping should be enabled on page load
function initializeOnLoad() {
  console.log('Initializing on page load');
  storage.get(['swappingEnabled', 'replacementImageUrl']).then(result => {
    console.log('Storage result:', result);
    if (result.swappingEnabled && result.replacementImageUrl) {
      console.log('Auto-applying image swapping on page load');
      swapImages(result.replacementImageUrl);
    }
  }).catch(err => {
    console.log('Storage get error:', err);
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOnLoad);
} else {
  initializeOnLoad();
}

// Also initialize on window load for better compatibility
window.addEventListener('load', () => {
  if (isSwapping && replacementImageUrl) {
    // Re-apply swapping to catch any images that loaded after DOMContentLoaded
    swapImages(replacementImageUrl);
  }
});