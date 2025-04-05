// Immediate logging to confirm script is running
// console.log("[Songify Debug] Content script loaded on:", window.location.href);
// console.log("[Songify Debug] Host:", window.location.hostname);

// Keep track of the last sent video info to avoid duplicates
let lastVideoInfo = null;
let isProcessing = false;
let isExtensionValid = true;
let filterTerms = []; // Store filter terms
let originalVideoTitle = null; // Store the original video title
let isYouTubeMusic = false; // Flag to track if we're on YouTube Music

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
    if (originalVideoTitle && lastVideoInfo) {
      sendResponse({
        data: {
          originalTitle: originalVideoTitle,
          filteredTitle: lastVideoInfo.title,
          channel: lastVideoInfo.channel,
        },
      });
    } else {
      // If we don't have data yet, try to get it
      const videoInfo = getVideoInfo(true);
      if (videoInfo && videoInfo.title && videoInfo.channel) {
        sendResponse({
          data: {
            originalTitle: originalVideoTitle || videoInfo.title,
            filteredTitle: videoInfo.title,
            channel: videoInfo.channel,
          },
        });
      } else {
        sendResponse({ data: null });
      }
    }
    return true; // Keep the message channel open for async response
  } else if (message.type === "APPLY_DIRECT_FIX") {
    // Handle direct fix request from popup
    // console.log("[Songify Debug] Received direct fix request:", message.title);

    try {
      // Get current video info if we don't have it
      if (!lastVideoInfo) {
        // console.log("[Songify Debug] Creating new video info object");
        const videoInfo = getVideoInfo(true);
        if (videoInfo && videoInfo.title && videoInfo.channel) {
          originalVideoTitle = videoInfo.title;
          lastVideoInfo = videoInfo;
        } else {
          // console.error("[Songify Debug] Could not get video info");
          sendResponse({ success: false, error: "Could not get video info" });
          return true;
        }
      } else {
        // Update existing info with new title
        lastVideoInfo.title = message.title;
      }

      // console.log("[Songify Debug] Using video info:", lastVideoInfo);

      // Send updated info to server
      chrome.runtime.sendMessage({
        type: "VIDEO_INFO",
        data: {
          action: "youtube",
          data: {
            title: message.title,
            channel: lastVideoInfo.channel,
            videoId: lastVideoInfo.videoId,
            artist: lastVideoInfo.artistName || "",
            cover: lastVideoInfo.coverUrl || "",
          },
        },
      });

      // Notify popup of the update
      chrome.runtime.sendMessage({
        type: "VIDEO_INFO_UPDATE",
        data: {
          originalTitle: originalVideoTitle || "Unknown",
          filteredTitle: message.title,
          channel: lastVideoInfo.channel,
        },
      });

      // console.log("[Songify Debug] Direct fix applied successfully");
      sendResponse({ success: true });
    } catch (error) {
      // console.error("[Songify Debug] Error applying direct fix:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

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
      // console.log(
      //   `[Songify Debug] Found title using selector "${selector}": "${videoTitle}"`
      // );
      break;
    }
  }

  if (!videoTitle) {
    // console.log(
    //   "[Songify Debug] Failed to find video title. Tried selectors:",
    //   titleSelectors
    // );

    // Last resort - try to get title from document title (can be less accurate)
    const docTitle = document.title;
    if (docTitle && docTitle.includes(" - YouTube")) {
      videoTitle = docTitle.replace(" - YouTube", "").trim();
      // console.log(
      //   "[Songify Debug] Using document title as fallback:",
      //   videoTitle
      // );
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
      // console.log(
      //   `[Songify Debug] Found channel using selector "${selector}": "${channelName}"`
      // );
      break;
    }
  }

  if (!channelName) {
    // console.log(
    //   "[Songify Debug] Failed to find channel name. Tried selectors:",
    //   channelSelectors
    // );
  }

  // Get video ID from URL
  const videoId = new URLSearchParams(window.location.search).get("v");
  // console.log(`[Songify Debug] Found video ID from URL: "${videoId}"`);

  // Special debug for Monstercat videos
  if (
    videoTitle &&
    videoTitle.includes("[") &&
    ((channelName && channelName.includes("Monstercat")) ||
      videoTitle.includes("Monstercat"))
  ) {
    // console.log("[Songify Debug] Detected Monstercat video with brackets!");
    // console.log(
    //   `[Songify Debug] Brackets: [${videoTitle.indexOf(
    //     "["
    //   )}] to [${videoTitle.lastIndexOf("]")}]`
    // );
  }

  return { videoTitle, channelName, videoId };
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

// Get video information from the current page
function getVideoInfo(skipSending = false) {
  // console.log("[Songify Debug] getVideoInfo called, skipSending:", skipSending);

  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionValidity()) {
    // Extension context is invalid, don't continue
    return null;
  }

  // Avoid concurrent processing
  if (isProcessing && !skipSending) {
    // console.log("[Songify Debug] Already processing, skipping");
    return null;
  }
  isProcessing = !skipSending;

  try {
    // Check if we're on YouTube Music
    isYouTubeMusic = window.location.hostname === "music.youtube.com";
    // console.log("[Songify Debug] isYouTubeMusic:", isYouTubeMusic);

    // Verify we have video content
    const videoElement = document.querySelector("video");
    if (!videoElement && !skipSending) {
      // console.log("[Songify Debug] No video element found on page");
      isProcessing = false;
      return null;
    }

    // Get video info using site-specific function
    let videoInfo;

    if (isYouTubeMusic) {
      // Get YouTube Music info (has better structured metadata)
      const musicInfo = getYouTubeMusicInfo();

      if (!musicInfo.videoTitle) {
        // console.log(
        //   "[Songify Debug] No title found for YouTube Music. Using fallbacks..."
        // );
        // If no title was found, try to get the document title
        const docTitle = document.title;
        if (docTitle) {
          musicInfo.videoTitle = docTitle
            .replace(" - YouTube Music", "")
            .trim();
          if (!musicInfo.channelName) {
            // Try to extract artist from document title
            if (musicInfo.videoTitle.includes(" • ")) {
              const artistPart = musicInfo.videoTitle.split(" • ")[1];
              if (artistPart) {
                musicInfo.channelName = artistPart.trim();
              }
            }
          }
        }
      }

      if (!musicInfo.videoTitle || !musicInfo.channelName) {
        // console.log(
        //   "[Songify Debug] Missing required information from YouTube Music"
        // );
        isProcessing = false;
        return null;
      }

      if (!musicInfo.videoId) {
        // Try harder to get video ID
        const urlVideoId = window.location.href.split("/watch?v=")[1]?.split("&")[0];
        if (urlVideoId) {
          musicInfo.videoId = urlVideoId;
        } else if (musicInfo.artistName || musicInfo.songTitle) {
          // Generate ID from artist and title if we have either
          musicInfo.videoId = generateSongId(musicInfo.artistName, musicInfo.songTitle);
          // console.log("[Songify Debug] Using generated video ID:", musicInfo.videoId);
        } else {
          musicInfo.videoId = "unknown";
        }
      }

      // Store the original title
      originalVideoTitle = musicInfo.videoTitle;

      // Use the artist-title format for YouTube Music
      videoInfo = {
        title: musicInfo.videoTitle,
        channel: musicInfo.channelName,
        videoId: musicInfo.videoId,
        songTitle: musicInfo.songTitle,
        artistName: musicInfo.artistName,
        coverUrl: musicInfo.coverUrl,
        source: "youtube_music",
      };

      // console.log("[Songify Debug] Final YouTube Music info:", videoInfo);
    } else {
      // Get regular YouTube info
      const { videoTitle, channelName, videoId } = getYouTubeVideoInfo();

      if (!videoTitle || !channelName || !videoId) {
        // console.log(
        //   "[Songify Debug] Missing required information from YouTube"
        // );
        isProcessing = false;
        return null;
      }

      // Store the original title
      originalVideoTitle = videoTitle;

      videoInfo = {
        title: videoTitle,
        channel: channelName,
        videoId: videoId,
        // Add empty artist and cover fields for regular YouTube
        songTitle: "",
        artistName: "",
        coverUrl: "",
        source: "youtube",
      };
    }

    // Apply filters to the title
    videoInfo.title = applyTitleFilters(videoInfo.title);

    // If we're just getting the info without sending it, return it now
    if (skipSending) {
      isProcessing = false;
      return videoInfo;
    }

    // Update our last info reference (create a new object)
    lastVideoInfo = { ...videoInfo };

    // Send the message to background script
    try {
      chrome.runtime.sendMessage(
        {
          type: "VIDEO_INFO",
          data: {
            action: "youtube",
            data: {
              title: videoInfo.title,
              channel: videoInfo.channel,
              videoId: videoInfo.videoId,
              artist: videoInfo.artistName || "",
              cover: videoInfo.coverUrl || "",
            },
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            // console.error(
            //   "[Songify Debug] Error sending message:",
            //   chrome.runtime.lastError
            // );
          } else {
            // console.log(
            //   "[Songify Debug] Message sent successfully, response:",
            //   response
            // );
          }
        }
      );

      // Also notify the popup if it's open
      chrome.runtime.sendMessage({
        type: "VIDEO_INFO_UPDATE",
        data: {
          originalTitle: originalVideoTitle,
          filteredTitle: videoInfo.title,
          channel: videoInfo.channel,
        },
      });

      return videoInfo;
    } catch (msgError) {
      // Extension might have been invalidated during execution
      isExtensionValid = false;
      // console.error("[Songify Debug] Error sending message:", msgError);
      return null;
    }
  } catch (error) {
    // console.error("[Songify Debug] Error in getVideoInfo:", error);
    if (error.message.includes("Extension context invalidated")) {
      isExtensionValid = false;
    }
    return null;
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
      // console.log(
      //   `[Songify Debug] URL changed from "${lastUrl}" to "${currentUrl}"`
      // );
      lastUrl = currentUrl;
      // Clear last video info to force a new send on URL change
      lastVideoInfo = null;
      setTimeout(getVideoInfo, 1000); // Process sooner on URL change
    }
  }).observe(document, { subtree: true, childList: true });
} catch (e) {
  // If we can't set up the observer, the extension might be invalidated
  // console.error("[Songify Debug] Error setting up observer:", e);
  isExtensionValid = false;
}

// Initial check to get video info
getVideoInfo();

// Set up interval to check for video data every 3 seconds
const checkInterval = setInterval(() => {
  if (!isExtensionValid) {
    // If extension becomes invalid, clear the interval
    clearInterval(checkInterval);
    return;
  }
  
  // console.log('[Songify Debug] Running interval check');
  getVideoInfo();
}, 3000);

// Clean up interval when page unloads
window.addEventListener('beforeunload', () => {
  clearInterval(checkInterval);
});
