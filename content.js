// Keep track of the last sent video info to avoid duplicates
let lastVideoInfo = null;

function getVideoInfo() {
    try {
        const videoTitle = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim();
        const channelElement = document.querySelector('ytd-video-owner-renderer #channel-name a');
        const channelName = channelElement?.textContent?.trim();
        const videoId = new URLSearchParams(window.location.search).get('v');

        // Only send if we have all information
        if (videoTitle && channelName && videoId) {
            const currentInfo = {
                title: videoTitle,
                channel: channelName,
                videoId: videoId
            };

            // Check if we need to send an update - always send if this is first detection
            // or if any of the values have changed
            let shouldSendUpdate = true;
            
            if (lastVideoInfo && 
                typeof lastVideoInfo === 'object' &&
                lastVideoInfo.title === currentInfo.title && 
                lastVideoInfo.channel === currentInfo.channel && 
                lastVideoInfo.videoId === currentInfo.videoId) {
                shouldSendUpdate = false;
            }
                
            if (shouldSendUpdate) {
                // Update our last info reference
                lastVideoInfo = {...currentInfo};
                
                // Send the message
                chrome.runtime.sendMessage({
                    type: 'VIDEO_INFO',
                    data: {
                        action: 'youtube',
                        data: currentInfo
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error in getVideoInfo:', error);
    }
}

// Initial check
setTimeout(getVideoInfo, 1500);

// Watch for URL changes (for SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        lastVideoInfo = null; // Reset last video info on URL change
        setTimeout(getVideoInfo, 1500); // Wait for page to load
    }
}).observe(document, { subtree: true, childList: true });

// Watch for title changes
const titleObserver = new MutationObserver(() => {
    getVideoInfo();
});

// Start observing title changes
function observeTitle() {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer');
    if (title) {
        titleObserver.observe(title, {
            subtree: true,
            childList: true,
            characterData: true
        });
    }
}

// Initial title observer setup
observeTitle();

// Re-setup title observer when navigation occurs
const bodyObserver = new MutationObserver(() => {
    observeTitle();
}).observe(document.body, { childList: true, subtree: true });

// Poll for changes every 5 seconds as a fallback
setInterval(getVideoInfo, 5000); 