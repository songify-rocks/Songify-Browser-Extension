document.addEventListener('DOMContentLoaded', () => {
    const portInput = document.getElementById('port');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');

    function showStatus(message, isError = false) {
        statusDiv.textContent = message;
        statusDiv.style.display = 'block';
        statusDiv.className = `status ${isError ? 'error' : 'success'}`;
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }

    function updateConnectionStatus(isConnected, isValid = true) {
        if (!isValid) {
            statusIndicator.className = 'status-indicator disconnected';
            statusText.textContent = 'Extension needs reload';
            showStatus('Extension needs to be reloaded', true);
            return;
        }
        statusIndicator.className = `status-indicator ${isConnected ? 'connected' : 'disconnected'}`;
        statusText.textContent = isConnected ? 'Connected to Songify' : 'Not connected';
    }

    function checkConnection() {
        chrome.runtime.sendMessage({ type: 'CHECK_CONNECTION' }, (response) => {
            if (chrome.runtime.lastError) {
                updateConnectionStatus(false, false);
                return;
            }
            updateConnectionStatus(response?.isConnected || false, response?.isValid !== false);
        });
    }

    // Load saved port
    chrome.storage.local.get(['websocketPort'], (result) => {
        if (chrome.runtime.lastError) {
            showStatus('Failed to load settings', true);
            return;
        }
        if (result.websocketPort) {
            portInput.value = result.websocketPort;
        }
        checkConnection();
    });

    // Listen for connection status updates
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'CONNECTION_STATUS') {
            updateConnectionStatus(message.isConnected);
        }
    });

    saveButton.addEventListener('click', () => {
        const port = parseInt(portInput.value);
        
        if (port && port >= 1 && port <= 65535) {
            chrome.storage.local.set({ websocketPort: port }, () => {
                if (chrome.runtime.lastError) {
                    showStatus('Failed to save port', true);
                    return;
                }
                showStatus('Port saved successfully!');
                setTimeout(checkConnection, 1000);
            });
        } else {
            showStatus('Please enter a valid port number (1-65535)', true);
        }
    });

    // Check connection status periodically
    const connectionCheckInterval = setInterval(checkConnection, 5000);

    // Cleanup
    window.addEventListener('unload', () => {
        clearInterval(connectionCheckInterval);
    });

    // Initial connection check
    checkConnection();
}); 