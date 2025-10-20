// Enhanced audio-handler.js with search functionality
class AudioHandler {
    constructor() {
        this.currentAudio = null;
        this.currentLink = null;
        this.currentMetadataDiv = null;
        // In-memory cache for metadata
        this.metadataCache = new Map();
        // Search functionality
        this.allLinks = [];
        this.searchIndex = new Map();
        this.isSearchActive = false;
        // Store the original page title to restore later
        this.originalPageTitle = document.title;
        // Sticky player
        this.stickyPlayerContainer = null;
        this.currentPlaylist = []; // Track visible songs at time of play
        this.currentTrackIndex = -1; // Current position in playlist
    }

    // Initialize pages with search functionality
    initializePage() {
        this.createStickyPlayer();
        this.setupSearchBar();
        this.indexAllLinks();
        this.setupClickHandlers();
        this.setupFolderNavigation();
        this.restorePlayerState();

        // Load all files for search if we're on the local music endpoint (not B2)
        // Root is "/" and subdirectories are "/?dir=something"
        const isLocalEndpoint = window.location.pathname === '/' &&
                               !window.location.pathname.includes('/analog') &&
                               !window.location.pathname.includes('/live');

        if (isLocalEndpoint) {
            this.loadAllFilesForSearch();
        }

        // DON'T preload metadata for B2 pages - only index filenames
        // Metadata will be loaded on-demand when songs are played
    }

    // Load all files from all folders for comprehensive search
    async loadAllFilesForSearch() {
        try {
            const response = await fetch('/api/all-files');
            const data = await response.json();

            if (data.success && data.files) {
                console.log(`Loaded ${data.files.length} files for search across all folders`);
                this.allFilesData = data.files;
                // Index these files for search
                this.indexAllFiles(data.files);
            }
        } catch (error) {
            console.error('Failed to load all files for search:', error);
        }
    }

    // Index all files from all folders for search
    indexAllFiles(filesData) {
        filesData.forEach((fileInfo, index) => {
            const searchData = {
                filename: fileInfo.fileName,
                folder: fileInfo.folderPath || '',
                combined: `${fileInfo.fileName} ${fileInfo.folderPath || ''}`
            };

            this.searchIndex.set(`all-file-${index}`, {
                fileInfo: fileInfo,
                searchText: searchData.combined.toLowerCase(),
                data: searchData,
                type: 'all-file'
            });
        });

        console.log(`Indexed ${filesData.length} files from all folders for search`);
    }

    // Setup folder navigation to avoid page reloads when player is active
    setupFolderNavigation() {
        document.addEventListener('click', (e) => {
            const folderLink = e.target.closest('.folder-link, .breadcrumb-link');
            if (!folderLink) return;

            const href = folderLink.getAttribute('href');
            if (!href) return;

            // Check if we're crossing endpoints (e.g., / -> /analog, or /analog -> /)
            const currentEndpoint = this.getCurrentEndpoint();
            const targetEndpoint = this.getEndpointFromHref(href);

            if (currentEndpoint !== targetEndpoint) {
                // Crossing endpoints - stop player and allow normal navigation
                if (this.currentAudio) {
                    this.hideStickyPlayer();
                    this.clearPlayerState();
                    if (this.currentAudio) {
                        this.currentAudio.pause();
                        this.currentAudio.removeAttribute('src');
                        this.currentAudio.load();
                    }
                    this.currentAudio = null;
                    this.currentLink = null;
                }
                // Allow normal page navigation
                return;
            }

            // Same endpoint - only intercept if audio is playing
            if (!this.currentAudio || this.currentAudio.paused) {
                return;
            }

            // Don't intercept if it's not a local music navigation
            if (!href.startsWith('/?') && href !== '/') return;

            e.preventDefault();

            // Save current scroll position
            const scrollPos = window.scrollY;

            // Fetch the new page content
            fetch(href)
                .then(response => response.text())
                .then(html => {
                    // Parse the HTML
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    // Update the container content
                    const newContainer = doc.querySelector('.container');
                    const currentContainer = document.querySelector('.container');
                    if (newContainer && currentContainer) {
                        currentContainer.innerHTML = newContainer.innerHTML;
                    }

                    // Update breadcrumb
                    const newBreadcrumb = doc.querySelector('.breadcrumb');
                    const currentBreadcrumb = document.querySelector('.breadcrumb');
                    if (newBreadcrumb && currentBreadcrumb) {
                        currentBreadcrumb.innerHTML = newBreadcrumb.innerHTML;
                    }

                    // Update page title (but not if audio is playing - that sets its own title)
                    if (!this.currentAudio || this.currentAudio.paused) {
                        document.title = doc.title;
                    }

                    // Update URL without reload
                    window.history.pushState({}, '', href);

                    // Update search bar if it exists in new content
                    const newSearchContainer = doc.querySelector('.search-container');
                    const currentSearchContainer = document.querySelector('.search-container');
                    if (newSearchContainer && currentSearchContainer) {
                        currentSearchContainer.innerHTML = newSearchContainer.innerHTML;
                        this.attachSearchListeners();
                    }

                    // Re-index the new links
                    this.indexAllLinks();

                    // Update playlist to new folder's songs
                    this.updatePlaylistToCurrentPage();

                    // Restore scroll position or scroll to top
                    window.scrollTo(0, 0);
                })
                .catch(error => {
                    console.error('Failed to load folder:', error);
                    // Fall back to regular navigation
                    window.location.href = href;
                });
        });

        // Handle browser back/forward buttons
        window.addEventListener('popstate', () => {
            if (this.currentAudio && !this.currentAudio.paused) {
                // Reload content without full page refresh
                fetch(window.location.href)
                    .then(response => response.text())
                    .then(html => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');

                        const newContainer = doc.querySelector('.container');
                        const currentContainer = document.querySelector('.container');
                        if (newContainer && currentContainer) {
                            currentContainer.innerHTML = newContainer.innerHTML;
                        }

                        const newBreadcrumb = doc.querySelector('.breadcrumb');
                        const currentBreadcrumb = document.querySelector('.breadcrumb');
                        if (newBreadcrumb && currentBreadcrumb) {
                            currentBreadcrumb.innerHTML = newBreadcrumb.innerHTML;
                        }

                        const newSearchContainer = doc.querySelector('.search-container');
                        const currentSearchContainer = document.querySelector('.search-container');
                        if (newSearchContainer && currentSearchContainer) {
                            currentSearchContainer.innerHTML = newSearchContainer.innerHTML;
                            this.attachSearchListeners();
                        }

                        this.indexAllLinks();
                        this.updatePlaylistToCurrentPage();
                    });
            }
        });
    }

    // Get the current endpoint (root, analog, or live)
    getCurrentEndpoint() {
        const path = window.location.pathname;
        if (path === '/' || path.startsWith('/?')) {
            return 'root';
        } else if (path.includes('/analog')) {
            return 'analog';
        } else if (path.includes('/live')) {
            return 'live';
        }
        return 'root';
    }

    // Get the endpoint from a href
    getEndpointFromHref(href) {
        if (href.startsWith('/analog')) {
            return 'analog';
        } else if (href.startsWith('/live')) {
            return 'live';
        } else if (href === '/' || href.startsWith('/?')) {
            return 'root';
        }
        return 'root';
    }

    // Update playlist to match current page without changing playback
    updatePlaylistToCurrentPage() {
        const visibleLinks = Array.from(document.querySelectorAll('.link')).filter(link => {
            const songRow = link.closest('.song-row');
            if (songRow) {
                return !songRow.classList.contains('search-hidden');
            }
            return !link.classList.contains('search-hidden');
        });

        this.currentPlaylist = visibleLinks;

        // Find if the currently playing track is on this page
        if (this.currentLink) {
            const currentLinkOnPage = visibleLinks.find(link => {
                if (this.currentLink.dataset.audioType === 'local') {
                    return link.dataset.relativePath === this.currentLink.dataset.relativePath;
                } else {
                    return link.dataset.filename === this.currentLink.dataset.filename &&
                           link.dataset.folder === this.currentLink.dataset.folder;
                }
            });

            if (currentLinkOnPage) {
                this.currentTrackIndex = visibleLinks.indexOf(currentLinkOnPage);
            } else {
                // Current track not on this page
                this.currentTrackIndex = -1;
            }
        }

        console.log(`Playlist updated to current page: ${visibleLinks.length} tracks, current at index ${this.currentTrackIndex}`);
        this.savePlayerState();
    }

    // Save player state to sessionStorage
    savePlayerState() {
        if (!this.currentAudio) return;

        const state = {
            audioSrc: this.currentAudio.src,
            currentTime: this.currentAudio.currentTime,
            playbackRate: this.currentAudio.playbackRate,
            isPlaying: !this.currentAudio.paused,
            playlist: this.currentPlaylist.map(link => ({
                audioType: link.dataset.audioType,
                relativePath: link.dataset.relativePath,
                proxyUrl: link.dataset.proxyUrl,
                filename: link.dataset.filename,
                folder: link.dataset.folder
            })),
            currentTrackIndex: this.currentTrackIndex,
            currentLinkData: this.currentLink ? {
                audioType: this.currentLink.dataset.audioType,
                relativePath: this.currentLink.dataset.relativePath,
                proxyUrl: this.currentLink.dataset.proxyUrl,
                filename: this.currentLink.dataset.filename,
                folder: this.currentLink.dataset.folder
            } : null,
            metadata: this._currentMetadata || null,
            metadataEndpoint: this._currentMetadataEndpoint || null,
            endpoint: this.getCurrentEndpoint()
        };

        sessionStorage.setItem('audioPlayerState', JSON.stringify(state));
    }

    // Restore player state from sessionStorage
    restorePlayerState() {
        const stateJson = sessionStorage.getItem('audioPlayerState');
        if (!stateJson) return;

        try {
            const state = JSON.parse(stateJson);

            // Check if we're on the same endpoint - if not, clear state
            const savedEndpoint = state.endpoint || 'root';
            const currentEndpoint = this.getCurrentEndpoint();

            if (savedEndpoint !== currentEndpoint) {
                console.log(`Endpoint changed from ${savedEndpoint} to ${currentEndpoint}, clearing player state`);
                this.clearPlayerState();
                return;
            }

            // Create audio element and restore playback first (without clicking any link)
            const audio = new Audio();
            audio.controls = true;
            audio.src = state.audioSrc;
            audio.currentTime = state.currentTime;
            audio.playbackRate = state.playbackRate;

            // Create metadata display from saved state
            const metadataDiv = this.createMetadataDiv();

            // Create speed control
            const speedControlDiv = this.createSpeedControl(audio);

            // Setup event listeners
            audio.addEventListener('play', () => this.savePlayerState());
            audio.addEventListener('pause', () => this.savePlayerState());
            audio.addEventListener('timeupdate', () => {
                if (!this._lastSaveTime || Date.now() - this._lastSaveTime > 2000) {
                    this.savePlayerState();
                    this._lastSaveTime = Date.now();
                }
            });
            audio.addEventListener('ratechange', () => this.savePlayerState());
            audio.addEventListener('ended', () => {
                this.playNextTrack();
            });

            // Add to sticky player
            const container = document.createElement('div');
            container.appendChild(metadataDiv);
            const audioWrapper = document.createElement('div');
            audioWrapper.className = 'audio-player-wrapper';
            audioWrapper.appendChild(audio);
            audioWrapper.appendChild(speedControlDiv);
            container.appendChild(audioWrapper);

            this.stickyPlayerContainer.appendChild(container);
            this.showStickyPlayer();

            this.currentAudio = audio;
            this.currentMetadataDiv = container;

            // Display saved metadata
            if (state.metadata) {
                this.displayMetadata(metadataDiv, state.metadata, state.metadataEndpoint);
            }

            // Update playlist to current page's songs
            const visibleLinks = Array.from(document.querySelectorAll('.link')).filter(link => {
                const songRow = link.closest('.song-row');
                if (songRow) {
                    return !songRow.classList.contains('search-hidden');
                }
                return !link.classList.contains('search-hidden');
            });

            this.currentPlaylist = visibleLinks;

            // Find if the currently playing track is on this page
            const currentLinkOnPage = visibleLinks.find(link => {
                if (state.currentLinkData.audioType === 'local') {
                    return link.dataset.relativePath === state.currentLinkData.relativePath;
                } else {
                    return link.dataset.filename === state.currentLinkData.filename &&
                           link.dataset.folder === state.currentLinkData.folder;
                }
            });

            if (currentLinkOnPage) {
                this.currentTrackIndex = visibleLinks.indexOf(currentLinkOnPage);
                this.currentLink = currentLinkOnPage;
            } else {
                // Current track not on this page, when it ends, start from beginning of new page
                this.currentTrackIndex = -1;
                this.currentLink = null;
            }

            console.log(`Player restored: ${visibleLinks.length} tracks in new playlist, current track at index ${this.currentTrackIndex}`);

            // Resume playback if it was playing
            if (state.isPlaying) {
                audio.play().catch(e => {
                    console.log('Auto-play prevented, user must interact first');
                });
            }

        } catch (error) {
            console.error('Failed to restore player state:', error);
            sessionStorage.removeItem('audioPlayerState');
        }
    }

    // Clear player state
    clearPlayerState() {
        sessionStorage.removeItem('audioPlayerState');
    }

    // Create the sticky audio player container
    createStickyPlayer() {
        if (this.stickyPlayerContainer) return; // Already created

        const playerContainer = document.createElement('div');
        playerContainer.id = 'sticky-audio-player';
        playerContainer.className = 'sticky-audio-player hidden';
        document.body.appendChild(playerContainer);
        this.stickyPlayerContainer = playerContainer;
    }

    // Show the sticky player
    showStickyPlayer() {
        if (this.stickyPlayerContainer) {
            this.stickyPlayerContainer.classList.remove('hidden');
            document.body.classList.add('player-active');
        }
    }

    // Hide the sticky player
    hideStickyPlayer() {
        if (this.stickyPlayerContainer) {
            this.stickyPlayerContainer.classList.add('hidden');
            document.body.classList.remove('player-active');
        }
    }

    // Setup click handlers for audio links
    setupClickHandlers() {
        const container = document.querySelector('.container');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const link = e.target.closest('.link');
            if (!link) return;

            e.preventDefault();

            const audioType = link.dataset.audioType;
            const relativePath = link.dataset.relativePath;

            if (audioType === 'local' && relativePath) {
                // Encode each path component to handle special characters like # and '
                const encodedPath = relativePath.split('/').map(part => encodeURIComponent(part)).join('/');
                this.playAudio(`music/${encodedPath}`, link, 'local');
            } else if (audioType === 'b2') {
                const proxyUrl = link.dataset.proxyUrl;
                if (proxyUrl) {
                    this.playAudio(proxyUrl, link, 'b2');
                }
            }
        });
    }

    // Setup search bar HTML and functionality
    setupSearchBar() {
        const container = document.querySelector('.container');
        if (!container) return;

        // Determine if we're on the local files page (root endpoint)
        const isLocalPage = window.location.pathname === '/';
        const rescanButton = isLocalPage ? '<button class="rescan-button" id="rescanButton">🔄 Rescan</button>' : '';

        const searchHTML = `
            <div class="search-container">
                <div class="search-bar">
                    <div style="position: relative; flex: 1;">
                        <input type="text"
                               class="search-input"
                               id="musicSearch"
                               placeholder="Search songs, artists, albums, or filenames..."
                               autocomplete="off">
                        <span class="search-icon">🔍</span>
                    </div>
                    <button class="clear-search" id="clearSearch" style="display: none;">Clear</button>
                    ${rescanButton}
                    <div class="search-results-count" id="searchResults"></div>
                    <div class="search-loading" id="searchLoading">Searching...</div>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforebegin', searchHTML);
        this.attachSearchListeners();
    }

    // Attach search event listeners
    attachSearchListeners() {
        const searchInput = document.getElementById('musicSearch');
        const clearButton = document.getElementById('clearSearch');
        const rescanButton = document.getElementById('rescanButton');

        if (searchInput) {
            // Debounced search
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.performSearch(e.target.value);
                }, 150);
            });

            // Handle enter key
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.performSearch(e.target.value);
                }
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', () => {
                this.clearSearch();
            });
        }

        if (rescanButton) {
            rescanButton.addEventListener('click', async () => {
                await this.triggerRescan(rescanButton);
            });
        }
    }

    // Trigger rescan on the server
    async triggerRescan(button) {
        try {
            button.disabled = true;
            button.textContent = '⏳ Scanning...';

            const response = await fetch('/rescan');
            const result = await response.json();

            if (result.success) {
                button.textContent = '✓ Complete!';
                setTimeout(() => {
                    // Reload the page to show new files
                    window.location.reload();
                }, 800);
            } else {
                button.textContent = '✗ Failed';
                setTimeout(() => {
                    button.textContent = '🔄 Rescan';
                    button.disabled = false;
                }, 2000);
            }
        } catch (error) {
            console.error('Rescan failed:', error);
            button.textContent = '✗ Error';
            setTimeout(() => {
                button.textContent = '🔄 Rescan';
                button.disabled = false;
            }, 2000);
        }
    }

    // Index all links for searching (include folder links)
    indexAllLinks() {
        this.allLinks = Array.from(document.querySelectorAll('.link'));
        // Also include folder links in search
        this.folderLinks = Array.from(document.querySelectorAll('.folder-link'));

        // Clear only the current page links from search index, preserve all-file entries
        const keysToDelete = [];
        this.searchIndex.forEach((item, key) => {
            if (item.type !== 'all-file') {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.searchIndex.delete(key));

        // Index audio links
        this.allLinks.forEach((link, index) => {
            const searchData = this.extractSearchableData(link);
            const songRow = link.closest('.song-row');
            this.searchIndex.set(`link-${index}`, {
                link: link,
                songRow: songRow,
                searchText: searchData.combined.toLowerCase(),
                data: searchData,
                type: 'audio'
            });
        });

        // Index folder links
        this.folderLinks.forEach((link, index) => {
            const folderName = link.textContent.trim();
            const folderRow = link.closest('.folder-row');
            this.searchIndex.set(`folder-${index}`, {
                link: link,
                songRow: folderRow,
                searchText: folderName.toLowerCase(),
                data: { combined: folderName },
                type: 'folder'
            });
        });

        const totalItems = this.allLinks.length + this.folderLinks.length;
        this.updateResultsCount(totalItems, totalItems);
    }

    // Extract searchable data from a link
    extractSearchableData(link) {
        let filename = '';
        let artist = '';
        let album = '';
        let title = '';
        let folder = '';

        // Extract folder path from data attribute
        if (link.dataset && link.dataset.folder) {
            folder = link.dataset.folder;
        }

        // For B2 files with data attributes
        if (link.dataset && link.dataset.filename) {
            filename = link.dataset.filename;
        }

        // For LOCAL files (root endpoint) - extract from text content since metadata is already loaded
        const textContent = link.textContent.trim();
        if (link.dataset && link.dataset.artist) {
            // Local files have metadata in data attributes
            artist = link.dataset.artist || '';
            album = link.dataset.album || '';
            title = link.dataset.title || '';
        } else if (textContent) {
            // For B2 files, ONLY use filename - don't load metadata until played
            if (link.dataset && link.dataset.folder) {
                // This is a B2 file - only search by filename
                filename = link.dataset.filename || textContent;
                title = filename; // Use filename as title for search
            } else {
                // Try to parse local file text content if no data attributes
                const parts = textContent.split(/\s+/).filter(part => part.length > 0);
                if (parts.length >= 3) {
                    artist = parts[0] || '';
                    album = parts[1] || '';
                    title = parts.slice(2).join(' ') || '';
                } else {
                    title = textContent;
                }
            }
        }

        // If still no filename, try to extract from onclick
        if (!filename && link.getAttribute('onclick')) {
            const onclickMatch = link.getAttribute('onclick').match(/'([^']+)'/);
            if (onclickMatch) {
                filename = onclickMatch[1].split('/').pop().replace(/\.[^.]+$/, '');
            }
        }

        const combined = [filename, artist, album, title, folder].filter(Boolean).join(' ');

        return {
            filename,
            artist,
            album,
            title,
            folder,
            combined
        };
    }

    // Perform search with highlighting
    performSearch(query) {
        const searchLoading = document.getElementById('searchLoading');

        if (!query || query.trim().length === 0) {
            this.clearSearch();
            return;
        }

        if (searchLoading) {
            searchLoading.classList.add('active');
        }

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            this.isSearchActive = true;
            const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);
            let visibleCount = 0;
            const matchedAllFiles = [];

            this.searchIndex.forEach((item) => {
                const { link, searchText, type, fileInfo } = item;

                // Check if all search terms are found
                const matches = searchTerms.every(term => searchText.includes(term));

                if (type === 'all-file') {
                    // Handle all-file results separately
                    if (matches) {
                        matchedAllFiles.push(fileInfo);
                        visibleCount++;
                    }
                } else {
                    // Handle regular links (current page)
                    // Re-query for songRow at search time instead of using cached reference
                    const songRow = link ? link.closest('.song-row') : null;

                    if (matches) {
                        // Hide/show the parent song-row if it exists, otherwise hide the link
                        if (songRow) {
                            songRow.classList.remove('search-hidden');
                            // Also ensure the link itself doesn't have the class
                            if (link) link.classList.remove('search-hidden');
                        } else if (link) {
                            link.classList.remove('search-hidden');
                        }
                        if (link) this.highlightMatches(link, searchTerms);
                        visibleCount++;
                    } else {
                        if (songRow) {
                            songRow.classList.add('search-hidden');
                            // Also ensure the link itself doesn't have the class
                            if (link) link.classList.remove('search-hidden');
                        } else if (link) {
                            link.classList.add('search-hidden');
                        }
                    }
                }
            });

            // Add matched files from other folders to the DOM
            if (matchedAllFiles.length > 0) {
                this.displayAllFileResults(matchedAllFiles, searchTerms);
            } else {
                // Remove any previously added all-file results
                this.removeAllFileResults();
            }

            this.updateResultsCount(visibleCount, this.searchIndex.size);
            this.toggleClearButton(true);

            if (searchLoading) {
                searchLoading.classList.remove('active');
            }

            // Update playlist if audio is currently playing
            if (this.currentAudio && !this.currentAudio.paused) {
                this.updatePlaylistToCurrentPage();
            }
        }, 10);
    }

    // Display search results from all folders
    displayAllFileResults(matchedFiles, searchTerms) {
        // Remove any existing all-file results first
        this.removeAllFileResults();

        const container = document.querySelector('.container');
        if (!container) return;

        // Group files by folder
        const filesByFolder = new Map();
        matchedFiles.forEach(fileInfo => {
            const folder = fileInfo.folderPath || 'Root';
            if (!filesByFolder.has(folder)) {
                filesByFolder.set(folder, []);
            }
            filesByFolder.get(folder).push(fileInfo);
        });

        // Create a container for all-file results
        const resultsContainer = document.createElement('div');
        resultsContainer.id = 'all-files-search-results';
        resultsContainer.style.cssText = 'margin-top: 20px;';

        filesByFolder.forEach((files, folder) => {
            // Add folder header
            const folderHeader = document.createElement('div');
            folderHeader.className = 'search-folder-header';
            folderHeader.style.cssText = `
                background: linear-gradient(135deg, #2d2d2d, #1a1a1a);
                color: deepskyblue;
                padding: 8px 15px;
                margin: 15px 0 5px 0;
                border-radius: 5px;
                font-weight: 600;
                font-size: 14px;
                border-left: 4px solid lime;
            `;
            folderHeader.textContent = `📁 ${folder}`;
            resultsContainer.appendChild(folderHeader);

            // Add files from this folder
            files.forEach(fileInfo => {
                const songRow = document.createElement('div');
                songRow.className = 'song-row all-file-result';
                songRow.dataset.allFileResult = 'true';

                const link = document.createElement('a');
                link.className = 'link';
                link.dataset.filename = fileInfo.fileName;
                link.dataset.folder = fileInfo.folderPath || '';
                link.dataset.relativePath = fileInfo.relativePath;
                link.dataset.audioType = 'local';

                // Highlight matching terms
                let displayText = fileInfo.fileName;
                searchTerms.forEach(term => {
                    const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
                    displayText = displayText.replace(regex, '<span class="search-highlight">$1</span>');
                });

                link.innerHTML = displayText;

                songRow.appendChild(link);
                resultsContainer.appendChild(songRow);
            });
        });

        // Insert at the top of the container
        container.insertBefore(resultsContainer, container.firstChild);
    }

    // Remove all-file search results from DOM
    removeAllFileResults() {
        const existingResults = document.getElementById('all-files-search-results');
        if (existingResults) {
            existingResults.remove();
        }
    }

    // Highlight search terms in link content
    highlightMatches(link, searchTerms) {
        // Store original content if not already stored
        if (!link.dataset.originalContent) {
            link.dataset.originalContent = link.innerHTML;
        }

        let content = link.dataset.originalContent;

        // Highlight each search term
        searchTerms.forEach(term => {
            const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
            content = content.replace(regex, '<span class="search-highlight">$1</span>');
        });

        link.innerHTML = content;
    }

    // Remove search highlighting
    removeHighlighting() {
        this.allLinks.forEach(link => {
            if (link.dataset.originalContent) {
                link.innerHTML = link.dataset.originalContent;
                delete link.dataset.originalContent;
            }
        });

        if (this.folderLinks) {
            this.folderLinks.forEach(link => {
                if (link.dataset.originalContent) {
                    link.innerHTML = link.dataset.originalContent;
                    delete link.dataset.originalContent;
                }
            });
        }
    }

    // Clear search and show all items
    clearSearch() {
        const searchInput = document.getElementById('musicSearch');
        if (searchInput) {
            searchInput.value = '';
        }

        // Remove all-file search results
        this.removeAllFileResults();

        // Clear search-hidden from both links and their parent rows
        this.allLinks.forEach(link => {
            link.classList.remove('search-hidden');
            const songRow = link.closest('.song-row');
            if (songRow) {
                songRow.classList.remove('search-hidden');
            }
        });

        if (this.folderLinks) {
            this.folderLinks.forEach(link => {
                link.classList.remove('search-hidden');
                const folderRow = link.closest('.folder-row');
                if (folderRow) {
                    folderRow.classList.remove('search-hidden');
                }
            });
        }

        this.removeHighlighting();
        const totalItems = this.allLinks.length + (this.folderLinks ? this.folderLinks.length : 0);
        this.updateResultsCount(totalItems, totalItems);
        this.toggleClearButton(false);
        this.isSearchActive = false;

        // Update playlist if audio is currently playing
        if (this.currentAudio && !this.currentAudio.paused) {
            this.updatePlaylistToCurrentPage();
        }

        if (searchInput) {
            searchInput.focus();
        }
    }

    // Update search results count display
    updateResultsCount(visible, total) {
        const resultsElement = document.getElementById('searchResults');
        if (resultsElement) {
            if (visible === total) {
                resultsElement.textContent = `${total} items`;
            } else {
                resultsElement.textContent = `${visible} of ${total} items`;
            }
        }
    }

    // Toggle clear button visibility
    toggleClearButton(show) {
        const clearButton = document.getElementById('clearSearch');
        if (clearButton) {
            clearButton.style.display = show ? 'block' : 'none';
        }
    }

    // Escape regex special characters
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }


    // Update link display with metadata
    updateLinkDisplay(link, metadata) {
        const artwork = metadata.artwork ?
            `data:image/jpeg;base64,${metadata.artwork}` : '';

        if (artwork) {
            link.style.backgroundImage = `url('${artwork}')`;
        }

        // Store original content before updating
        if (!link.dataset.originalContent) {
            link.dataset.originalContent = link.innerHTML;
        }

        // Match the root page format: Artist Album Title
        const displayContent = `
            ${metadata.artist || 'Unknown Artist'}
            ${metadata.album || 'Unknown Album'}  
            ${metadata.title || link.dataset.filename}
        `;

        link.innerHTML = displayContent;
        link.dataset.originalContent = displayContent;
    }

    // Enhanced playAudio method (existing functionality preserved)
    async playAudio(audioSrc, link, metadataEndpoint = null) {
        console.log('Playing:', audioSrc);

        // Build playlist from currently visible songs if starting fresh or playlist changed
        this.updatePlaylist(link);

        // ALWAYS stop any currently playing audio first
        if (this.currentAudio) {
            console.log('Stopping current audio');
            this.currentAudio.pause();
            this.currentAudio.removeAttribute('src');
            this.currentAudio.load();
        }

        // Clear the sticky player container
        if (this.stickyPlayerContainer) {
            this.stickyPlayerContainer.innerHTML = '';
        }

        // Reset references
        this.currentAudio = null;
        this.currentLink = link;
        this.currentMetadataDiv = null;

        // Create a new audio element
        const audio = new Audio();
        audio.controls = true;

        // Create metadata display container
        const metadataDiv = this.createMetadataDiv();

        // Create speed control slider
        const speedControlDiv = this.createSpeedControl(audio);

        audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
        audio.addEventListener('canplay', () => console.log('Can start playing'));
        audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            console.error('Audio error details:', audio.error);
        });

        // Save state on various events
        audio.addEventListener('play', () => this.savePlayerState());
        audio.addEventListener('pause', () => this.savePlayerState());
        audio.addEventListener('timeupdate', () => {
            // Throttle saves - only save every 2 seconds
            if (!this._lastSaveTime || Date.now() - this._lastSaveTime > 2000) {
                this.savePlayerState();
                this._lastSaveTime = Date.now();
            }
        });
        audio.addEventListener('ratechange', () => this.savePlayerState());

        audio.src = audioSrc;

        // Put player in sticky container instead of replacing the link
        const container = document.createElement('div');
        container.appendChild(metadataDiv);

        // Create audio player wrapper with controls
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'audio-player-wrapper';
        audioWrapper.appendChild(audio);
        audioWrapper.appendChild(speedControlDiv);

        container.appendChild(audioWrapper);

        // Add to sticky player container
        this.stickyPlayerContainer.appendChild(container);
        this.showStickyPlayer();

        // Store references
        this.currentAudio = audio;
        this.currentMetadataDiv = container;

        // Fetch and display metadata
        await this.loadMetadata(audioSrc, metadataDiv, metadataEndpoint, link);

        // Try to play after a short delay
        setTimeout(() => {
            audio.play().catch(e => {
                console.error('Play failed:', e);
            });
        }, 200);

        // When the audio ends, play next track
        audio.addEventListener('ended', () => {
            this.playNextTrack();
        });
    }

    // Update the current playlist based on visible songs
    updatePlaylist(clickedLink) {
        // Get all currently visible links (respects search filter and current folder)
        const visibleLinks = Array.from(document.querySelectorAll('.link')).filter(link => {
            const songRow = link.closest('.song-row');
            if (songRow) {
                return !songRow.classList.contains('search-hidden');
            }
            return !link.classList.contains('search-hidden');
        });

        this.currentPlaylist = visibleLinks;
        this.currentTrackIndex = visibleLinks.indexOf(clickedLink);

        console.log(`Playlist updated: ${visibleLinks.length} tracks, starting at index ${this.currentTrackIndex}`);
    }

    // Play the next track in the playlist
    playNextTrack() {
        if (this.currentPlaylist.length === 0) {
            this.hideStickyPlayer();
            this.clearPlayerState();
            document.title = this.originalPageTitle;
            return;
        }

        this.currentTrackIndex++;

        if (this.currentTrackIndex >= this.currentPlaylist.length) {
            // End of playlist
            console.log('End of playlist reached');
            this.hideStickyPlayer();
            this.clearPlayerState();
            document.title = this.originalPageTitle;
            this.currentTrackIndex = -1;
            return;
        }

        const nextLink = this.currentPlaylist[this.currentTrackIndex];
        if (nextLink) {
            nextLink.click();
        }
    }


    createMetadataDiv() {
        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'now-playing-metadata';
        metadataDiv.style.cssText = `
            display: flex;
            align-items: center;
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        `;

        metadataDiv.innerHTML = `
            <div style="width: 80px; height: 80px; background: #444; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                <span style="color: #888;">♪</span>
            </div>
            <div>
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">Loading...</div>
                <div style="opacity: 0.8;">Fetching metadata...</div>
            </div>
        `;

        return metadataDiv;
    }

    createSpeedControl(audio) {
        const speedDiv = document.createElement('div');
        speedDiv.className = 'speed-control';

        const label = document.createElement('label');
        label.textContent = 'Speed: ';
        label.style.marginRight = '8px';

        const speedValue = document.createElement('span');
        speedValue.className = 'speed-value';
        speedValue.textContent = `${audio.playbackRate.toFixed(1)}x`;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0.5';
        slider.max = '2.5';
        slider.step = '0.1';
        slider.value = audio.playbackRate.toString();
        slider.className = 'speed-slider';

        slider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            audio.playbackRate = speed;
            speedValue.textContent = `${speed.toFixed(1)}x`;
        });

        speedDiv.appendChild(label);
        speedDiv.appendChild(slider);
        speedDiv.appendChild(speedValue);

        return speedDiv;
    }

    async loadMetadata(audioSrc, metadataDiv, metadataEndpoint = null, link = null) {
        try {
            let metadataUrl;

            if (metadataEndpoint === 'local') {
                const filename = audioSrc.replace('music/', '');
                // Encode each path component separately to preserve forward slashes
                const encodedPath = filename.split('/').map(part => encodeURIComponent(part)).join('/');
                metadataUrl = `/localmetadata/${encodedPath}`;
            } else {
                // Extract folder and filename from proxy URL
                // Format: /b2proxy/:folder/:filename
                const urlParts = audioSrc.split('/');
                const folder = urlParts[2]; // folder name
                const filename = urlParts.slice(3).join('/'); // filename (already encoded)
                metadataUrl = `/b2metadata/${folder}/${filename}`;
            }

            console.log('Fetching metadata from:', metadataUrl);

            // Check cache first for B2 files
            if (metadataEndpoint === 'b2' && link) {
                const folder = link.dataset.folder;
                const filename = link.dataset.filename;
                const cacheKey = `${folder}/${filename}`;

                if (this.metadataCache.has(cacheKey)) {
                    console.log('Using cached metadata for:', cacheKey);
                    const metadata = this.metadataCache.get(cacheKey);
                    this.displayMetadata(metadataDiv, metadata, metadataEndpoint);
                    return;
                }
            }

            const response = await fetch(metadataUrl);
            const metadata = await response.json();

            console.log('Metadata received:', metadata);

            // Cache the metadata for B2 files
            if (metadataEndpoint === 'b2' && link) {
                const folder = link.dataset.folder;
                const filename = link.dataset.filename;
                const cacheKey = `${folder}/${filename}`;
                this.metadataCache.set(cacheKey, metadata);
                console.log('Cached metadata for:', cacheKey);

                // Update the original link's display for when it returns
                this.updateLinkDisplay(link, metadata);
            }

            this.displayMetadata(metadataDiv, metadata, metadataEndpoint);

        } catch (metadataError) {
            console.error('Failed to load metadata:', metadataError);
        }
    }

    displayMetadata(metadataDiv, metadata, metadataEndpoint) {
        // Store for session persistence
        this._currentMetadata = metadata;
        this._currentMetadataEndpoint = metadataEndpoint;

        const imageFormat = metadataEndpoint === 'local' ? 'png' : 'jpeg';
        const artworkSrc = metadata.artwork ?
            `data:image/${imageFormat};base64,${metadata.artwork}` :
            'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">♪</text></svg>');

        // Get folder information for navigation link
        let folderLink = '';
        if (this.currentLink) {
            const audioType = this.currentLink.dataset.audioType;
            const folder = this.currentLink.dataset.folder;

            if (audioType === 'local' && folder) {
                // Local file - create link to folder
                const folderHref = folder ? `/?dir=${encodeURIComponent(folder)}` : '/';
                const folderDisplay = folder ? folder.split('/').pop() : 'Root';
                folderLink = `<a href="${folderHref}" class="folder-link" style="display: inline-block; margin-top: 4px; padding: 3px 8px; background: rgba(0,255,127,0.2); color: lime; text-decoration: none; border-radius: 3px; font-size: 12px; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,255,127,0.3)'" onmouseout="this.style.background='rgba(0,255,127,0.2)'">📁 ${folderDisplay}</a>`;
            } else if (audioType === 'b2' && folder) {
                // B2 file - create link to B2 endpoint
                const folderHref = `/${folder}`;
                folderLink = `<a href="${folderHref}" style="display: inline-block; margin-top: 4px; padding: 3px 8px; background: rgba(0,255,127,0.2); color: lime; text-decoration: none; border-radius: 3px; font-size: 12px; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,255,127,0.3)'" onmouseout="this.style.background='rgba(0,255,127,0.2)'">📁 ${folder}</a>`;
            }
        }

        metadataDiv.innerHTML = `
            <img src="${artworkSrc}"
                 style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;"
                 onerror="this.style.display='none';">
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">${metadata.title}</div>
                <div style="opacity: 0.9; margin-bottom: 3px;">${metadata.artist}</div>
                <div style="opacity: 0.7; font-size: 14px;">${metadata.album}</div>
                ${folderLink}
            </div>
        `;

        // Update the page title with artist and song title
        document.title = `${metadata.artist} - ${metadata.title}`;
    }

}

// Global instance
const audioHandler = new AudioHandler();