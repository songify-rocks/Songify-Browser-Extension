let websocket = null;
let port = 8080; // Default port
let reconnectTimeout = null;
let isExtensionValid = true;

// Function to notify popup of connection status
function notifyConnectionStatus(isConnected) {
    if (!isExtensionValid) return;
    
    chrome.runtime.sendMessage({
        type: 'CONNECTION_STATUS',
        isConnected: isConnected
    }).catch(() => {
        // Ignore errors if popup is not open
    });
}

// Function to create WebSocket connection
function createWebSocket() {
    if (!isExtensionValid) return;

    if (websocket) {
        try {
            websocket.close();
        } catch (error) {
            // Ignore close errors
        }
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    try {
        websocket = new WebSocket(`ws://localhost:${port}`);
        
        websocket.onopen = () => {
            if (!isExtensionValid) {
                websocket.close();
                return;
            }
            notifyConnectionStatus(true);
        };

        websocket.onerror = () => {
            if (!isExtensionValid) return;
            notifyConnectionStatus(false);
        };

        websocket.onclose = () => {
            if (!isExtensionValid) return;
            notifyConnectionStatus(false);
            // Try to reconnect after 5 seconds
            reconnectTimeout = setTimeout(createWebSocket, 5000);
        };
    } catch (error) {
        if (!isExtensionValid) return;
        notifyConnectionStatus(false);
        // Try to reconnect after 5 seconds
        reconnectTimeout = setTimeout(createWebSocket, 5000);
    }
}

// Initialize connection
function initialize() {
    chrome.storage.local.get(['websocketPort'], (result) => {
        if (chrome.runtime.lastError || !isExtensionValid) return;
        
        if (result.websocketPort) {
            port = result.websocketPort;
        }
        createWebSocket();
    });
}

// Listen for port changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!isExtensionValid) return;
    
    if (changes.websocketPort && areaName === 'local') {
        port = changes.websocketPort.newValue;
        createWebSocket();
    }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionValid) {
        sendResponse({ success: false, error: 'Extension context invalid' });
        return false;
    }

    if (message.type === 'CHECK_CONNECTION') {
        sendResponse({ 
            isConnected: websocket && websocket.readyState === WebSocket.OPEN,
            isValid: isExtensionValid
        });
        return false;
    }
    
    if (message.type === 'VIDEO_INFO' && websocket && websocket.readyState === WebSocket.OPEN) {
        try {
            websocket.send(JSON.stringify(message.data));
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else {
        sendResponse({ success: false, error: 'WebSocket not ready' });
    }
    return false;
});

// Handle extension invalidation
chrome.runtime.onSuspend.addListener(() => {
    isExtensionValid = false;
    if (websocket) {
        try {
            websocket.close();
        } catch (error) {
            // Ignore close errors
        }
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
});

// Start the extension
initialize(); 