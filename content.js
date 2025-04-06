// Immediate logging to confirm script is running
// console.log("[Songify Debug] Content script loaded on:", window.location.href);
// console.log("[Songify Debug] Host:", window.location.hostname);

// Global variables
let lastVideoInfo = null;
let isProcessing = false;
let isExtensionValid = true;
let filterTerms = []; // Store filter terms
let originalVideoTitle = null; // Store the original video title
let isYouTubeMusic = false; // Flag to track if we're on YouTube Music
let enableLogging = true; // Enable logging by default for troubleshooting
let currentVideoId = null;
let videoIdToTitleMap = {}; // Map to track known titles for each videoId
let lastKnownVideoId = null; // Last known video ID
let pendingTitleCheck = false; // Flag to track if we're waiting for a title update
let pendingVideoCheck = null;
let lastUrlChange = 0;
let checkInterval = null; // Variable to store the interval ID

// Initialize the logging state
chrome.storage.local.get(['enableLogging'], (result) => {
  // Only disable logging if explicitly set to false
  if (result.enableLogging === false) {
    enableLogging = false;
  } else {
    // Force enable logging for troubleshooting
    enableLogging = true;
    // Save the enabled state
    chrome.storage.local.set({ enableLogging: true });
  }
  console.log('[Songify] Logging ' + (enableLogging ? 'enabled' : 'disabled'));
});

// Listen for logging state changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGGING_STATE_CHANGED") {
    enableLogging = message.enableLogging === true;
    console.log('[Songify] Logging ' + (enableLogging ? 'enabled' : 'disabled'));
  }
});

// Conditional logger function
function songifyLog(...args) {
  if (enableLogging) {
    console.log('[Songify Debug]', ...args);
  }
}

// Error logger (always log errors even with logging disabled)
function songifyError(...args) {
  console.error('[Songify Error]', ...args);
}

// Load filter terms from storage
function loadFilterTerms() {
  if (!isExtensionValid) return;

  try {
    chrome.storage.local.get(["filterTerms"], (result) => {
      if (chrome.runtime.lastError) return;

      filterTerms = result.filterTerms || [];
      // Force refresh when filter terms change
      lastVideoInfo = null;
      getVideoInfo();
    });
  } catch (error) {
    // Ignore errors during loading
  }
}

// Initial load of filter terms
loadFilterTerms();

// Listen for changes to filter terms
chrome.storage.onChanged.addListener((changes) => {
  if (changes.filterTerms) {
    // console.log("[Songify Debug] Filter terms changed, reloading...");
    loadFilterTerms();
  }
});

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_VIDEO_INFO") {
    // First try from lastVideoInfo
    if (originalVideoTitle && lastVideoInfo) {
      songifyLog("[Songify] Responding to GET_VIDEO_INFO with lastVideoInfo");
      sendResponse({
        data: {
          originalTitle: originalVideoTitle,
          filteredTitle: lastVideoInfo.filteredTitle || lastVideoInfo.videoTitle,
          channel: lastVideoInfo.channelName,
          source: lastVideoInfo.source || (window.location.hostname.includes("music.youtube.com") ? "youtube_music" : "youtube")
        },
      });
    } else {
      // If no lastVideoInfo, check if we have data in storage
      chrome.storage.local.get(["currentVideoData"], (result) => {
        if (result.currentVideoData) {
          songifyLog("[Songify] Responding to GET_VIDEO_INFO with stored data");
          sendResponse({
            data: {
              originalTitle: result.currentVideoData.originalTitle,
              filteredTitle: result.currentVideoData.filteredTitle,
              channel: result.currentVideoData.channel,
              source: result.currentVideoData.source
            }
          });
        } else {
          // If no stored data, try to get it fresh
          songifyLog("[Songify] No stored data, trying to get fresh video info");
          const videoInfo = getVideoInfo(true);
          if (videoInfo && videoInfo.videoTitle && videoInfo.channelName) {
            sendResponse({
              data: {
                originalTitle: videoInfo.videoTitle,
                filteredTitle: videoInfo.filteredTitle || videoInfo.videoTitle,
                channel: videoInfo.channelName,
                source: videoInfo.source || (window.location.hostname.includes("music.youtube.com") ? "youtube_music" : "youtube")
              },
            });
          } else {
            songifyLog("[Songify] No video data available");
            sendResponse({ data: null });
          }
        }
      });
      return true; // Keep the message channel open for the async response
    }
  } else if (message.type === "APPLY_DIRECT_FIX") {
    // Handle direct fix request from popup
    songifyLog("[Songify] Received direct fix request:", message.title);

    try {
      // Get current video info if we don't have it
      if (!lastVideoInfo) {
        songifyLog("[Songify] Creating new video info object");
        const videoInfo = getVideoInfo(true);
        if (videoInfo && videoInfo.videoTitle && videoInfo.channelName) {
          originalVideoTitle = videoInfo.videoTitle;
          lastVideoInfo = videoInfo;
        } else {
          songifyError("[Songify] Could not get video info");
          sendResponse({ success: false, error: "Could not get video info" });
          return true;
        }
      } else {
        // Update existing info with new title
        lastVideoInfo.filteredTitle = message.title;
      }

      songifyLog("[Songify] Using video info:", lastVideoInfo);

      // Send updated info to server
      sendVideoInfo(lastVideoInfo);
      
      sendResponse({ success: true });
    } catch (error) {
      songifyError("[Songify] Error applying direct fix:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

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

// Check if we're on YouTube Music
function checkIfYouTubeMusic() {
  // Check the hostname for music.youtube.com
  const isYouTubeMusicDomain = window.location.hostname === "music.youtube.com";

  // Also check some elements that are specific to YouTube Music
  const hasYouTubeMusicElements =
    document.querySelector("ytmusic-app") !== null ||
    document.querySelector("ytmusic-player-bar") !== null ||
    document.querySelector("ytmusic-nav-bar") !== null;

  // console.log("[Songify Debug] YouTube Music check:", {
  //   isYouTubeMusicDomain,
  //   hasYouTubeMusicElements,
  //   hostname: window.location.hostname,
  //   url: window.location.href,
  // });

  return isYouTubeMusicDomain || hasYouTubeMusicElements;
}

// Helper function to get text from shadow DOM
function getTextFromShadowDOM(selector, shadowSelector) {
  try {
    const element = document.querySelector(selector);
    if (element && element.shadowRoot) {
      const shadowElement = element.shadowRoot.querySelector(shadowSelector);
      return shadowElement ? shadowElement.textContent.trim() : '';
    }
  } catch (error) {
    songifyError('Error accessing shadow DOM element:', error);
  }
  return '';
}

// Helper function to get attribute from shadow DOM
function getAttributeFromShadowDOM(selector, shadowSelector, attribute) {
  try {
    const element = document.querySelector(selector);
    if (element && element.shadowRoot) {
      const shadowElement = element.shadowRoot.querySelector(shadowSelector);
      return shadowElement ? shadowElement.getAttribute(attribute) : '';
    }
  } catch (error) {
    songifyError('Error accessing shadow DOM element attribute:', error);
  }
  return '';
}

// Helper function to get src attribute from shadow DOM image
function getImageSrcFromShadowDOM(selector, shadowSelector) {
  try {
    const element = document.querySelector(selector);
    if (element && element.shadowRoot) {
      const shadowElement = element.shadowRoot.querySelector(shadowSelector);
      return shadowElement ? shadowElement.src : '';
    }
  } catch (error) {
    songifyError('Error accessing shadow DOM image src:', error);
  }
  return '';
}

// Helper function to generate a hash from artist and title
function generateSongId(artist, title) {
  if (!artist && !title) return "unknown";
  
  const str = `${artist || ""}:${title || ""}`.toLowerCase();
  let hash = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to a string and ensure it's positive
  return `${Math.abs(hash).toString(16)}`;
}

// Get YouTube Music video information using specific selectors
function getYouTubeMusicInfo() {
  // console.log("[Songify Debug] Getting YouTube Music info");
  // console.log("[Songify Debug] URL:", window.location.href);

  // SIMPLIFIED APPROACH: First try to get info from document title
  let videoTitle = null;
  let artistName = null;
  let songTitle = null;
  let channelName = null;
  let coverUrl = null;

  // Try to get cover art from YouTube Music
  try {
    const coverElement = document.querySelector(
      ".image.ytmusic-player-bar, ytmusic-player-bar .image, img.ytmusic-player-bar, #thumbnail #img, ytmusic-player-bar .image img"
    );
    if (coverElement && coverElement.src) {
      coverUrl = coverElement.src;
      // console.log("[Songify Debug] Found cover art:", coverUrl);
    } else {
      // Alternative method to find cover
      const thumbnailElement = document.querySelector(
        "#song-image img, .thumbnail img"
      );
      if (thumbnailElement && thumbnailElement.src) {
        coverUrl = thumbnailElement.src;
        // console.log("[Songify Debug] Found cover art (alternative):", coverUrl);
      }
    }
  } catch (e) {
    // console.log("[Songify Debug] Error getting cover art:", e);
  }

  // Use document title as primary source for YouTube Music
  const docTitle = document.title;
  if (docTitle) {
    // console.log("[Songify Debug] Document title:", docTitle);

    // Format is typically "Song Name • Artist Name - YouTube Music"
    if (docTitle.includes(" - YouTube Music")) {
      videoTitle = docTitle.replace(" - YouTube Music", "").trim();
      // console.log("[Songify Debug] Extracted from title:", videoTitle);

      // Try to split artist and song if possible
      if (videoTitle.includes(" • ")) {
        const parts = videoTitle.split(" • ");
        if (parts.length >= 2) {
          songTitle = parts[0].trim();
          artistName = parts[1].trim();
          // console.log("[Songify Debug] Split into song/artist:", {
          //   songTitle,
          //   artistName,
          // });

          // Use the artist as channel name
          channelName = artistName;

          // Format the title as "Artist - Song"
          videoTitle = `${artistName} - ${songTitle}`;
        }
      }
    }
  }

  // Fallback to DOM elements if title parsing failed
  if (!videoTitle || !artistName) {
    // console.log("[Songify Debug] Falling back to DOM elements");

    // Try to get title and artist from DOM
    const titleElement = document.querySelector(
      ".title.ytmusic-player-bar, ytmusic-player-bar .title"
    );
    if (titleElement) {
      songTitle = titleElement.textContent.trim();
      // console.log("[Songify Debug] Found song title from DOM:", songTitle);
    }

    const artistElement = document.querySelector(
      ".subtitle.ytmusic-player-bar a, ytmusic-player-bar .subtitle a"
    );
    if (artistElement) {
      artistName = artistElement.textContent.trim();
      // console.log("[Songify Debug] Found artist from DOM:", artistName);
      channelName = artistName;
    }

    // Create formatted title if we have both pieces
    if (songTitle && artistName) {
      videoTitle = `${artistName} - ${songTitle}`;
    }
  }

  // Get video ID from URL
  let videoId = null;
  const urlParams = new URLSearchParams(window.location.search);
  videoId = urlParams.get("v");

  // Alternative method to extract video ID
  if (!videoId) {
    const watchMatch = window.location.href.match(/\/watch\?v=([^&]+)/);
    if (watchMatch && watchMatch[1]) {
      videoId = watchMatch[1];
    }
  }
  
  // If still no videoId, generate one from artist and title
  if (!videoId && (artistName || songTitle)) {
    videoId = generateSongId(artistName, songTitle);
    // console.log("[Songify Debug] Generated video ID:", videoId);
  }

  // console.log("[Songify Debug] YouTube Music data:", {
  //   videoTitle,
  //   channelName,
  //   videoId,
  //   songTitle,
  //   artistName,
  //   coverUrl,
  // });

  return { videoTitle, channelName, videoId, songTitle, artistName, coverUrl };
}

// Get YouTube video information using different selectors to handle DOM changes
function getYouTubeVideoInfo() {
  // console.log("[Songify Debug] Getting regular YouTube info");

  // Try multiple selectors for the title
  let videoTitle = null;
  let artistName = null;
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

  // First check document title for comparison
  const docTitle = document.title;
  let docTitleNoSuffix = '';
  if (docTitle && docTitle.includes(" - YouTube")) {
    docTitleNoSuffix = docTitle.replace(" - YouTube", "").trim();
    songifyLog(`Document title: "${docTitleNoSuffix}"`);
  }

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      videoTitle = element.textContent.trim();
      
      // Check if DOM title appears to be stale by comparing with document title
      if (docTitleNoSuffix && videoTitle !== docTitleNoSuffix) {
        songifyLog(`WARNING: DOM title "${videoTitle}" doesn't match document title "${docTitleNoSuffix}" - possible stale DOM`);
        
        // If document title looks valid and DOM title matches previous video, use document title instead
        const urlParams = new URLSearchParams(window.location.search);
        const currentVideoId = urlParams.get("v");
        const previousTitle = videoIdToTitleMap[lastKnownVideoId];
        
        if (previousTitle && previousTitle === videoTitle && docTitleNoSuffix !== videoTitle) {
          songifyLog(`Using document title "${docTitleNoSuffix}" instead of stale DOM title`);
          videoTitle = docTitleNoSuffix;
        }
      }
      
      // Keep the original full title and extract artist data
      if (videoTitle.includes(" - ") && videoTitle.split(" - ").length === 2) {
        const parts = videoTitle.split(" - ");
        artistName = parts[0].trim();
        // Store the original full title, don't replace it
        // We'll use the artistName separately when needed
      } 

      songifyLog(
        `[Songify Debug] Found title using selector "${selector}": "${videoTitle}"`
      );
      break;
    }
  }

  if (!videoTitle) {
    songifyError(
      "[Songify Debug] Failed to find video title. Tried selectors:",
      titleSelectors
    );

    // Last resort - try to get title from document title (can be less accurate)
    if (docTitleNoSuffix) {
      videoTitle = docTitleNoSuffix;
      songifyLog(
        "[Songify Debug] Using document title as fallback:",
        videoTitle
      );
    }
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
      songifyLog(
        `[Songify Debug] Found channel using selector "${selector}": "${channelName}"`
      );
      break;
    }
  }

  if (!channelName) {
    songifyError(
      "[Songify Debug] Failed to find channel name. Tried selectors:",
      channelSelectors
    );
  }

  // Get video ID from URL - ALWAYS use this for YouTube videos
  let videoId = new URLSearchParams(window.location.search).get("v");
  
  // If video ID is not available from URL params, try alternative extraction
  if (!videoId) {
    const watchMatch = window.location.href.match(/\/watch\?v=([^&]+)/);
    if (watchMatch && watchMatch[1]) {
      videoId = watchMatch[1];
      songifyLog(`[Songify Debug] Found video ID from URL regex: "${videoId}"`);
    } else {
      songifyLog("[Songify Debug] Could not extract video ID from URL");
    }
  } else {
    songifyLog(`[Songify Debug] Found video ID from URL params: "${videoId}"`);
  }

  return { videoTitle, channelName, videoId, artistName };
}

// Apply filter terms to a video title
function applyTitleFilters(title) {
  if (!title) return title;

  let filteredTitle = title;

  // Process [*] pattern - IMPROVED to work reliably for all bracket content
  if (filterTerms.includes("[*]")) {
    // Keep processing until all bracket pairs are removed
    let result = filteredTitle;
    let hasBrackets = true;

    while (hasBrackets) {
      // Find the next bracket pair
      const openBracket = result.indexOf("[");
      if (openBracket === -1) {
        hasBrackets = false;
        continue;
      }

      const closeBracket = result.indexOf("]", openBracket);
      if (closeBracket === -1) {
        hasBrackets = false;
        continue;
      }

      // Remove this bracket pair
      result =
        result.substring(0, openBracket) + result.substring(closeBracket + 1);
    }

    // Clean up any extra whitespace
    filteredTitle = result.replace(/\s+/g, " ").trim();
  }

  // Process (*) pattern
  if (filterTerms.includes("(*)")) {
    // Direct string manipulation for parentheses
    let processedTitle = filteredTitle;
    let stillHasParentheses = true;

    while (stillHasParentheses) {
      const parenOpen = processedTitle.indexOf("(");
      const parenClose = processedTitle.indexOf(")", parenOpen);

      if (parenOpen !== -1 && parenClose !== -1 && parenClose > parenOpen) {
        processedTitle =
          processedTitle.substring(0, parenOpen) +
          processedTitle.substring(parenClose + 1);
      } else {
        stillHasParentheses = false;
      }
    }

    filteredTitle = processedTitle.trim();
  }

  // Process {*} pattern
  if (filterTerms.includes("{*}")) {
    // Direct string manipulation for curly braces
    let processedTitle = filteredTitle;
    let stillHasBraces = true;

    while (stillHasBraces) {
      const braceOpen = processedTitle.indexOf("{");
      const braceClose = processedTitle.indexOf("}", braceOpen);

      if (braceOpen !== -1 && braceClose !== -1 && braceClose > braceOpen) {
        processedTitle =
          processedTitle.substring(0, braceOpen) +
          processedTitle.substring(braceClose + 1);
      } else {
        stillHasBraces = false;
      }
    }

    filteredTitle = processedTitle.trim();
  }

  // Process regular filter terms
  filterTerms.forEach((term) => {
    if (term === "[*]" || term === "(*)" || term === "{*}") {
      return; // Skip special patterns
    }

    const regex = new RegExp(escapeRegExp(term), "gi");
    filteredTitle = filteredTitle.replace(regex, "");
  });

  // Clean up extra spaces
  filteredTitle = filteredTitle.replace(/\s+/g, " ").trim();

  return filteredTitle;
}

// Helper function to escape special characters in regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// New helper function to get current video ID from URL
function getCurrentVideoId() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("v") || null;
  } catch (e) {
    songifyError("Error getting video ID from URL:", e);
    return null;
  }
}

// Main function to get video information
function getVideoInfo(skipSending = false) {
  if (isProcessing) {
    songifyLog("[Songify Debug] Already processing video info, skipping");
    return;
  }
  
  isProcessing = true;
  
  // Get the latest video ID from the URL
  const videoId = getCurrentVideoId();
  songifyLog(`[Songify Debug] Getting video info for ID: ${videoId}`);
  
  // Store the current video ID for race condition detection
  if (currentVideoId !== videoId) {
    lastKnownVideoId = currentVideoId;
    currentVideoId = videoId;
    songifyLog(`[Songify Debug] Video ID changed: ${lastKnownVideoId} -> ${currentVideoId}`);
    
    // If this is a new video ID, mark the time to track how long since URL change
    lastUrlChange = Date.now();

    // Reset lastVideoInfo to force an update when video ID changes
    lastVideoInfo = null;
    songifyLog("[Songify Debug] Reset lastVideoInfo due to video ID change");
  }

  let info = null;
  const hostname = window.location.hostname;

  try {
    // Check if we're on YouTube Music
    if (hostname.includes("music.youtube.com")) {
      songifyLog("[Songify Debug] Detected YouTube Music site");
      info = getYouTubeMusicInfo();
    }
    // Check if we're on regular YouTube
    else if (hostname.includes("youtube.com")) {
      songifyLog("[Songify Debug] Detected regular YouTube site");
      info = getYouTubeVideoInfo();
    }

    if (info && info.videoTitle) {
      // Add the video ID to the info object
      info.videoId = videoId;
      
      // Store the title for this video ID to detect stale titles later
      if (videoId && info.videoTitle) {
        videoIdToTitleMap[videoId] = info.videoTitle;
      }
      
      // Check for race conditions
      const timeSinceUrlChange = Date.now() - lastUrlChange;
      
      // Check if we have a video ID change but the title hasn't updated yet
      const videoIdChanged = lastKnownVideoId !== null && lastKnownVideoId !== videoId;
      const lastKnownTitle = videoIdToTitleMap[lastKnownVideoId];
      const titleLooksStale = lastKnownTitle && lastKnownTitle === info.videoTitle && videoIdChanged;
      
      // If URL changed recently (within 2 seconds) and title matches the previous video, it's likely stale
      const possibleStaleTitle = videoIdChanged && timeSinceUrlChange < 2000;
      
      if ((titleLooksStale || possibleStaleTitle) && !skipSending) {
        songifyLog(`[Songify Debug] Possible stale title detected. Video ID changed ${timeSinceUrlChange}ms ago but title hasn't updated yet.`);
        isProcessing = false;
        
        // Clear any existing pending checks
        if (pendingVideoCheck) {
          clearTimeout(pendingVideoCheck);
        }
        
        // Schedule another check with a longer delay when URL just changed
        const delay = possibleStaleTitle ? 1000 : 500;
        songifyLog(`[Songify Debug] Waiting ${delay}ms for title to update...`);
        
        pendingVideoCheck = setTimeout(() => {
          songifyLog("[Songify Debug] Rechecking video info after delay");
          getVideoInfo(false);
        }, delay);
        
        return null;
      }

      // Check if the data has changed since our last check
      const dataChanged = !lastVideoInfo || 
                         lastVideoInfo.videoTitle !== info.videoTitle || 
                         lastVideoInfo.videoId !== info.videoId ||
                         lastVideoInfo.channelName !== info.channelName;
      
      if (dataChanged) {
        songifyLog(`[Songify Debug] Video info changed: 
                   Old: ${lastVideoInfo ? lastVideoInfo.videoTitle : 'none'} 
                   New: ${info.videoTitle}`);

        // Apply filters to the title
        info.filteredTitle = applyTitleFilters(info.videoTitle);

        // Store the original title
        originalVideoTitle = info.videoTitle;
        
        // Store the new video info for future comparisons
        lastVideoInfo = {...info};

        // Send data to background script for forwarding to the app
        if (!skipSending) {
          sendVideoInfo(info);
          
          // Also notify the popup to update the preview
          chrome.runtime.sendMessage({
            type: "VIDEO_INFO_UPDATE",
            data: {
              originalTitle: originalVideoTitle,
              filteredTitle: info.filteredTitle,
              channel: info.channelName,
              source: info.source || (hostname.includes("music.youtube.com") ? "youtube_music" : "youtube")
            }
          });
        }
      } else {
        songifyLog("[Songify Debug] Video info hasn't changed, skipping update");
        
        // Send a periodic update every 10 seconds even if data hasn't changed
        // This ensures the connection stays alive and UI gets updates
        const now = Date.now();
        if (!info.lastSentTime || now - info.lastSentTime > 10000) {
          songifyLog("[Songify Debug] Sending periodic update to keep connection alive");
          sendVideoInfo(info);
          info.lastSentTime = now;
        }
      }
    } else {
      songifyLog("[Songify Debug] No video data found");
    }
  } catch (e) {
    songifyError("Error in getVideoInfo:", e);
  } finally {
    isProcessing = false;
  }

  return info;
}

// URL change detection
let lastUrl = window.location.href;

// Track YouTube and YouTube Music URLs
const setupURLChangeObserver = () => {
  songifyLog("[Songify] Setting up URL change observer");
  
  // Set up observer to watch for URL changes
  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    
    // Only trigger when the URL actually changes
    if (currentUrl !== lastUrl) {
      const oldUrl = lastUrl;
      lastUrl = currentUrl;
      
      // Log the URL change
      songifyLog(`[Songify] URL changed from ${oldUrl} to ${currentUrl}`);
      
      // Reset tracking variables
      lastUrlChange = Date.now();
      
      // Clear any pending checks
      if (pendingVideoCheck) {
        clearTimeout(pendingVideoCheck);
        pendingVideoCheck = null;
      }
      
      // Get the new video ID from the URL
      const newVideoId = getCurrentVideoId();
      
      // If the video ID changed, update our tracking variables
      if (newVideoId !== currentVideoId) {
        lastKnownVideoId = currentVideoId;
        currentVideoId = newVideoId;
        songifyLog(`[Songify] Video ID changed on URL update: ${lastKnownVideoId} -> ${currentVideoId}`);
      }
      
      // Wait a bit before checking for new video info to allow the page to update
      songifyLog("[Songify] Waiting for page to update before checking video info");
      pendingVideoCheck = setTimeout(() => {
        songifyLog("[Songify] Checking video info after URL change");
        getVideoInfo();
      }, 1500);
    }
  });
  
  // Observe the entire document for changes
  observer.observe(document, { subtree: true, childList: true });
  
  // Also check for changes periodically (backup method)
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      songifyLog(`[Songify] URL changed (detected by interval): ${lastUrl} -> ${currentUrl}`);
      lastUrl = currentUrl;
      lastUrlChange = Date.now();
      
      // Clear any pending checks
      if (pendingVideoCheck) {
        clearTimeout(pendingVideoCheck);
        pendingVideoCheck = null;
      }
      
      // Schedule a video info check
      pendingVideoCheck = setTimeout(() => {
        getVideoInfo();
      }, 1500);
    }
  }, 2000);
  
  return observer;
};

// Start the extension
function initExtension() {
  songifyLog("[Songify] Initializing extension");
  
  // Clear any existing intervals to avoid duplicates
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  // Set up URL change detector
  const urlObserver = setupURLChangeObserver();
  
  // Initial check - wait for DOM to be more ready
  setTimeout(() => {
    songifyLog("[Songify] Running initial video info check");
    getVideoInfo();
  }, 2000);
  
  // Set up periodic checks (every 5 seconds)
  checkInterval = setInterval(() => {
    if (!isExtensionValid) {
      clearInterval(checkInterval);
      songifyLog("[Songify] Extension is no longer valid, clearing interval");
      return;
    }
    songifyLog("[Songify] Running periodic check for video info");
    getVideoInfo();
  }, 5000);
  
  songifyLog("[Songify] Extension initialized");
}

// Clean up resources when page unloads
window.addEventListener("unload", () => {
  // Clear the interval
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  songifyLog("[Songify] Page unloaded, cleaned up resources");
}, false);

// Initialize when DOM is ready
if (document.readyState === "complete" || document.readyState === "interactive") {
  songifyLog("[Songify] Document already ready, initializing right away");
  initExtension();
} else {
  songifyLog("[Songify] Document not ready, waiting for DOMContentLoaded");
  document.addEventListener("DOMContentLoaded", initExtension);
}

// Function to send video info to background script
function sendVideoInfo(info) {
  if (!info) return;
  
  try {
    // Make sure we have a filtered title (in case it wasn't set earlier)
    if (!info.filteredTitle && info.videoTitle) {
      info.filteredTitle = applyTitleFilters(info.videoTitle);
    }
    
    songifyLog("[Songify] Sending video info:", {
      title: info.videoTitle,
      filtered: info.filteredTitle,
      channel: info.channelName,
      videoId: info.videoId
    });
    
    // Store the data in local storage for persistence
    const videoData = {
      originalTitle: info.videoTitle,
      filteredTitle: info.filteredTitle || info.videoTitle,
      channel: info.channelName,
      videoId: info.videoId,
      artist: info.artistName || "",
      cover: info.coverUrl || "",
      source: info.source || (window.location.hostname.includes("music.youtube.com") ? "youtube_music" : "youtube"),
      timestamp: Date.now()
    };
    
    chrome.storage.local.set({ currentVideoData: videoData }, () => {
      songifyLog("[Songify] Stored current video data in local storage");
    });
    
    chrome.runtime.sendMessage(
      {
        type: "VIDEO_INFO",
        data: {
          action: "youtube",
          data: {
            title: info.filteredTitle || info.videoTitle, // Use filtered title if available
            originalTitle: info.videoTitle,
            channel: info.channelName,
            videoId: info.videoId,
            artist: info.artistName || "",
            cover: info.coverUrl || "",
            source: info.source || (window.location.hostname.includes("music.youtube.com") ? "youtube_music" : "youtube")
          },
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          songifyError("[Songify] Error sending message:", chrome.runtime.lastError);
        } else {
          songifyLog("[Songify] Message sent successfully with videoId:", info.videoId);
          
          // Update last sent time
          info.lastSentTime = Date.now();
        }
      }
    );
    
    // Always update the popup separately to ensure the preview stays updated
    chrome.runtime.sendMessage({
      type: "VIDEO_INFO_UPDATE",
      data: {
        originalTitle: info.videoTitle,
        filteredTitle: info.filteredTitle || info.videoTitle,
        channel: info.channelName,
        source: info.source || (window.location.hostname.includes("music.youtube.com") ? "youtube_music" : "youtube")
      }
    });
  } catch (e) {
    songifyError("[Songify] Error sending video info:", e);
  }
}