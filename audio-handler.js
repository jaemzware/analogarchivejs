// Enhanced audio-handler.js with metadata caching
class AudioHandler {
    constructor() {
        this.currentAudio = null;
        this.currentLink = null;
        this.currentMetadataDiv = null;
        // In-memory cache for B2 metadata (no localStorage in Claude.ai)
        this.metadataCache = new Map();
    }

    // Initialize B2 pages with cached metadata
    initializeB2Page() {
        const links = document.querySelectorAll('.link[data-folder]');
        links.forEach(link => {
            this.loadCachedMetadataForLink(link);
        });
    }

    // Load cached metadata for a specific link if available
    async loadCachedMetadataForLink(link) {
        const folder = link.dataset.folder;
        const filename = link.dataset.filename;
        const cacheKey = `${folder}/${filename}`;

        if (this.metadataCache.has(cacheKey)) {
            const metadata = this.metadataCache.get(cacheKey);
            this.updateLinkDisplay(link, metadata);
        }
    }

    // Update link display with metadata (to match root page style)
    updateLinkDisplay(link, metadata) {
        const artwork = metadata.artwork ?
            `data:image/jpeg;base64,${metadata.artwork}` : '';

        if (artwork) {
            link.style.backgroundImage = `url('${artwork}')`;
        }

        // Match the root page format: Artist Album Title (all on same line)
        link.innerHTML = `
            ${metadata.common?.artist || metadata.artist || 'Unknown Artist'}
            ${metadata.common?.album || metadata.album || 'Unknown Album'}  
            ${metadata.common?.title || metadata.title || link.dataset.filename}
        `;
    }

    async playAudio(audioSrc, link, metadataEndpoint = null) {
        console.log('Playing:', audioSrc);

        // ALWAYS stop any currently playing audio first
        if (this.currentAudio) {
            console.log('Stopping current audio');
            this.currentAudio.pause();
            this.currentAudio.src = ''; // Clear source to fully stop
            this.currentAudio.load(); // Reset the audio element
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

            let nextLink = link.nextElementSibling;
            if(nextLink != null){
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

        // Add loading state
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
                // For local files
                const filename = audioSrc.replace('music/', '');
                metadataUrl = `/localmetadata/${encodeURIComponent(filename)}`;
            } else {
                // For B2 files
                metadataUrl = audioSrc.replace('/b2proxy/', '/b2metadata/');
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
            // Keep loading state or show error
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

    // Method to preload metadata for visible links (optional enhancement)
    async preloadMetadataForVisibleLinks() {
        const links = document.querySelectorAll('.link[data-folder]:not([data-metadata-loaded])');
        for (const link of links) {
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
                    link.setAttribute('data-metadata-loaded', 'true');

                    // Add small delay to avoid overwhelming the server
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