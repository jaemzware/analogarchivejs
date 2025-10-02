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
    }

    // Initialize pages with search functionality
    initializePage() {
        this.setupSearchBar();
        this.indexAllLinks();

        // DON'T preload metadata for B2 pages - only index filenames
        // Metadata will be loaded on-demand when songs are played
    }

    // Setup search bar HTML and functionality
    setupSearchBar() {
        const container = document.querySelector('.container');
        if (!container) return;

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
    }

    // Index all links for searching
    indexAllLinks() {
        this.allLinks = Array.from(document.querySelectorAll('.link'));
        this.searchIndex.clear();

        this.allLinks.forEach((link, index) => {
            const searchData = this.extractSearchableData(link);
            this.searchIndex.set(index, {
                link: link,
                searchText: searchData.combined.toLowerCase(),
                data: searchData
            });
        });

        this.updateResultsCount(this.allLinks.length, this.allLinks.length);
    }

    // Extract searchable data from a link
    extractSearchableData(link) {
        let filename = '';
        let artist = '';
        let album = '';
        let title = '';

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

        const combined = [filename, artist, album, title].filter(Boolean).join(' ');

        return {
            filename,
            artist,
            album,
            title,
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

            this.searchIndex.forEach((item) => {
                const { link, searchText } = item;

                // Check if all search terms are found
                const matches = searchTerms.every(term => searchText.includes(term));

                if (matches) {
                    link.classList.remove('search-hidden');
                    this.highlightMatches(link, searchTerms);
                    visibleCount++;
                } else {
                    link.classList.add('search-hidden');
                }
            });

            this.updateResultsCount(visibleCount, this.allLinks.length);
            this.toggleClearButton(true);

            if (searchLoading) {
                searchLoading.classList.remove('active');
            }
        }, 10);
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
    }

    // Clear search and show all items
    clearSearch() {
        const searchInput = document.getElementById('musicSearch');
        if (searchInput) {
            searchInput.value = '';
        }

        this.allLinks.forEach(link => {
            link.classList.remove('search-hidden');
        });

        this.removeHighlighting();
        this.updateResultsCount(this.allLinks.length, this.allLinks.length);
        this.toggleClearButton(false);
        this.isSearchActive = false;

        if (searchInput) {
            searchInput.focus();
        }
    }

    // Update search results count display
    updateResultsCount(visible, total) {
        const resultsElement = document.getElementById('searchResults');
        if (resultsElement) {
            if (visible === total) {
                resultsElement.textContent = `${total} songs`;
            } else {
                resultsElement.textContent = `${visible} of ${total} songs`;
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

    // Initialize B2 pages - ONLY load cached metadata, don't fetch new metadata
    initializeB2Page() {
        const links = document.querySelectorAll('.link[data-folder]');
        links.forEach(link => {
            // Only use metadata if it's already in cache (from previous play)
            this.loadCachedMetadataForLink(link);
        });
    }

    // Load cached metadata for a specific link ONLY if already cached
    async loadCachedMetadataForLink(link) {
        const folder = link.dataset.folder;
        const filename = link.dataset.filename;
        const cacheKey = `${folder}/${filename}`;

        // ONLY use cached data - don't fetch new metadata
        if (this.metadataCache.has(cacheKey)) {
            const metadata = this.metadataCache.get(cacheKey);
            this.updateLinkDisplay(link, metadata);
            // Re-index this link with updated metadata for better search
            this.reindexLink(link);
        }
    }

    // Re-index a single link after metadata is loaded
    reindexLink(link) {
        const linkIndex = this.allLinks.indexOf(link);
        if (linkIndex !== -1) {
            const searchData = this.extractSearchableData(link);
            this.searchIndex.set(linkIndex, {
                link: link,
                searchText: searchData.combined.toLowerCase(),
                data: searchData
            });
        }
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

        // ALWAYS stop any currently playing audio first
        if (this.currentAudio) {
            console.log('Stopping current audio');
            this.currentAudio.pause();
            this.currentAudio.removeAttribute('src');
            this.currentAudio.load();
        }

        // If there's a current container, restore the original link
        if (this.currentLink && this.currentMetadataDiv) {
            this.currentMetadataDiv.parentNode.replaceChild(this.currentLink, this.currentMetadataDiv);
        }

        // Reset references
        this.currentAudio = null;
        this.currentLink = null;
        this.currentMetadataDiv = null;

        // Create a new audio element
        const audio = new Audio();
        audio.controls = true;

        // Create metadata display container
        const metadataDiv = this.createMetadataDiv();

        audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
        audio.addEventListener('canplay', () => console.log('Can start playing'));
        audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            console.error('Audio error details:', audio.error);
        });

        audio.src = audioSrc;

        // Replace the link with audio and metadata
        const container = document.createElement('div');
        container.appendChild(metadataDiv);
        container.appendChild(audio);
        link.parentNode.replaceChild(container, link);

        // Store references
        this.currentAudio = audio;
        this.currentLink = link;
        this.currentMetadataDiv = container;

        // Fetch and display metadata
        await this.loadMetadata(audioSrc, metadataDiv, metadataEndpoint, link);

        // Try to play after a short delay
        setTimeout(() => {
            audio.play().catch(e => {
                console.error('Play failed:', e);
            });
        }, 200);

        // When the audio ends, replace everything with the original link
        audio.addEventListener('ended', () => {
            container.parentNode.replaceChild(link, container);
            this.currentAudio = null;
            this.currentLink = null;
            this.currentMetadataDiv = null;

            // Find next visible link (respects search filter)
            let nextLink = link.nextElementSibling;
            while (nextLink && nextLink.classList.contains('search-hidden')) {
                nextLink = nextLink.nextElementSibling;
            }
            if (nextLink && nextLink.classList.contains('link')) {
                nextLink.click();
            }
        });
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
                // Re-index the link with new metadata
                this.reindexLink(link);
            }

            this.displayMetadata(metadataDiv, metadata, metadataEndpoint);

        } catch (metadataError) {
            console.error('Failed to load metadata:', metadataError);
        }
    }

    displayMetadata(metadataDiv, metadata, metadataEndpoint) {
        const imageFormat = metadataEndpoint === 'local' ? 'png' : 'jpeg';
        const artworkSrc = metadata.artwork ?
            `data:image/${imageFormat};base64,${metadata.artwork}` :
            'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">♪</text></svg>');

        metadataDiv.innerHTML = `
            <img src="${artworkSrc}" 
                 style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;" 
                 onerror="this.style.display='none';">
            <div>
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">${metadata.title}</div>
                <div style="opacity: 0.9; margin-bottom: 3px;">${metadata.artist}</div>
                <div style="opacity: 0.7; font-size: 14px;">${metadata.album}</div>
            </div>
        `;
    }

    // Method to preload metadata for visible links
    async preloadMetadataForVisibleLinks() {
        const links = document.querySelectorAll('.link[data-folder]:not([data-metadata-loaded])');
        for (const link of links) {
            // Skip hidden links during search
            if (this.isSearchActive && link.classList.contains('search-hidden')) {
                continue;
            }

            const folder = link.dataset.folder;
            const filename = link.dataset.filename;
            const cacheKey = `${folder}/${filename}`;

            if (!this.metadataCache.has(cacheKey)) {
                try {
                    const metadataUrl = link.dataset.metadataUrl;
                    const response = await fetch(metadataUrl);
                    const metadata = await response.json();

                    this.metadataCache.set(cacheKey, metadata);
                    this.updateLinkDisplay(link, metadata);
                    this.reindexLink(link);
                    link.setAttribute('data-metadata-loaded', 'true');

                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`Failed to preload metadata for ${filename}:`, error);
                }
            }
        }
    }
}

// Global instance
const audioHandler = new AudioHandler();