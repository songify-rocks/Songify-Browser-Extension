document.addEventListener('DOMContentLoaded', () => {
    const portInput = document.getElementById('port');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const filterTermInput = document.getElementById('filterTerm');
    const addTermButton = document.getElementById('addTerm');
    const filterTermsList = document.getElementById('filterTermsList');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const originalTitleElement = document.getElementById('originalTitle');
    const filteredTitleElement = document.getElementById('filteredTitle');
    const channelNameElement = document.getElementById('channelName');
    
    // Current video data
    let currentVideoData = {
        originalTitle: null,
        filteredTitle: null,
        channel: null
    };
    
    // Tab functionality
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active tab content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');
            
            // Refresh video data when switching to filters tab
            if (tabName === 'filters') {
                requestVideoData();
            }
        });
    });

    // Function to request current video data from the active tab
    function requestVideoData() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url && (tabs[0].url.includes('youtube.com/watch') || tabs[0].url.includes('music.youtube.com'))) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_INFO' }, (response) => {
                    if (chrome.runtime.lastError) {
                        updatePreviewSection(null);
                        return;
                    }
                    
                    if (response && response.data) {
                        updatePreviewSection(response.data);
                    }
                });
            } else {
                // Not on a YouTube video page
                updatePreviewSection(null);
            }
        });
    }
    
    // Update the preview section with video data
    function updatePreviewSection(data) {
        if (data && data.originalTitle) {
            currentVideoData = data;
            originalTitleElement.textContent = data.originalTitle || 'Not available';
            filteredTitleElement.textContent = data.filteredTitle || 'Not available';
            channelNameElement.textContent = data.channel || 'Not available';
            
            // Add information about the source (YouTube or YouTube Music)
            const previewContainer = document.querySelector('.preview-container');
            
            // Remove existing source label if it exists
            const existingSource = document.getElementById('source-label');
            if (existingSource) {
                existingSource.remove();
            }
            
            // Create a source label
            const sourceLabel = document.createElement('div');
            sourceLabel.id = 'source-label';
            sourceLabel.className = 'preview-row';
            
            const sourceTitle = document.createElement('span');
            sourceTitle.className = 'preview-label';
            sourceTitle.textContent = 'Source:';
            
            const sourceValue = document.createElement('span');
            sourceValue.className = 'preview-value';
            
            // Check if we got data from YouTube Music
            const isYouTubeMusic = data.artistName || data.songTitle || (data.source && data.source === 'youtube_music');
            if (isYouTubeMusic) {
                sourceValue.textContent = 'YouTube Music';
                sourceValue.style.color = '#FF0000'; // Red color for YouTube Music
            } else {
                sourceValue.textContent = 'YouTube';
            }
            
            sourceLabel.appendChild(sourceTitle);
            sourceLabel.appendChild(sourceValue);
            previewContainer.appendChild(sourceLabel);
            
            document.getElementById('previewSection').style.display = 'block';
        } else {
            originalTitleElement.textContent = 'No YouTube video detected';
            filteredTitleElement.textContent = 'No YouTube video detected';
            channelNameElement.textContent = 'No YouTube video detected';
            
            // Add debug information about current tab
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs && tabs[0]) {
                    const url = tabs[0].url;
                    
                    // Create debug info section
                    const previewContainer = document.querySelector('.preview-container');
                    
                    const debugInfo = document.createElement('div');
                    debugInfo.className = 'preview-row';
                    debugInfo.style.marginTop = '10px';
                    
                    const debugTitle = document.createElement('span');
                    debugTitle.className = 'preview-label';
                    debugTitle.textContent = 'Current URL:';
                    
                    const debugValue = document.createElement('span');
                    debugValue.className = 'preview-value';
                    debugValue.textContent = url;
                    
                    debugInfo.appendChild(debugTitle);
                    debugInfo.appendChild(debugValue);
                    
                    // Remove existing debug info if it exists
                    const existingDebug = document.getElementById('debug-info');
                    if (existingDebug) {
                        existingDebug.remove();
                    }
                    
                    debugInfo.id = 'debug-info';
                    previewContainer.appendChild(debugInfo);
                    
                    // Add detection information
                    const detectionInfo = document.createElement('div');
                    detectionInfo.className = 'preview-row';
                    
                    const detectionTitle = document.createElement('span');
                    detectionTitle.className = 'preview-label';
                    detectionTitle.textContent = 'Detected as:';
                    
                    const detectionValue = document.createElement('span');
                    detectionValue.className = 'preview-value';
                    
                    if (url.includes('music.youtube.com')) {
                        detectionValue.textContent = 'YouTube Music (Not getting data!)';
                        detectionValue.style.color = '#FF0000';
                    } else if (url.includes('youtube.com/watch')) {
                        detectionValue.textContent = 'YouTube Video';
                    } else {
                        detectionValue.textContent = 'Not a YouTube page';
                    }
                    
                    detectionInfo.appendChild(detectionTitle);
                    detectionInfo.appendChild(detectionValue);
                    
                    // Remove existing detection info if it exists
                    const existingDetection = document.getElementById('detection-info');
                    if (existingDetection) {
                        existingDetection.remove();
                    }
                    
                    detectionInfo.id = 'detection-info';
                    previewContainer.appendChild(detectionInfo);
                }
            });
        }
    }

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
    
    // Load saved filter terms and display them
    function loadFilterTerms() {
        chrome.storage.local.get(['filterTerms'], (result) => {
            const terms = result.filterTerms || [];
            renderFilterTerms(terms);
            
            // Refresh video data when terms change
            requestVideoData();
        });
    }
    
    // Render the filter terms list
    function renderFilterTerms(terms) {
        filterTermsList.innerHTML = '';
        
        if (terms.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.textContent = 'No filter terms added yet';
            emptyMessage.style.color = 'var(--songify-grey)';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.fontSize = '13px';
            filterTermsList.appendChild(emptyMessage);
            return;
        }
        
        terms.forEach((term, index) => {
            const termItem = document.createElement('div');
            termItem.className = 'filter-term-item';
            
            const termText = document.createElement('span');
            termText.className = 'filter-term-text';
            termText.textContent = term;
            
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-term';
            removeButton.textContent = '×';
            removeButton.setAttribute('data-index', index);
            removeButton.addEventListener('click', function() {
                removeTerm(index);
            });
            
            termItem.appendChild(termText);
            termItem.appendChild(removeButton);
            filterTermsList.appendChild(termItem);
        });
    }
    
    // Add a new term to the list
    function addTerm() {
        const term = filterTermInput.value.trim();
        
        if (!term) {
            showStatus('Please enter a term to filter', true);
            return;
        }
        
        // Special handling for [*] wildcard
        if (term === "[*]") {
            handleBracketWildcard();
            return;
        }
        
        chrome.storage.local.get(['filterTerms'], (result) => {
            const terms = result.filterTerms || [];
            
            // Check if term already exists
            if (terms.includes(term)) {
                showStatus('This term is already in the list', true);
                return;
            }
            
            // Add the new term
            terms.push(term);
            
            // Save updated terms
            chrome.storage.local.set({ filterTerms: terms }, () => {
                filterTermInput.value = '';
                renderFilterTerms(terms);
                
                // Show special message for pattern filters
                const isSpecialPattern = term === "(*)" || term === "{*}";
                
                if (isSpecialPattern) {
                    showStatus(`Special pattern added! This will remove all content inside ${term.charAt(0)}...${term.charAt(2)}`);
                    
                    // Force reload of content script to ensure filter is applied immediately
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0] && tabs[0].url && (tabs[0].url.includes('youtube.com/watch') || tabs[0].url.includes('music.youtube.com'))) {
                            chrome.tabs.reload(tabs[0].id);
                        }
                    });
                } else {
                    showStatus('Term added successfully');
                }
                
                // Request updated video data with a longer delay for special patterns
                setTimeout(requestVideoData, isSpecialPattern ? 1500 : 500);
            });
        });
    }
    
    // Special handler for [*] wildcard since it's not working properly through normal filters
    function handleBracketWildcard() {
        showStatus('Adding bracket wildcard...');
        
        // First get the current video title
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url && (tabs[0].url.includes('youtube.com/watch') || tabs[0].url.includes('music.youtube.com'))) {
                // Add [*] to the filter terms to show it's active
                chrome.storage.local.get(['filterTerms'], (result) => {
                    const terms = result.filterTerms || [];
                    
                    // Only add if it's not already there
                    if (!terms.includes('[*]')) {
                        terms.push('[*]');
                        chrome.storage.local.set({ filterTerms: terms }, () => {
                            filterTermInput.value = '';
                            renderFilterTerms(terms);
                            showStatus('Bracket wildcard added! Reloading page...');
                            
                            // Reload the page to apply the filter
                            chrome.tabs.reload(tabs[0].id);
                            
                            // Request updated video data
                            setTimeout(requestVideoData, 1500);
                        });
                    } else {
                        showStatus('Bracket wildcard already in filter list');
                    }
                });
            } else {
                showStatus('Please navigate to a YouTube video or YouTube Music page', true);
            }
        });
    }
    
    // Remove a term from the list
    function removeTerm(index) {
        chrome.storage.local.get(['filterTerms'], (result) => {
            const terms = result.filterTerms || [];
            
            // Check if we're removing a special pattern
            const isSpecialPattern = terms[index] === "[*]" || terms[index] === "(*)" || terms[index] === "{*}";
            
            // Remove the term at the specified index
            terms.splice(index, 1);
            
            // Save updated terms
            chrome.storage.local.set({ filterTerms: terms }, () => {
                renderFilterTerms(terms);
                showStatus('Term removed successfully');
                
                // If removing a special pattern, reload the page to ensure changes apply
                if (isSpecialPattern) {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0] && tabs[0].url && (tabs[0].url.includes('youtube.com/watch') || tabs[0].url.includes('music.youtube.com'))) {
                            chrome.tabs.reload(tabs[0].id);
                        }
                    });
                }
                
                // Request updated video data with a longer delay for special patterns
                setTimeout(requestVideoData, isSpecialPattern ? 1500 : 500);
            });
        });
    }
    
    // Add term when button is clicked
    addTermButton.addEventListener('click', addTerm);

    // Add term when Enter key is pressed in the input
    filterTermInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTerm();
        }
    });

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
        } else if (message.type === 'VIDEO_INFO_UPDATE') {
            updatePreviewSection(message.data);
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
    
    // Check video data periodically when filters tab is active
    const videoDataInterval = setInterval(() => {
        if (document.getElementById('tab-filters').classList.contains('active')) {
            requestVideoData();
        }
    }, 5000);

    // Cleanup
    window.addEventListener('unload', () => {
        clearInterval(connectionCheckInterval);
        clearInterval(videoDataInterval);
    });

    // Initial connection check
    checkConnection();
    
    // Load filter terms
    loadFilterTerms();
    
    // Initial video data request
    requestVideoData();
}); 