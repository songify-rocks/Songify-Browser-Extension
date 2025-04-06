document.addEventListener('DOMContentLoaded', () => {
    const portInput = document.getElementById('port');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const filterTermInput = document.getElementById('filterTerm');
    const addTermButton = document.getElementById('addTerm');
    const filterTermsList = document.getElementById('filterTermsList');
    const originalTitleElement = document.getElementById('originalTitle');
    const filteredTitleElement = document.getElementById('filteredTitle');
    const channelNameElement = document.getElementById('channelName');
    const enableLoggingToggle = document.getElementById('enableLogging');
    const manualFixButton = document.getElementById('manualFix');
    
    // Current video data
    let currentVideoData = {
        originalTitle: null,
        filteredTitle: null,
        channel: null
    };
    
    // Track the current URL to help with source detection
    let currentTabUrl = '';
    
    // Main tab functionality
    const mainTabButtons = document.querySelectorAll('.tab-button');
    const mainTabContents = document.querySelectorAll('.tab-content');
    
    mainTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            // Update active tab button
            mainTabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active tab content
            mainTabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');
            
            // Refresh video data when switching to Now Playing tab
            if (tabName === 'now-playing') {
                requestVideoData();
            }
        });
    });

    // Settings subtab functionality
    const subtabButtons = document.querySelectorAll('.subtab-button');
    const subtabContents = document.querySelectorAll('.subtab-content');
    
    subtabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const subtabName = button.getAttribute('data-subtab');
            
            // Update active subtab button
            subtabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active subtab content
            subtabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`subtab-${subtabName}`).classList.add('active');
        });
    });

    // Function to request current video data from the active tab
    function requestVideoData() {
        // First check if we have data in storage
        chrome.storage.local.get(['currentVideoData'], (result) => {
            if (result.currentVideoData && result.currentVideoData.timestamp) {
                // Check if the data is still fresh (less than 30 seconds old)
                const now = Date.now();
                const dataAge = now - result.currentVideoData.timestamp;
                
                if (dataAge < 30000) {
                    console.log('Using stored video data from storage (age:', dataAge, 'ms)');
                    updatePreviewSection({
                        originalTitle: result.currentVideoData.originalTitle,
                        filteredTitle: result.currentVideoData.filteredTitle,
                        channel: result.currentVideoData.channel,
                        source: result.currentVideoData.source
                    });
                    
                    // Still request fresh data, but don't wait for it to update the UI
                    requestFreshVideoData(false);
                    return;
                } else {
                    console.log('Stored video data is stale (age:', dataAge, 'ms), requesting fresh data');
                }
            } else {
                console.log('No stored video data, requesting fresh data');
            }
            
            // If we don't have stored data or it's stale, request fresh data
            requestFreshVideoData(true);
        });
    }

    // Function to request fresh video data from content script
    function requestFreshVideoData(updateUI = true) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url) {
                // Store the current URL for source detection
                currentTabUrl = tabs[0].url;
                
                if (tabs[0].url.includes('youtube.com/watch') || tabs[0].url.includes('music.youtube.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_INFO' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('Error getting video info:', chrome.runtime.lastError);
                            if (updateUI) updatePreviewSection(null);
                            return;
                        }
                        
                        if (response && response.data) {
                            console.log('Received fresh video data:', response.data);
                            if (updateUI) updatePreviewSection(response.data);
                        } else if (updateUI) {
                            updatePreviewSection(null);
                        }
                    });
                } else if (updateUI) {
                    // Not on a YouTube video page
                    updatePreviewSection(null);
                }
            } else if (updateUI) {
                // No active tab or no URL
                updatePreviewSection(null);
            }
        });
    }

    // Update the preview section with video data
    function updatePreviewSection(data) {
        console.log('Updating preview section with data:', data);
        
        if (data && data.originalTitle) {
            currentVideoData = data;
            originalTitleElement.textContent = data.originalTitle || 'Not available';
            filteredTitleElement.textContent = data.filteredTitle || 'Not available';
            channelNameElement.textContent = data.channel || 'Not available';
            
            // Store this data in localStorage as a backup
            const storageData = {
                ...data,
                timestamp: Date.now()
            };
            chrome.storage.local.set({ popupVideoData: storageData });
            
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
            sourceValue.className = 'preview-value source-logo-container';
            
            // Check if we got data from YouTube Music by examining data properties 
            // or by checking if the current URL is from YouTube Music
            const isYouTubeMusic = data.artistName || 
                                   data.songTitle || 
                                   (data.source && data.source === 'youtube_music') ||
                                   currentTabUrl.includes('music.youtube.com');
                                   
            const isAmazonMusic = (data.source && data.source === 'amazon_music') ||
                                 currentTabUrl.includes('music.amazon');
            
            // Create logo element
            const logoImg = document.createElement('img');
            logoImg.className = 'source-logo';
            
            if (isAmazonMusic) {
                logoImg.src = 'icons/amazon-music-logo.png';
                logoImg.alt = 'Amazon Music';
                logoImg.title = 'Amazon Music';
            } else if (isYouTubeMusic) {
                logoImg.src = 'icons/youtube-music-logo.png';
                logoImg.alt = 'YouTube Music';
                logoImg.title = 'YouTube Music';
            } else {
                logoImg.src = 'icons/youtube-logo.png';
                logoImg.alt = 'YouTube';
                logoImg.title = 'YouTube';
            }
            
            sourceValue.appendChild(logoImg);
            sourceLabel.appendChild(sourceTitle);
            sourceLabel.appendChild(sourceValue);
            previewContainer.appendChild(sourceLabel);
            
            document.getElementById('previewSection').style.display = 'block';
            
            // Enable manual fix button for potential future use
            // manualFixButton.style.display = 'block';
        } else {
            // Try to get backup data from localStorage
            chrome.storage.local.get(['popupVideoData'], (result) => {
                if (result.popupVideoData) {
                    console.log('Using backup data from popupVideoData');
                    originalTitleElement.textContent = result.popupVideoData.originalTitle || 'Not available';
                    filteredTitleElement.textContent = result.popupVideoData.filteredTitle || 'Not available';
                    channelNameElement.textContent = result.popupVideoData.channel || 'Not available';
                } else {
                    originalTitleElement.textContent = 'Not available';
                    filteredTitleElement.textContent = 'Not available';
                    channelNameElement.textContent = 'Not available';
                }
            });
            
            // Hide manual fix button
            manualFixButton.style.display = 'none';
            
            // Add debug information about current tab
            const previewContainer = document.querySelector('.preview-container');
            
            // Create debug info section
            const debugInfo = document.createElement('div');
            debugInfo.className = 'preview-row';
            debugInfo.style.marginTop = '10px';
            
            const debugTitle = document.createElement('span');
            debugTitle.className = 'preview-label';
            debugTitle.textContent = 'Current URL:';
            
            const debugValue = document.createElement('span');
            debugValue.className = 'preview-value';
            debugValue.textContent = currentTabUrl || 'No URL detected';
            
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
            detectionValue.className = 'preview-value source-logo-container';
            
            // Create logo element with appropriate status indication
            const logoImg = document.createElement('img');
            logoImg.className = 'source-logo';
            
            const logoStatusIndicator = document.createElement('span');
            logoStatusIndicator.className = 'logo-status-indicator';
            
            if (currentTabUrl.includes('music.amazon')) {
                logoImg.src = 'icons/amazon-music-logo.png';
                logoImg.alt = 'Amazon Music';
                logoImg.title = 'Amazon Music';
                logoStatusIndicator.textContent = 'Not getting data!';
                logoStatusIndicator.style.color = '#FF0000';
            } else if (currentTabUrl.includes('music.youtube.com')) {
                logoImg.src = 'icons/youtube-music-logo.png';
                logoImg.alt = 'YouTube Music';
                logoImg.title = 'YouTube Music';
                logoStatusIndicator.textContent = 'Not getting data!';
                logoStatusIndicator.style.color = '#FF0000';
            } else if (currentTabUrl.includes('youtube.com/watch')) {
                logoImg.src = 'icons/youtube-logo.png';
                logoImg.alt = 'YouTube';
                logoImg.title = 'YouTube';
                logoStatusIndicator.textContent = 'Video detected';
            } else {
                detectionValue.textContent = 'Not a supported page';
            }
            
            // Only add the logo if it's a supported page
            if (currentTabUrl.includes('youtube.com') || currentTabUrl.includes('music.amazon')) {
                detectionValue.appendChild(logoImg);
                detectionValue.appendChild(logoStatusIndicator);
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
        statusText.textContent = isConnected ? 'Connected to Songify' : 'Not connected to Songify';
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

    // Load the port setting
    chrome.storage.local.get(['port', 'enableLogging'], (result) => {
        if (result.port) {
            portInput.value = result.port;
        }
        
        // Set the logging toggle state
        enableLoggingToggle.checked = result.enableLogging === true;
    });

    // Save the port setting
    saveButton.addEventListener('click', () => {
        const port = portInput.value.trim();
        chrome.storage.local.set({ port }, () => {
            showStatus('Settings saved successfully!');
            
            // Notify background script to reconnect with new port
            chrome.runtime.sendMessage({ type: 'RECONNECT_WEBSOCKET', port });
        });
    });
    
    // Toggle debug logging
    enableLoggingToggle.addEventListener('change', () => {
        const enableLogging = enableLoggingToggle.checked;
        chrome.storage.local.set({ enableLogging }, () => {
            showStatus(`Debug logging ${enableLogging ? 'enabled' : 'disabled'}`);
            
            // Notify all parts of the extension about the logging change
            chrome.runtime.sendMessage({ 
                type: 'LOGGING_STATE_CHANGED', 
                enableLogging 
            });
        });
    });

    // Handle manual fix button (for future use)
    if (manualFixButton) {
        manualFixButton.addEventListener('click', () => {
            // Placeholder for future manual title editing feature
            showStatus('Manual editing feature coming soon!');
        });
    }

    // Listen for connection status updates
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'CONNECTION_STATUS') {
            updateConnectionStatus(message.isConnected);
        } else if (message.type === 'VIDEO_INFO_UPDATE') {
            console.log('Received VIDEO_INFO_UPDATE:', message.data);
            
            // Store the updated data
            if (message.data) {
                const storageData = {
                    ...message.data,
                    timestamp: Date.now()
                };
                chrome.storage.local.set({ 
                    currentVideoData: storageData,
                    popupVideoData: storageData 
                }, () => {
                    console.log('Stored updated video data in storage');
                    
                    // Update the UI immediately if we're in the popup
                    if (document.getElementById('tab-now-playing').classList.contains('active')) {
                        updatePreviewSection(message.data);
                    }
                });
            }
        }
    });

    // Check connection status periodically
    const connectionCheckInterval = setInterval(checkConnection, 5000);
    
    // Check video data periodically when Now Playing tab is active
    const videoDataInterval = setInterval(() => {
        if (document.getElementById('tab-now-playing').classList.contains('active')) {
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