// Keep track of the last sent video info to avoid duplicates
let lastVideoInfo = null;
let isProcessing = false;
let isExtensionValid = true;

// console.log('[Songify] Content script loaded on:', location.href);

// Check if extension is still valid before any operations
function checkExtensionValidity() {
  try {
    // Simple test to check if chrome.runtime is still available
    chrome.runtime.getURL("");
    return true;
  } catch (e) {
    if (e.message.includes("Extension context invalidated")) {
      isExtensionValid = false;
      return false;
    }
    return true;
  }
}

// Get YouTube video information using different selectors to handle DOM changes
function getYouTubeVideoInfo() {
  // console.log('[Songify] Attempting to get video information');

  // Try multiple selectors for the title
  let videoTitle = null;
  const titleSelectors = [
    "h1.ytd-video-primary-info-renderer",
    "#above-the-fold #title h1",
    "#title yt-formatted-string",
    "ytd-watch-metadata h1",
    "ytd-watch-metadata h1 yt-formatted-string",
    "#container h1.title",
    "h1.title",
    "#title h1",
    "#title",
  ];

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      videoTitle = element.textContent.trim();
      // console.log(`[Songify] Found title using selector "${selector}": "${videoTitle}"`);
      break;
    }
  }

  if (!videoTitle) {
    // console.log('[Songify] Failed to find video title. Tried selectors:', titleSelectors);
  }

  // Try multiple selectors for the channel
  let channelName = null;
  const channelSelectors = [
    "ytd-video-owner-renderer #channel-name a",
    "ytd-video-owner-renderer #channel-name",
    "#top-row ytd-channel-name #text a",
    "#top-row ytd-channel-name #text",
    "#owner #channel-name",
    "#owner-name a",
    "#owner-name",
    "#channel-name",
    ".ytd-channel-name a",
    "#upload-info .ytd-channel-name",
  ];

  for (const selector of channelSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      channelName = element.textContent.trim();
      // console.log(`[Songify] Found channel using selector "${selector}": "${channelName}"`);
      break;
    }
  }

  if (!channelName) {
    // console.log('[Songify] Failed to find channel name. Tried selectors:', channelSelectors);
  }

  // Get video ID from URL
  const videoId = new URLSearchParams(window.location.search).get("v");
  // console.log(`[Songify] Found video ID from URL: "${videoId}"`);

  return { videoTitle, channelName, videoId };
}

// Get video information from the current page
function getVideoInfo() {
  // console.log('[Songify] getVideoInfo called');

  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionValidity()) {
    // Extension context is invalid, don't continue
    return;
  }

  // Avoid concurrent processing
  if (isProcessing) {
    // console.log('[Songify] Already processing, skipping');
    return;
  }
  isProcessing = true;

  try {
    // Get video element to ensure video is present
    const videoElement = document.querySelector("video");
    if (!videoElement) {
      // console.log('[Songify] No video element found on page');
      isProcessing = false;
      return;
    }

    // console.log('[Songify] Video element found, getting video info');

    // Get video info using more reliable function
    const { videoTitle, channelName, videoId } = getYouTubeVideoInfo();
    // console.log('[Songify] Info collected:', { videoTitle, channelName, videoId });

    // Verify we have all required information
    if (!videoTitle || !channelName || !videoId) {
      // console.log('[Songify] Missing required information, not sending update');
      isProcessing = false;
      return;
    }

    // Create current info object
    const currentInfo = {
      title: videoTitle,
      channel: channelName,
      videoId: videoId,
    };

    // CHANGE DETECTION DISABLED: Always send updates
    // console.log('[Songify] Change detection disabled, always sending updates');

    // Update our last info reference (create a new object)
    lastVideoInfo = { ...currentInfo };

    // Send the message to background script
    try {
      chrome.runtime.sendMessage(
        {
          type: "VIDEO_INFO",
          data: {
            action: "youtube",
            data: currentInfo,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            // console.error('[Songify] Error sending message:', chrome.runtime.lastError);
          } else {
            // console.log('[Songify] Message sent successfully, response:', response);
          }
        }
      );
    } catch (msgError) {
      // Extension might have been invalidated during execution
      isExtensionValid = false;
      // console.error('[Songify] Error sending message:', msgError);
    }
  } catch (error) {
    // console.error('[Songify] Error in getVideoInfo:', error);
    if (error.message.includes("Extension context invalidated")) {
      isExtensionValid = false;
    }
  } finally {
    isProcessing = false;
  }
}

// Watch for URL changes (for SPA navigation)
let lastUrl = location.href;
try {
  new MutationObserver(() => {
    if (!isExtensionValid) return;

    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      // console.log(`[Songify] URL changed from "${lastUrl}" to "${currentUrl}"`);
      lastUrl = currentUrl;
      // Clear last video info to force a new send on URL change
      lastVideoInfo = null;
      setTimeout(getVideoInfo, 1000); // Process sooner on URL change
    }
  }).observe(document, { subtree: true, childList: true });
} catch (e) {
  // If we can't set up the observer, the extension might be invalidated
  // console.error('[Songify] Error setting up observer:', e);
  isExtensionValid = false;
}

// Initial check
// console.log('[Songify] Setting up initial check');
setTimeout(() => {
  if (isExtensionValid) {
    // console.log('[Songify] Running initial check after timeout');
    getVideoInfo();
  }
}, 1000);

// Simple approach: check regularly
// console.log('[Songify] Setting up interval checks every 3 seconds');
const intervalId = setInterval(() => {
  if (!isExtensionValid) {
    // If extension becomes invalid, clear the interval
    clearInterval(intervalId);
    return;
  }

  // console.log('[Songify] Running interval check');
  getVideoInfo();
}, 3000);
