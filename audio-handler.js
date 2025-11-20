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
        // Track if the next action has user gesture (for autoplay policy)
        this.hasUserGesture = false;
        // Discogs integration
        this.discogsService = null;
    }

    // Initialize pages with search functionality
    initializePage() {
        this.createStickyPlayer();
        this.setupSearchBar();
        this.indexAllLinks();
        this.setupClickHandlers();
        this.setupFolderNavigation();
        this.restorePlayerState();

        // Initialize Discogs service
        this.initializeDiscogs();

        // Determine current endpoint and load appropriate file index for search
        const pathname = window.location.pathname;

        if (pathname === '/') {
            // Local music endpoint - load all local files
            this.loadAllFilesForSearch();
        } else if (pathname === '/analog') {
            // B2 analog endpoint - load all analog files
            this.loadAllB2FilesForSearch('analog');
        } else if (pathname === '/live') {
            // B2 live endpoint - load all live files
            this.loadAllB2FilesForSearch('live');
        } else if (pathname === '/digital') {
            // B2 digital endpoint - load all digital files
            this.loadAllB2FilesForSearch('digital');
        }

        // DON'T preload metadata for B2 pages - only index filenames
        // Metadata will be loaded on-demand when songs are played
    }

    // Initialize Discogs service
    async initializeDiscogs() {
        if (typeof DiscogsService !== 'undefined') {
            this.discogsService = new DiscogsService();
            // Wait for config to load
            await this.discogsService.configLoaded;
        } else {
            console.warn('DiscogsService not loaded');
        }
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

    // Load all B2 files from a specific folder for comprehensive search
    async loadAllB2FilesForSearch(folderName) {
        try {
            console.log(`Loading B2 files for search from ${folderName}...`);
            const response = await fetch(`/api/all-b2-files/${folderName}`);
            const data = await response.json();

            console.log(`API response:`, data);

            if (data.success && data.files) {
                console.log(`Loaded ${data.files.length} B2 files for search from ${folderName} folder`);
                this.allFilesData = data.files;
                // Index these files for search with B2-specific type
                this.indexAllB2Files(data.files, folderName);
            } else {
                console.error(`Failed to load B2 files: ${data.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error(`Failed to load B2 files for search from ${folderName}:`, error);
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

    // Index all B2 files from a specific folder for search
    indexAllB2Files(filesData, folderName) {
        console.log(`Indexing ${filesData.length} B2 files...`);
        filesData.forEach((fileInfo, index) => {
            const searchData = {
                filename: fileInfo.fileName,
                folder: fileInfo.folderPath || '',
                combined: `${fileInfo.fileName} ${fileInfo.folderPath || ''}`
            };

            this.searchIndex.set(`all-b2-file-${index}`, {
                fileInfo: fileInfo,
                searchText: searchData.combined.toLowerCase(),
                data: searchData,
                type: 'all-b2-file',
                folderName: folderName  // Store the root folder (analog/live)
            });
        });

        console.log(`Indexed ${filesData.length} B2 files from ${folderName} folder for search`);
        console.log(`Total search index size: ${this.searchIndex.size}`);
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

            // Only intercept navigation within the same endpoint (local, analog, live, or digital)
            const isLocalNav = href.startsWith('/?') || href === '/';
            const isAnalogNav = href.startsWith('/analog');
            const isLiveNav = href.startsWith('/live');
            const isDigitalNav = href.startsWith('/digital');

            if (!isLocalNav && !isAnalogNav && !isLiveNav && !isDigitalNav) {
                return;
            }

            // Always save scroll position before navigating, even if audio isn't playing
            // This allows us to restore position when using breadcrumbs
            e.preventDefault();

            // Save current scroll position for this URL
            this.saveScrollPosition();

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

                    // Clear any active search when navigating to new folder
                    this.clearSearch();

                    // Re-index the new links
                    this.indexAllLinks();

                    // Update playlist to new folder's songs
                    this.updatePlaylistToCurrentPage();

                    // Restore scroll position for this URL, or scroll to top if new directory
                    this.restoreScrollPosition();
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

                        // Clear any active search when navigating via browser back/forward
                        this.clearSearch();

                        this.indexAllLinks();
                        this.updatePlaylistToCurrentPage();

                        // Restore scroll position when using browser back/forward
                        this.restoreScrollPosition();
                    });
            }
        });
    }

    // Save scroll position for the current URL
    saveScrollPosition() {
        const scrollPositions = JSON.parse(sessionStorage.getItem('scrollPositions') || '{}');
        scrollPositions[window.location.pathname + window.location.search] = window.scrollY;
        sessionStorage.setItem('scrollPositions', JSON.stringify(scrollPositions));
    }

    // Restore scroll position for the current URL
    restoreScrollPosition() {
        const scrollPositions = JSON.parse(sessionStorage.getItem('scrollPositions') || '{}');
        const savedPosition = scrollPositions[window.location.pathname + window.location.search];

        if (savedPosition !== undefined) {
            // Use setTimeout to ensure DOM is ready
            setTimeout(() => {
                window.scrollTo(0, savedPosition);
            }, 0);
        } else {
            // No saved position, scroll to top (new directory)
            window.scrollTo(0, 0);
        }
    }

    // Get the current endpoint (root, analog, live, or digital)
    getCurrentEndpoint() {
        const path = window.location.pathname;
        if (path === '/' || path.startsWith('/?')) {
            return 'root';
        } else if (path.includes('/analog')) {
            return 'analog';
        } else if (path.includes('/live')) {
            return 'live';
        } else if (path.includes('/digital')) {
            return 'digital';
        }
        return 'root';
    }

    // Get the endpoint from a href
    getEndpointFromHref(href) {
        if (href.startsWith('/analog')) {
            return 'analog';
        } else if (href.startsWith('/live')) {
            return 'live';
        } else if (href.startsWith('/digital')) {
            return 'digital';
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
    async restorePlayerState() {
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
            audio.addEventListener('play', () => {
                this.savePlayerState();
                this.updateMediaSessionPlaybackState('playing');
            });
            audio.addEventListener('pause', () => {
                this.savePlayerState();
                this.updateMediaSessionPlaybackState('paused');
            });
            audio.addEventListener('timeupdate', () => {
                if (!this._lastSaveTime || Date.now() - this._lastSaveTime > 2000) {
                    this.savePlayerState();
                    this._lastSaveTime = Date.now();
                }
                this.updateMediaSessionPosition();
            });
            audio.addEventListener('ratechange', () => {
                this.savePlayerState();
                this.updateMediaSessionPosition();
            });
            audio.addEventListener('loadedmetadata', () => {
                this.updateMediaSessionPosition();
            });
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

            // Clear placeholder and append to content wrapper
            if (this.playerContentWrapper) {
                // Remove placeholder if it exists
                const placeholder = this.playerContentWrapper.querySelector('.player-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
                this.playerContentWrapper.appendChild(container);
            } else {
                this.stickyPlayerContainer.appendChild(container);
            }
            this.showStickyPlayer();

            this.currentAudio = audio;
            this.currentMetadataDiv = container;

            // Display saved metadata and initialize Media Session
            if (state.metadata) {
                await this.displayMetadata(metadataDiv, state.metadata, state.metadataEndpoint);
            } else {
                // Initialize Media Session even without full metadata
                this.updateMediaSessionPlaybackState(state.isPlaying ? 'playing' : 'paused');
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
        // Don't add 'hidden' class - show player immediately
        playerContainer.className = 'sticky-audio-player';

        // Create content wrapper (this is what gets hidden/shown)
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'player-content';

        // Add placeholder content when no audio is playing
        const placeholder = document.createElement('div');
        placeholder.className = 'player-placeholder';
        placeholder.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #666;">
                <div style="font-size: 24px; margin-bottom: 10px;">🎵</div>
                <div>Click a song to start playing</div>
            </div>
        `;
        contentWrapper.appendChild(placeholder);
        playerContainer.appendChild(contentWrapper);

        // Create toggle button OUTSIDE the content wrapper
        const toggleButton = document.createElement('button');
        toggleButton.className = 'player-toggle-button';
        toggleButton.innerHTML = '&#9660;'; // Down arrow (chevron)
        toggleButton.title = 'Hide audio player';
        toggleButton.setAttribute('aria-label', 'Toggle audio player visibility');

        // Toggle handler
        toggleButton.addEventListener('click', () => {
            const isCollapsed = contentWrapper.classList.toggle('collapsed');
            toggleButton.innerHTML = isCollapsed ? '&#9650;' : '&#9660;'; // Up or down arrow
            toggleButton.title = isCollapsed ? 'Show audio player' : 'Hide audio player';

            // Save the collapsed state
            sessionStorage.setItem('audioPlayerCollapsed', isCollapsed ? 'true' : 'false');

            // Adjust body padding based on collapsed state
            this.adjustBodyPadding(isCollapsed);
        });

        playerContainer.appendChild(toggleButton);
        document.body.appendChild(playerContainer);
        this.stickyPlayerContainer = playerContainer;
        this.playerContentWrapper = contentWrapper; // Store reference to content wrapper

        // Show the player immediately and add body padding
        document.body.classList.add('player-active');

        // Only restore collapsed state if there's also audio player state being restored
        // Otherwise, start expanded (placeholder should be visible)
        const hasAudioState = sessionStorage.getItem('audioPlayerState');
        const wasCollapsed = sessionStorage.getItem('audioPlayerCollapsed') === 'true';

        if (hasAudioState && wasCollapsed) {
            contentWrapper.classList.add('collapsed');
            toggleButton.innerHTML = '&#9650;';
            toggleButton.title = 'Show audio player';
            this.adjustBodyPadding(true);
        } else {
            // Start expanded by default
            this.adjustBodyPadding(false);
        }
    }

    // Show the sticky player
    showStickyPlayer() {
        if (this.stickyPlayerContainer) {
            this.stickyPlayerContainer.classList.remove('hidden');
            document.body.classList.add('player-active');

            // Adjust padding based on whether it's collapsed
            const isCollapsed = this.playerContentWrapper && this.playerContentWrapper.classList.contains('collapsed');
            this.adjustBodyPadding(isCollapsed);
        }
    }

    // Adjust body padding based on player state
    adjustBodyPadding(isCollapsed) {
        if (isCollapsed) {
            // Smaller padding when collapsed - just enough for the toggle button
            const isMobile = window.innerWidth <= 768;
            document.body.style.paddingBottom = isMobile ? '40px' : '50px';
        } else {
            // Full padding when expanded
            const isMobile = window.innerWidth <= 768;
            document.body.style.paddingBottom = isMobile ? '95px' : '200px';
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

            // User clicked, so we have a gesture
            this.hasUserGesture = true;

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
        const topNav = document.querySelector('.top-nav');
        if (!topNav) return;

        // Determine if we're on a page that supports rescanning
        const pathname = window.location.pathname;
        const isLocalPage = pathname === '/';
        const isAnalogPage = pathname === '/analog';
        const isLivePage = pathname === '/live';
        const isDigitalPage = pathname === '/digital';
        const showRescanButton = isLocalPage || isAnalogPage || isLivePage || isDigitalPage;
        const rescanButton = showRescanButton ? '<button class="rescan-button" id="rescanButton">&#128257; Rescan</button>' : '';

        const searchHTML = `
            <div class="top-nav-right">
                <div class="search-bar">
                    <div style="position: relative; flex: 1;">
                        <input type="text"
                               class="search-input"
                               id="musicSearch"
                               placeholder="Search songs, artists, albums, or filenames..."
                               autocomplete="off">
                        <span class="search-icon">&#128269;</span>
                    </div>
                    <button class="clear-search" id="clearSearch" style="display: none;">Clear</button>
                    ${rescanButton}
                    <div class="search-results-count" id="searchResults"></div>
                    <div class="search-loading" id="searchLoading">Searching...</div>
                </div>
            </div>
        `;

        topNav.insertAdjacentHTML('beforeend', searchHTML);
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
            button.textContent = '\u23F3 Scanning...';

            // Determine which endpoint to call based on current page
            const pathname = window.location.pathname;
            let rescanUrl = '/rescan'; // default for local files

            if (pathname === '/analog') {
                rescanUrl = '/rescan-b2/analog';
            } else if (pathname === '/live') {
                rescanUrl = '/rescan-b2/live';
            } else if (pathname === '/digital') {
                rescanUrl = '/rescan-b2/digital';
            }

            const response = await fetch(rescanUrl);
            const result = await response.json();

            if (result.success) {
                button.textContent = '\u2713 Complete!';
                setTimeout(() => {
                    // Reload the page to show new files
                    window.location.reload();
                }, 800);
            } else {
                button.textContent = '\u2717 Failed';
                setTimeout(() => {
                    button.textContent = '\u{1F501} Rescan';
                    button.disabled = false;
                }, 2000);
            }
        } catch (error) {
            console.error('Rescan failed:', error);
            button.textContent = '\u2717 Error';
            setTimeout(() => {
                button.textContent = '\u{1F501} Rescan';
                button.disabled = false;
            }, 2000);
        }
    }

    // Index all links for searching (include folder links)
    indexAllLinks() {
        this.allLinks = Array.from(document.querySelectorAll('.link'));
        // Also include folder links in search
        this.folderLinks = Array.from(document.querySelectorAll('.folder-link'));

        // Clear only the current page links from search index, preserve all-file and all-b2-file entries
        const keysToDelete = [];
        this.searchIndex.forEach((item, key) => {
            if (item.type !== 'all-file' && item.type !== 'all-b2-file') {
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

                if (type === 'all-file' || type === 'all-b2-file') {
                    // Handle all-file and all-b2-file results separately
                    if (matches) {
                        matchedAllFiles.push(fileInfo);
                        visibleCount++;
                    }
                } else {
                    // Handle regular links (current page)
                    // Re-query for parent row at search time (could be song-row or folder-row)
                    const parentRow = link ? link.closest('.song-row, .folder-row') : null;

                    if (matches) {
                        // Hide/show the parent row if it exists, otherwise hide the link
                        if (parentRow) {
                            parentRow.classList.remove('search-hidden');
                            // Also ensure the link itself doesn't have the class
                            if (link) link.classList.remove('search-hidden');
                        } else if (link) {
                            link.classList.remove('search-hidden');
                        }
                        if (link) this.highlightMatches(link, searchTerms);
                        visibleCount++;
                    } else {
                        if (parentRow) {
                            parentRow.classList.add('search-hidden');
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

        // Determine if we're on a B2 endpoint
        const pathname = window.location.pathname;
        const isB2Endpoint = pathname === '/analog' || pathname === '/live' || pathname === '/digital';
        const b2FolderName = pathname === '/analog' ? 'analog' : (pathname === '/live' ? 'live' : (pathname === '/digital' ? 'digital' : null));

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
            folderHeader.textContent = folder;
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

                // Set appropriate data attributes based on endpoint type
                if (isB2Endpoint && b2FolderName) {
                    // B2 file - set proxy URLs and b2 audio type
                    link.dataset.audioType = 'b2';
                    const proxyUrl = `/b2proxy/${b2FolderName}/${encodeURIComponent(fileInfo.relativePath)}`;
                    const metadataUrl = `/b2metadata/${b2FolderName}/${encodeURIComponent(fileInfo.relativePath)}`;
                    link.dataset.proxyUrl = proxyUrl;
                    link.dataset.metadataUrl = metadataUrl;
                } else {
                    // Local file
                    link.dataset.audioType = 'local';
                }

                // Highlight matching terms
                let displayText = fileInfo.fileName;
                // Sort terms by length (longest first) to avoid partial matches
                const sortedTerms = [...searchTerms].sort((a, b) => b.length - a.length);
                sortedTerms.forEach(term => {
                    const regex = new RegExp(`(?![^<]*>|[^<>]*</)(${this.escapeRegex(term)})`, 'gi');
                    displayText = displayText.replace(regex, '<span class="search-highlight">$1</span>');
                });

                link.innerHTML = displayText;

                songRow.appendChild(link);

                // Add direct link button
                const encodedPath = fileInfo.relativePath.split('/').map(part => encodeURIComponent(part)).join('/');
                const directLink = document.createElement('a');
                directLink.className = 'direct-link';

                if (isB2Endpoint && b2FolderName) {
                    // B2 proxy URL for direct link
                    directLink.href = `/b2proxy/${b2FolderName}/${encodeURIComponent(fileInfo.relativePath)}`;
                } else {
                    // Local file URL
                    directLink.href = `/music/${encodedPath}`;
                }

                directLink.title = 'Direct link to file';
                directLink.innerHTML = '&#128279;';
                songRow.appendChild(directLink);

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

        // Always start with clean original content
        let content = link.dataset.originalContent;

        // Sort terms by length (longest first) to avoid partial matches being highlighted first
        const sortedTerms = [...searchTerms].sort((a, b) => b.length - a.length);

        // Highlight each search term, but avoid re-highlighting already highlighted content
        sortedTerms.forEach(term => {
            // Match term only if it's not already inside a highlight span
            const regex = new RegExp(`(?![^<]*>|[^<>]*</)(${ this.escapeRegex(term)})`, 'gi');
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
    async playAudio(audioSrc, link, metadataEndpoint = null, autoPlay = true) {
        // Check if we have a user gesture (from Media Session controls)
        const hasGesture = this.hasUserGesture;
        this.hasUserGesture = false; // Reset the flag

        console.log('Playing:', audioSrc, 'autoPlay:', autoPlay, 'hasUserGesture:', hasGesture);

        // Build playlist from currently visible songs if starting fresh or playlist changed
        this.updatePlaylist(link);

        let audio;
        let isNewAudioElement = false;

        // Reuse existing audio element if possible to maintain user gesture chain
        if (this.currentAudio) {
            console.log('Reusing existing audio element');
            audio = this.currentAudio;
            // Pause and prepare for new source
            audio.pause();
            audio.currentTime = 0;
        } else {
            console.log('Creating new audio element');
            isNewAudioElement = true;
            // Create a new audio element
            audio = new Audio();
            audio.controls = true;
            audio.preload = 'auto';
        }

        // Update link reference
        this.currentLink = link;

        // Only add event listeners if this is a new audio element
        if (isNewAudioElement) {
            audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
            audio.addEventListener('canplay', () => console.log('Can start playing'));
            audio.addEventListener('error', (e) => {
                console.error('Audio error:', e);
                console.error('Audio error details:', audio.error);

                // Auto-skip to next song after error
                setTimeout(() => {
                    console.log('Auto-skipping to next song after error');
                    this.playNextTrack();
                }, 3000); // Wait 3 seconds before skipping
            });

            // Save state on various events
            audio.addEventListener('play', () => {
                this.savePlayerState();
                this.updateMediaSessionPlaybackState('playing');
            });
            audio.addEventListener('pause', () => {
                this.savePlayerState();
                this.updateMediaSessionPlaybackState('paused');
            });
            audio.addEventListener('timeupdate', () => {
                // Throttle saves - only save every 2 seconds
                if (!this._lastSaveTime || Date.now() - this._lastSaveTime > 2000) {
                    this.savePlayerState();
                    this._lastSaveTime = Date.now();
                }
                // Update Media Session position state for lock screen progress bar
                this.updateMediaSessionPosition();
            });
            audio.addEventListener('ratechange', () => {
                this.savePlayerState();
                this.updateMediaSessionPosition();
            });
            audio.addEventListener('loadedmetadata', () => {
                // Update position state when duration becomes available
                this.updateMediaSessionPosition();
            });
            audio.addEventListener('ended', () => {
                console.log('Audio ended, advancing to next track');

                // Use the shared playNextTrack logic
                this.playNextTrack();
            });
        }

        // Create metadata display container
        const metadataDiv = this.createMetadataDiv();

        // Create speed control slider (only if new element)
        const speedControlDiv = isNewAudioElement ? this.createSpeedControl(audio) : this.currentMetadataDiv.querySelector('.audio-player-wrapper');

        // Set the new source (this works whether it's new or reused element)
        audio.src = audioSrc;

        // Force load the new source
        audio.load();

        // Only rebuild UI if this is a new audio element
        if (isNewAudioElement) {
            // DON'T clear the entire container - it destroys the toggle button!
            // Just clear the content wrapper
            if (this.playerContentWrapper) {
                this.playerContentWrapper.innerHTML = '';
            }

            // Put player in sticky container
            const container = document.createElement('div');
            container.appendChild(metadataDiv);

            // Create audio player wrapper with controls
            const audioWrapper = document.createElement('div');
            audioWrapper.className = 'audio-player-wrapper';
            audioWrapper.appendChild(audio);
            audioWrapper.appendChild(speedControlDiv);

            container.appendChild(audioWrapper);

            // Add to content wrapper (placeholder already cleared above)
            if (this.playerContentWrapper) {
                this.playerContentWrapper.appendChild(container);
            } else {
                this.stickyPlayerContainer.appendChild(container);
            }
            this.showStickyPlayer();

            // Store references
            this.currentAudio = audio;
            this.currentMetadataDiv = container;
        } else {
            // Just update the metadata div content in the existing container
            const existingMetadataDiv = this.currentMetadataDiv.querySelector('.now-playing-metadata');
            if (existingMetadataDiv) {
                // Will be updated by loadMetadata below
                existingMetadataDiv.innerHTML = metadataDiv.innerHTML;
            }
        }

        // CRITICAL FOR CHROME: Start playback IMMEDIATELY to use the user gesture
        // before it expires, then load metadata asynchronously
        let playPromise = null;
        if (autoPlay || hasGesture) {
            console.log('Starting playback immediately...', hasGesture ? '(has user gesture)' : '(automatic)');
            // Start playing right away - don't wait for metadata
            playPromise = audio.play();

            if (playPromise !== undefined) {
                playPromise.then(() => {
                    console.log('Autoplay succeeded');
                }).catch(error => {
                    console.warn('Autoplay was prevented:', error.name, error.message);
                    // Update Media Session to show paused state
                    this.updateMediaSessionPlaybackState('paused');
                    // On mobile, the user can tap the lock screen play button to resume
                });
            }
        } else {
            console.log('Autoplay disabled, waiting for user interaction');
            this.updateMediaSessionPlaybackState('paused');
        }

        // Fetch and display metadata AFTER starting playback (or in parallel)
        // Use the correct metadata div reference
        const targetMetadataDiv = isNewAudioElement ? metadataDiv : this.currentMetadataDiv.querySelector('.now-playing-metadata');
        await this.loadMetadata(audioSrc, targetMetadataDiv, metadataEndpoint, link);
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
        console.log('playNextTrack called, playlist length:', this.currentPlaylist.length, 'current index:', this.currentTrackIndex);

        if (this.currentPlaylist.length === 0) {
            console.log('No next song available (empty playlist) - keeping player visible');
            // Don't hide the player or clear state - just stop playback
            // This allows the user to still see the current song and interact with the player
            if (this.currentAudio) {
                this.currentAudio.pause();
            }
            return;
        }

        this.currentTrackIndex++;
        console.log('Advanced to index:', this.currentTrackIndex);

        if (this.currentTrackIndex >= this.currentPlaylist.length) {
            // End of playlist - keep player visible but stop playback
            console.log('End of playlist reached - keeping player visible');
            if (this.currentAudio) {
                this.currentAudio.pause();
            }
            this.currentTrackIndex = -1;
            return;
        }

        const nextLink = this.currentPlaylist[this.currentTrackIndex];
        if (!nextLink) {
            console.error('Next link is null or undefined');
            return;
        }

        // Directly load and play the next track using the existing audio element
        this.advanceToTrack(nextLink);
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
                <span style="color: #888;">&#9834;</span>
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
                    await this.displayMetadata(metadataDiv, metadata, metadataEndpoint);
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

            await this.displayMetadata(metadataDiv, metadata, metadataEndpoint);

        } catch (metadataError) {
            console.error('Failed to load metadata:', metadataError);
            
            // Show basic info without metadata
            const filename = audioSrc.split('/').pop();
            metadataDiv.innerHTML = `
                <div style="width: 80px; height: 80px; background: #666; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                    <span style="color: #ccc; font-size: 24px;">&#9834;</span>
                </div>
                <div>
                    <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">${decodeURIComponent(filename)}</div>
                    <div style="opacity: 0.7; font-size: 14px;">Metadata unavailable</div>
                </div>
            `;
        }
    }

    async displayMetadata(metadataDiv, metadata, metadataEndpoint) {
        // Store for session persistence
        this._currentMetadata = metadata;
        this._currentMetadataEndpoint = metadataEndpoint;

        const imageFormat = metadataEndpoint === 'local' ? 'png' : 'jpeg';
        const artworkSrc = metadata.artwork ?
            `data:image/${imageFormat};base64,${metadata.artwork}` :
            'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">&#9834;</text></svg>');

        // Get folder information for navigation link
        let folderLink = '';
        if (this.currentLink) {
            const audioType = this.currentLink.dataset.audioType;
            const folder = this.currentLink.dataset.folder;

            if (audioType === 'local') {
                // Local file - create link to folder
                const folderHref = folder ? `/?dir=${encodeURIComponent(folder)}` : '/';
                const folderDisplay = folder ? folder.split('/').pop() : 'Home';
                folderLink = `<a href="${folderHref}" class="folder-link" style="display: inline-block; margin-top: 4px; padding: 3px 8px; background: rgba(0,255,127,0.2); color: lime; text-decoration: none; border-radius: 3px; font-size: 12px; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,255,127,0.3)'" onmouseout="this.style.background='rgba(0,255,127,0.2)'">${folderDisplay}</a>`;
            } else if (audioType === 'b2' && folder) {
                // B2 file - don't create a clickable link since it crosses endpoints
                // Just show the folder name as a badge
                folderLink = `<span style="display: inline-block; margin-top: 4px; padding: 3px 8px; background: rgba(0,255,127,0.2); color: lime; border-radius: 3px; font-size: 12px;">${folder}</span>`;
            }
        }

        // Wait for Discogs config to load before checking collection URL
        if (this.discogsService?.configLoaded) {
            await this.discogsService.configLoaded;
        }

        // Build collection link if available
        let collectionLink = '';
        if (this.discogsService?.collectionUrl && this.discogsService?.username) {
            collectionLink = `
                <a href="${this.discogsService.collectionUrl}" target="_blank" class="discogs-link discogs-collection" style="display: inline-block; margin-top: 4px; margin-right: 8px;" title="View ${this.discogsService.username}'s Discogs collection">
                    <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right: 4px;">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
                    </svg>
                    ${this.discogsService.username}'s collection
                </a>
            `;
        }

        // Helper function to format metadata field
        const formatField = (label, value, formatter = null) => {
            if (value === undefined || value === null || value === '') return '';
            const displayValue = formatter ? formatter(value) : value;
            return `<span style="display: inline-block; margin-right: 12px; margin-bottom: 4px; font-size: 11px; white-space: nowrap;"><strong>${label}:</strong> ${displayValue}</span>`;
        };

        // Format file size
        const formatFileSize = (bytes) => {
            if (!bytes) return '';
            const mb = bytes / (1024 * 1024);
            return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
        };

        // Format bitrate
        const formatBitrate = (bps) => {
            if (!bps) return '';
            return `${Math.round(bps / 1000)} kbps`;
        };

        // Format sample rate
        const formatSampleRate = (hz) => {
            if (!hz) return '';
            return `${(hz / 1000).toFixed(1)} kHz`;
        };

        // Format date
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toLocaleDateString();
        };

        // Format duration
        const formatDuration = (seconds) => {
            if (!seconds) return '';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        // Build additional metadata fields
        const additionalMetadata = [
            formatField('Duration', metadata.duration, formatDuration),
            formatField('Year', metadata.year),
            formatField('Genre', metadata.genre),
            formatField('Track', metadata.trackNumber),
            formatField('Composer', metadata.composer),
            formatField('Bitrate', metadata.bitrate, formatBitrate),
            formatField('Sample Rate', metadata.sampleRate, formatSampleRate),
            formatField('Codec', metadata.codec),
            formatField('Channels', metadata.numberOfChannels),
            formatField('File Size', metadata.fileSize, formatFileSize),
            formatField('Created', metadata.createdDate, formatDate),
            formatField('Modified', metadata.modifiedDate, formatDate),
            formatField('Uploaded', metadata.uploadDate, formatDate)
        ].filter(field => field !== '').join('');

        metadataDiv.innerHTML = `
            <img src="${artworkSrc}"
                 style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;"
                 onerror="this.style.display='none';">
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">${metadata.title}</div>
                <div style="opacity: 0.9; margin-bottom: 3px;">${metadata.artist}</div>
                <div style="opacity: 0.7; font-size: 14px; margin-bottom: 8px;">${metadata.album}</div>
                <div style="display: flex; flex-wrap: wrap; opacity: 0.8; line-height: 1.6; margin-bottom: 4px;">
                    ${additionalMetadata}
                </div>
                ${folderLink}${collectionLink}
                <div id="discogs-info" style="margin-top: 8px;"></div>
            </div>
        `;

        // Update the page title with artist and song title
        document.title = `${metadata.artist} - ${metadata.title}`;

        // Update Media Session API with metadata
        this.updateMediaSession(metadata, artworkSrc);

        // Fetch and display Discogs info
        this.updateDiscogsInfo(metadata);
    }

    // Media Session API integration for lock screen controls and background playback
    updateMediaSession(metadata, artworkSrc) {
        if ('mediaSession' in navigator) {
            console.log('Updating Media Session with:', metadata);

            // Set metadata for lock screen and notifications
            navigator.mediaSession.metadata = new MediaMetadata({
                title: metadata.title || 'Unknown Title',
                artist: metadata.artist || 'Unknown Artist',
                album: metadata.album || 'Unknown Album',
                artwork: [
                    { src: artworkSrc, sizes: '96x96', type: 'image/png' },
                    { src: artworkSrc, sizes: '128x128', type: 'image/png' },
                    { src: artworkSrc, sizes: '192x192', type: 'image/png' },
                    { src: artworkSrc, sizes: '256x256', type: 'image/png' },
                    { src: artworkSrc, sizes: '384x384', type: 'image/png' },
                    { src: artworkSrc, sizes: '512x512', type: 'image/png' }
                ]
            });

            // Set up action handlers for lock screen controls
            navigator.mediaSession.setActionHandler('play', () => {
                console.log('Media Session: Play button pressed');
                if (this.currentAudio) {
                    const playPromise = this.currentAudio.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('Playback resumed from lock screen');
                        }).catch(e => {
                            console.error('Failed to play from lock screen:', e);
                        });
                    }
                }
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                console.log('Media Session: Pause button pressed');
                if (this.currentAudio) {
                    this.currentAudio.pause();
                }
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                console.log('Media Session: Previous Track (user gesture)');
                this.hasUserGesture = true;
                this.playPreviousTrack();
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                console.log('Media Session: Next Track (user gesture)');
                this.hasUserGesture = true;
                this.playNextTrack();
            });

            // Seek controls for lock screen
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                console.log('Media Session: Seek Backward');
                if (this.currentAudio) {
                    const skipTime = details.seekOffset || 10;
                    this.currentAudio.currentTime = Math.max(this.currentAudio.currentTime - skipTime, 0);
                }
            });

            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                console.log('Media Session: Seek Forward');
                if (this.currentAudio) {
                    const skipTime = details.seekOffset || 10;
                    this.currentAudio.currentTime = Math.min(
                        this.currentAudio.currentTime + skipTime,
                        this.currentAudio.duration
                    );
                }
            });

            // Seek to specific position
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                console.log('Media Session: Seek To', details.seekTime);
                if (this.currentAudio && details.seekTime !== undefined) {
                    this.currentAudio.currentTime = details.seekTime;
                }
            });

            // Update position state for lock screen progress bar
            if (this.currentAudio && !isNaN(this.currentAudio.duration)) {
                navigator.mediaSession.setPositionState({
                    duration: this.currentAudio.duration,
                    playbackRate: this.currentAudio.playbackRate,
                    position: this.currentAudio.currentTime
                });
            }

            console.log('Media Session API configured successfully');
        } else {
            console.log('Media Session API not supported in this browser');
        }
    }

    // Play the previous track in the playlist
    playPreviousTrack() {
        if (this.currentPlaylist.length === 0) {
            return;
        }

        this.currentTrackIndex--;

        if (this.currentTrackIndex < 0) {
            // Loop to end of playlist
            this.currentTrackIndex = this.currentPlaylist.length - 1;
        }

        const previousLink = this.currentPlaylist[this.currentTrackIndex];
        if (previousLink) {
            // Directly load and play the previous track
            this.advanceToTrack(previousLink);
        }
    }

    // Shared method to advance to a specific track without recreating the audio element
    advanceToTrack(link) {
        if (!this.currentAudio) {
            console.error('No audio element to advance');
            return;
        }

        console.log('Advancing to track:', link);

        // Get the audio source info
        const audioType = link.dataset.audioType;
        let audioSrc = '';
        let metadataEndpoint = '';

        if (audioType === 'local') {
            const relativePath = link.dataset.relativePath;
            if (relativePath) {
                const encodedPath = relativePath.split('/').map(part => encodeURIComponent(part)).join('/');
                audioSrc = `music/${encodedPath}`;
                metadataEndpoint = 'local';
            }
        } else if (audioType === 'b2') {
            audioSrc = link.dataset.proxyUrl;
            metadataEndpoint = 'b2';
        }

        if (!audioSrc) {
            console.error('Could not determine audio source');
            return;
        }

        console.log('Loading track:', audioSrc);
        this.currentLink = link;

        // Change the source
        this.currentAudio.src = audioSrc;
        this.currentAudio.load();

        // Start playing immediately
        const playPromise = this.currentAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('Track playing successfully');
            }).catch(error => {
                console.warn('Autoplay prevented:', error.name);
            });
        }

        // Update metadata asynchronously
        const metadataDiv = this.currentMetadataDiv.querySelector('.now-playing-metadata');
        if (metadataDiv) {
            this.loadMetadata(audioSrc, metadataDiv, metadataEndpoint, link);
        }

        // Save state
        this.savePlayerState();
    }

    // Update Media Session position state for lock screen progress
    updateMediaSessionPosition() {
        if ('mediaSession' in navigator && this.currentAudio) {
            if (!isNaN(this.currentAudio.duration) && isFinite(this.currentAudio.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: this.currentAudio.duration,
                        playbackRate: this.currentAudio.playbackRate,
                        position: this.currentAudio.currentTime
                    });
                } catch (e) {
                    // Silently fail if position state update fails
                    console.debug('Position state update failed:', e);
                }
            }
        }
    }

    // Update Media Session playback state
    updateMediaSessionPlaybackState(state) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = state;
            console.log('Media Session playback state:', state);
        }
    }

    // Update Discogs information for current track
    async updateDiscogsInfo(metadata) {
        const discogsContainer = document.getElementById('discogs-info');
        if (!discogsContainer || !this.discogsService) {
            return;
        }

        // Show loading state
        discogsContainer.innerHTML = `
            <div class="discogs-loading" style="font-size: 12px; opacity: 0.6;">
                <span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> Searching Discogs...
            </div>
        `;

        try {
            const info = await this.discogsService.getTrackInfo(metadata);

            if (!info.found) {
                // No results - show search link
                const searchUrl = this.discogsService.getSearchUrl(metadata);
                discogsContainer.innerHTML = `
                    <a href="${searchUrl}" target="_blank" class="discogs-link discogs-search" title="Search Discogs for this release">
                        <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right: 4px;">
                            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
                            <line x1="15" y1="15" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>
                        </svg>
                        Search on Discogs
                    </a>
                `;
                return;
            }

            // Show the best match
            const release = info.release;
            const confidenceBadge = info.confidence === 'high' ? '✓' :
                                   info.confidence === 'medium' ? '~' : '?';
            const confidenceTitle = info.confidence === 'high' ? 'High confidence match' :
                                   info.confidence === 'medium' ? 'Possible match' :
                                   'Low confidence match';

            // Show simple "On Discogs" label instead of full title
            let html = `
                <div class="discogs-result">
                    <a href="https://www.discogs.com${release.uri}" target="_blank" class="discogs-link discogs-match" title="${confidenceTitle}: ${release.title}">
                        <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right: 4px;">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                            <path d="M7 13l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/>
                        </svg>
                        <span class="confidence-badge" title="${confidenceTitle}">${confidenceBadge}</span>
                        On Discogs
                    </a>
                    ${release.year ? `<span class="discogs-year">${release.year}</span>` : ''}
                    ${release.format ? `<span class="discogs-format">${release.format}</span>` : ''}
                </div>
            `;

            // Add "View all results" if multiple results
            if (info.allResults && info.allResults.length > 1) {
                const searchUrl = this.discogsService.getSearchUrl(metadata);
                html += `
                    <a href="${searchUrl}" target="_blank" class="discogs-link discogs-more" style="margin-left: 12px;">
                        +${info.allResults.length - 1} more
                    </a>
                `;
            }

            discogsContainer.innerHTML = html;

        } catch (error) {
            console.error('Discogs lookup failed:', error);

            // Check if it's a network error (offline)
            if (error.isNetworkError || error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
                discogsContainer.innerHTML = `
                    <div class="discogs-offline" style="font-size: 12px; color: rgba(255, 255, 255, 0.4); display: flex; align-items: center;">
                        <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right: 4px;">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                            <line x1="7" y1="12" x2="17" y2="12" stroke="currentColor" stroke-width="2"/>
                        </svg>
                        Discogs offline
                    </div>
                `;
            } else {
                // Other error - show fallback search link
                const searchUrl = this.discogsService.getSearchUrl(metadata);
                discogsContainer.innerHTML = `
                    <a href="${searchUrl}" target="_blank" class="discogs-link discogs-error" title="Search failed - click to search manually">
                        <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle; margin-right: 4px;">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                            <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/>
                            <circle cx="12" cy="16" r="1" fill="currentColor"/>
                        </svg>
                        Search on Discogs
                    </a>
                `;
            }
        }
    }

}

// Global instance
const audioHandler = new AudioHandler();