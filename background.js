let websocket = null;
let port = 8080; // Default port
let reconnectTimeout = null;
let isExtensionValid = true;
let enableLogging = false; // Logging disabled by default

// Initialize the logging state
chrome.storage.local.get(['enableLogging'], (result) => {
  enableLogging = result.enableLogging === true;
  songifyLog('Logging ' + (enableLogging ? 'enabled' : 'disabled'));
});

// Listen for logging state changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGGING_STATE_CHANGED") {
    enableLogging = message.enableLogging === true;
    songifyLog('Logging ' + (enableLogging ? 'enabled' : 'disabled'));
    return false;
  }
  
  // Handle other messages in the existing listener
  return handleMessage(message, sender, sendResponse);
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
        songifyLog(`Creating WebSocket connection to ws://localhost:${port}`);
        websocket = new WebSocket(`ws://localhost:${port}`);
        
        websocket.onopen = () => {
            if (!isExtensionValid) {
                websocket.close();
                return;
            }
            songifyLog('WebSocket connection established');
            notifyConnectionStatus(true);
        };

        websocket.onerror = (error) => {
            if (!isExtensionValid) return;
            songifyError('WebSocket error:', error);
            notifyConnectionStatus(false);
        };

        websocket.onclose = () => {
            if (!isExtensionValid) return;
            songifyLog('WebSocket connection closed, will try to reconnect in 5 seconds');
            notifyConnectionStatus(false);
            // Try to reconnect after 5 seconds
            reconnectTimeout = setTimeout(createWebSocket, 5000);
        };
    } catch (error) {
        if (!isExtensionValid) return;
        songifyError('Error creating WebSocket:', error);
        notifyConnectionStatus(false);
        // Try to reconnect after 5 seconds
        reconnectTimeout = setTimeout(createWebSocket, 5000);
    }
}

// Initialize connection
function initialize() {
    songifyLog('Initializing background script');
    chrome.storage.local.get(['port'], (result) => {
        if (chrome.runtime.lastError || !isExtensionValid) return;
        
        if (result.port) {
            port = result.port;
            songifyLog(`Using saved port: ${port}`);
        } else {
            songifyLog(`Using default port: ${port}`);
        }
        createWebSocket();
    });
}

// Handle messages
function handleMessage(message, sender, sendResponse) {
    if (!isExtensionValid) {
        sendResponse({ success: false, error: 'Extension context invalid' });
        return false;
    }

    if (message.type === 'CHECK_CONNECTION') {
        songifyLog('Connection check requested');
        sendResponse({ 
            isConnected: websocket && websocket.readyState === WebSocket.OPEN,
            isValid: isExtensionValid
        });
        return false;
    }
    
    if (message.type === 'RECONNECT_WEBSOCKET') {
        if (message.port) {
            port = message.port;
        }
        songifyLog(`Reconnecting WebSocket with port ${port}`);
        createWebSocket();
        sendResponse({ success: true });
        return false;
    }
    
    if (message.type === 'VIDEO_INFO' && websocket && websocket.readyState === WebSocket.OPEN) {
        try {
            songifyLog('Sending video info to WebSocket:', message.data);
            websocket.send(JSON.stringify(message.data));
            sendResponse({ success: true });
        } catch (error) {
            songifyError('Error sending to WebSocket:', error);
            sendResponse({ success: false, error: error.message });
        }
    } else if (message.type === 'VIDEO_INFO') {
        songifyLog('WebSocket not ready, cannot send video info');
        sendResponse({ success: false, error: 'WebSocket not ready' });
    }
    
    return false;
}

// Handle extension invalidation
chrome.runtime.onSuspend.addListener(() => {
    songifyLog('Extension being suspended');
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