// Cleaned-up version of the Songify content script

function checkIsWatchPage(url) {
  return url.includes("/watch") || url.includes("music.youtube.com");
}

// Global variables
let lastVideoInfo = null;
let isProcessing = false;
let isExtensionValid = true;
let filterTerms = [];
let originalVideoTitle = null;
let enableLogging = true;
let currentVideoId = null;
let videoIdToTitleMap = {};
let lastKnownVideoId = null;
let pendingVideoCheck = null;
let lastUrlChange = 0;
let checkInterval = null;
let isWatchPage = false;

// Initialize the logging state
chrome.storage.local.get(["enableLogging"], (result) => {
  enableLogging = result.enableLogging !== false;
  songifyLog("[Songify] Logging " + (enableLogging ? "enabled" : "disabled"));
});

loadFilterTerms(); // Load filter terms immediately after logging state

// Listen for logging state changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGGING_STATE_CHANGED") {
    enableLogging = message.enableLogging === true;
    songifyLog("[Songify] Logging " + (enableLogging ? "enabled" : "disabled"));
  } else if (message.type === "GET_VIDEO_INFO") {
    respondToGetVideoInfo(message, sender, sendResponse);
    return true;
  } else if (message.type === "APPLY_DIRECT_FIX") {
    handleDirectFix(message, sendResponse);
    return true;
  }
});

function songifyLog(...args) {
  if (enableLogging) console.log("[Songify Debug]", ...args);
}

function songifyError(...args) {
  console.error("[Songify Error]", ...args);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCurrentVideoId() {
  try {
    return new URLSearchParams(window.location.search).get("v") || null;
  } catch (e) {
    songifyError("Error getting video ID from URL:", e);
    return null;
  }
}

function applyTitleFilters(title) {
  if (!title) return title;
  let filteredTitle = title;

  const patterns = {
    "[*]": [/\[.*?\]/g],
    "(*)": [/\(.*?\)/g],
    "{*}": [/\{.*?\}/g],
  };

  // 1. First apply exact string matches (e.g., "[DnB] -", "[Monstercat Release]")
  filterTerms.forEach((term) => {
    if (patterns[term]) return; // skip wildcard patterns
    const regex = new RegExp(escapeRegExp(term), "gi");
    songifyLog("Applying exact filter:", regex);
    filteredTitle = filteredTitle.replace(regex, "");
  });

  // 2. Then apply special wildcard patterns
  Object.entries(patterns).forEach(([term, regexArr]) => {
    if (filterTerms.includes(term)) {
      regexArr.forEach((regex) => {
        songifyLog("Applying wildcard pattern:", regex);
        filteredTitle = filteredTitle.replace(regex, "");
      });
    }
  });
  filteredTitle = filteredTitle.replace(/\s+/g, " ").trim();
  return filteredTitle;
}

function generateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function loadFilterTerms() {
  if (!isExtensionValid) return;
  chrome.storage.local.get(["filterTerms"], (result) => {
    if (chrome.runtime.lastError) return;
    filterTerms = result.filterTerms || [];
    lastVideoInfo = null;
    getVideoInfo();
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.filterTerms) loadFilterTerms();
});

function sendVideoInfo(info) {
  if (!info) return;
  if (!info.filteredTitle && info.videoTitle) {
    info.filteredTitle = applyTitleFilters(info.videoTitle);
  }

  const source =
    info.source ||
    (window.location.hostname.includes("music.youtube.com")
      ? "youtube_music"
      : "youtube");
  const hashInput = `${info.artistName || ""}:${info.videoTitle || ""}:${
    info.videoId || ""
  }`;
  const dataHash = generateHash(hashInput);

  const videoData = {
    originalTitle: info.videoTitle,
    filteredTitle: info.filteredTitle || info.videoTitle,
    channel: info.channelName,
    videoId: info.videoId,
    artist: info.artistName || "",
    cover: info.coverUrl || "",
    source,
    timestamp: Date.now(),
    hash: dataHash,
  };

  chrome.storage.local.set({ currentVideoData: videoData });

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
          source:
            info.source ||
            (window.location.hostname.includes("music.youtube.com")
              ? "youtube_music"
              : "youtube"),
          hash: dataHash,
        },
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        songifyError(
          "[Songify] Error sending message:",
          chrome.runtime.lastError
        );
      } else {
        songifyLog(
          "[Songify] Message sent successfully with videoId:",
          info.videoId
        );

        // Update last sent time
        info.lastSentTime = Date.now();
      }
    }
  );

  chrome.runtime.sendMessage({
    type: "VIDEO_INFO_UPDATE",
    data: {
      originalTitle: info.videoTitle,
      filteredTitle: info.filteredTitle || info.videoTitle,
      channel: info.channelName,
      source,
      hash: dataHash,
    },
  });
}

function respondToGetVideoInfo(message, sender, sendResponse) {
  if (originalVideoTitle && lastVideoInfo) {
    songifyLog("[Songify] Responding to GET_VIDEO_INFO with lastVideoInfo");
    sendResponse({
      data: {
        originalTitle: originalVideoTitle,
        filteredTitle: lastVideoInfo.filteredTitle || lastVideoInfo.videoTitle,
        channel: lastVideoInfo.channelName,
        source:
          lastVideoInfo.source ||
          (window.location.hostname.includes("music.youtube.com")
            ? "youtube_music"
            : "youtube"),
        hash: generateHash(
          `${lastVideoInfo.artistName || ""}:${
            lastVideoInfo.videoTitle || ""
          }:${lastVideoInfo.videoId || ""}`
        ),
      },
    });
  } else {
    chrome.storage.local.get(["currentVideoData"], (result) => {
      if (result.currentVideoData) {
        songifyLog("[Songify] Responding with stored data");
        sendResponse({ data: result.currentVideoData });
      } else {
        const videoInfo = getVideoInfo(true);
        if (videoInfo && videoInfo.videoTitle && videoInfo.channelName) {
          sendResponse({
            data: {
              originalTitle: videoInfo.videoTitle,
              filteredTitle: videoInfo.filteredTitle || videoInfo.videoTitle,
              channel: videoInfo.channelName,
              source:
                videoInfo.source ||
                (window.location.hostname.includes("music.youtube.com")
                  ? "youtube_music"
                  : "youtube"),
              hash: generateHash(
                `${videoInfo.artistName || ""}:${videoInfo.videoTitle || ""}:${
                  videoInfo.videoId || ""
                }`
              ),
            },
          });
        } else {
          songifyLog("[Songify] No video data available");
          sendResponse({ data: null });
        }
      }
    });
  }
}

function getYouTubeMusicInfo() {
  let videoTitle = null;
  let artistName = null;
  let songTitle = null;
  let channelName = null;
  let coverUrl = null;

  // 1. Get cover art (same logic you had, slightly cleaned up)
  try {
    const coverSelectors = [
      ".image.ytmusic-player-bar img",
      "ytmusic-player-bar .image img",
      "#song-image img",
      ".thumbnail img",
    ];

    for (const selector of coverSelectors) {
      const img = document.querySelector(selector);
      if (img?.src) {
        coverUrl = img.src;
        songifyLog("[Songify] Found YT Music cover via:", selector, coverUrl);
        break;
      }
    }
  } catch (e) {
    songifyError("[Songify] Error getting YT Music cover:", e);
  }

  // 2. Try DOM-based title + artist first (preferred method)
  const titleEl = document.querySelector(".title.ytmusic-player-bar");
  const artistEl = document.querySelector(".subtitle.ytmusic-player-bar a");

  if (titleEl?.textContent && artistEl?.textContent) {
    songTitle = titleEl.textContent.trim();
    artistName = artistEl.textContent.trim();
    videoTitle = `${artistName} - ${songTitle}`;
    channelName = artistName;
  }

  // 3. Fallback: parse from document.title if DOM fails
  if (!videoTitle || !artistName) {
    const docTitle = document.title.replace(" - YouTube Music", "").trim();
    if (docTitle.includes(" • ")) {
      const [rawTitle, rawArtist] = docTitle.split(" • ");
      songTitle = rawTitle?.trim() || songTitle;
      artistName = rawArtist?.trim() || artistName;
      videoTitle = `${artistName} - ${songTitle}`;
      channelName = artistName;
    }
  }

  // 4. Video ID
  let videoId = getCurrentVideoId();
  if (!videoId && (artistName || songTitle)) {
    videoId = generateSongId(artistName, songTitle);
  }

  return {
    videoTitle,
    channelName,
    videoId,
    songTitle,
    artistName,
    coverUrl,
    source: "youtube_music",
  };
}

// Helper function to generate a hash from artist and title
function generateSongId(artist, title) {
  if (!artist && !title) return "unknown";

  const str = `${artist || ""}:${title || ""}`.toLowerCase();
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Convert to a string and ensure it's positive
  return `${Math.abs(hash).toString(16)}`;
}

function getYouTubeVideoInfo() {
  const docTitle = document.title.replace(" - YouTube", "").trim();
  const channelElement =
    document.querySelector("ytd-channel-name a") ||
    document.querySelector("#owner-name a");
  const channelName = channelElement?.textContent.trim() || "Unknown Channel";

  let artistName = null;
  if (docTitle.includes(" - ")) {
    const parts = docTitle.split(" - ");
    artistName = parts[0].trim();
  }

  const videoId = getCurrentVideoId();
  return {
    videoTitle: docTitle,
    channelName,
    videoId,
    artistName,
    coverUrl: null,
    source: "youtube",
  };
}

function getVideoInfo(skipSending = false) {
  if (isProcessing) return;
  isProcessing = true;

  const hostname = window.location.hostname;
  let info = null;

  try {
    if (hostname.includes("music.youtube.com")) {
      info = getYouTubeMusicInfo();
    } else if (hostname.includes("youtube.com")) {
      info = getYouTubeVideoInfo();
    }

    if (info && info.videoTitle) {
      originalVideoTitle = info.videoTitle;
      info.filteredTitle = applyTitleFilters(info.videoTitle);
      lastVideoInfo = info;
      if (!skipSending) sendVideoInfo(info);
    }
  } catch (e) {
    songifyError("[Songify] Error in getVideoInfo:", e);
  } finally {
    isProcessing = false;
  }

  return info;
}

function initExtension() {
  songifyLog("[Songify] Initializing extension");
  if (checkInterval) clearInterval(checkInterval);

  isWatchPage = checkIsWatchPage(window.location.href);
  if (isWatchPage) {
    setTimeout(() => getVideoInfo(), 2000);
    checkInterval = setInterval(() => {
      if (!isExtensionValid) {
        clearInterval(checkInterval);
        return;
      }
      getVideoInfo();
    }, 5000);
  }

  setupURLChangeObserver();
}

function setupURLChangeObserver() {
  songifyLog("[Songify] Setting up URL change observer");
  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastKnownVideoId) {
      songifyLog("[Songify] Detected URL change");
      lastKnownVideoId = currentUrl;
      getVideoInfo();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastKnownVideoId) {
      lastKnownVideoId = currentUrl;
      getVideoInfo();
    }
  }, 2000);
}

window.addEventListener("unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  songifyLog("[Songify] Page unloaded, cleaned up resources");
});

if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  initExtension();
  songifyLog("Startup check: logging is", enableLogging);
  songifyLog("Filter terms:", filterTerms);
} else {
  document.addEventListener("DOMContentLoaded", initExtension);
}
