/**
 * Discogs API Service
 * Handles searching Discogs database and checking user collection
 */
class DiscogsService {
    constructor() {
        this.apiToken = null;
        this.collectionUrl = null;
        this.username = null;
        this.cache = new Map();
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1100; // 60 requests/min = ~1000ms, adding buffer

        this.loadConfig();
    }

    /**
     * Load configuration from environment variables
     */
    async loadConfig() {
        try {
            const response = await fetch('/api/discogs-config');
            if (response.ok) {
                const config = await response.json();
                this.apiToken = config.token;
                this.collectionUrl = config.collectionUrl;

                // Extract username from collection URL
                // Format: https://www.discogs.com/user/USERNAME/collection
                const match = config.collectionUrl?.match(/\/user\/([^\/]+)/);
                if (match) {
                    this.username = match[1];
                }
            }
        } catch (error) {
            console.error('Failed to load Discogs config:', error);
        }
    }

    /**
     * Rate-limited API request
     */
    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ url, resolve, reject });
            this.processQueue();
        });
    }

    /**
     * Process queued requests with rate limiting
     */
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;

            if (timeSinceLastRequest < this.minRequestInterval) {
                await new Promise(resolve =>
                    setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
                );
            }

            const { url, resolve, reject } = this.requestQueue.shift();

            try {
                const headers = {
                    'User-Agent': 'AnalogArchive/1.0'
                };

                if (this.apiToken) {
                    headers['Authorization'] = `Discogs token=${this.apiToken}`;
                }

                // Add timeout for offline detection
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                const response = await fetch(url, {
                    headers,
                    signal: controller.signal
                });
                clearTimeout(timeout);

                this.lastRequestTime = Date.now();

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                resolve(data);
            } catch (error) {
                // Enhance error with network failure detection
                if (error.name === 'AbortError' || error.message.includes('fetch')) {
                    error.isNetworkError = true;
                }
                reject(error);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Clean and normalize search string
     */
    cleanString(str) {
        if (!str || str === 'undefined') return null;

        return str
            // Remove common metadata artifacts
            .replace(/\(remaster(ed)?\)/gi, '')
            .replace(/\[deluxe( edition)?\]/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?reissue.*?\)/gi, '')
            .replace(/\(.*?anniversary.*?\)/gi, '')
            .replace(/\s*-\s*bonus track/gi, '')
            // Handle featured artists
            .replace(/\s+ft\.?\s+/gi, ' ')
            .replace(/\s+feat\.?\s+/gi, ' ')
            .replace(/\s+featuring\s+/gi, ' ')
            // Clean up
            .trim()
            .replace(/\s+/g, ' ');
    }

    /**
     * Build smart search query based on available metadata
     */
    buildSearchQuery(metadata) {
        const artist = this.cleanString(metadata.artist);
        const album = this.cleanString(metadata.album);
        const title = this.cleanString(metadata.title);

        const strategies = [];

        // Strategy 1: Artist + Album (best for identifying releases)
        if (artist && album) {
            strategies.push({
                type: 'release',
                query: `artist:"${artist}" release_title:"${album}"`,
                confidence: 'high',
                label: 'Exact album match'
            });
        }

        // Strategy 2: Artist + Track (good for finding releases containing the track)
        if (artist && title) {
            strategies.push({
                type: 'release',
                query: `artist:"${artist}" track:"${title}"`,
                confidence: 'medium',
                label: 'Track on release'
            });
        }

        // Strategy 3: Artist only (fallback)
        if (artist) {
            strategies.push({
                type: 'artist',
                query: `artist:"${artist}"`,
                confidence: 'low',
                label: 'Artist search'
            });
        }

        // Strategy 4: Title only (last resort)
        if (title) {
            strategies.push({
                type: 'release',
                query: `"${title}"`,
                confidence: 'low',
                label: 'Title search'
            });
        }

        return strategies;
    }

    /**
     * Search Discogs database with smart fallback
     */
    async search(metadata) {
        const cacheKey = `search_${metadata.artist}_${metadata.album}_${metadata.title}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const strategies = this.buildSearchQuery(metadata);

        if (strategies.length === 0) {
            return {
                success: false,
                message: 'No searchable metadata available',
                results: []
            };
        }

        // Try each strategy until we get results
        for (const strategy of strategies) {
            try {
                const encodedQuery = encodeURIComponent(strategy.query);
                const url = `https://api.discogs.com/database/search?q=${encodedQuery}&type=${strategy.type}&per_page=5`;

                const data = await this.makeRequest(url);

                if (data.results && data.results.length > 0) {
                    const result = {
                        success: true,
                        strategy: strategy.label,
                        confidence: strategy.confidence,
                        results: data.results.map(r => ({
                            id: r.id,
                            title: r.title,
                            year: r.year,
                            format: r.format?.join(', '),
                            label: r.label?.join(', '),
                            coverImage: r.cover_image,
                            thumb: r.thumb,
                            resourceUrl: r.resource_url,
                            uri: r.uri,
                            type: r.type
                        }))
                    };

                    this.cache.set(cacheKey, result);
                    return result;
                }
            } catch (error) {
                console.error(`Discogs search failed for strategy "${strategy.label}":`, error);
            }
        }

        // No results from any strategy
        const result = {
            success: false,
            message: 'No matches found',
            results: []
        };

        this.cache.set(cacheKey, result);
        return result;
    }

    /**
     * Check if a release is in user's collection
     */
    async checkInCollection(releaseId) {
        if (!this.username) {
            return { inCollection: false, message: 'Username not configured' };
        }

        const cacheKey = `collection_${releaseId}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const url = `https://api.discogs.com/users/${this.username}/collection/folders/0/releases/${releaseId}`;
            const data = await this.makeRequest(url);

            const result = {
                inCollection: true,
                instanceId: data.id,
                dateAdded: data.date_added,
                rating: data.rating
            };

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            // 404 means not in collection
            if (error.message.includes('404')) {
                const result = { inCollection: false };
                this.cache.set(cacheKey, result);
                return result;
            }

            throw error;
        }
    }

    /**
     * Get full release details including tracklist
     */
    async getReleaseDetails(releaseId) {
        const cacheKey = `release_${releaseId}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const url = `https://api.discogs.com/releases/${releaseId}`;
            const data = await this.makeRequest(url);

            const result = {
                id: data.id,
                title: data.title,
                artists: data.artists?.map(a => a.name).join(', '),
                year: data.year,
                genres: data.genres,
                styles: data.styles,
                labels: data.labels?.map(l => l.name),
                formats: data.formats?.map(f => `${f.name}${f.descriptions ? ' (' + f.descriptions.join(', ') + ')' : ''}`),
                tracklist: data.tracklist,
                images: data.images,
                uri: data.uri,
                discogsUrl: `https://www.discogs.com${data.uri}`
            };

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Failed to get release details:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive info: search + collection check
     */
    async getTrackInfo(metadata) {
        const searchResult = await this.search(metadata);

        if (!searchResult.success || searchResult.results.length === 0) {
            return {
                found: false,
                searchResult
            };
        }

        // Check if the top result is in collection
        const topResult = searchResult.results[0];
        const collectionStatus = await this.checkInCollection(topResult.id);

        return {
            found: true,
            confidence: searchResult.confidence,
            strategy: searchResult.strategy,
            release: topResult,
            inCollection: collectionStatus.inCollection,
            collectionInfo: collectionStatus,
            allResults: searchResult.results
        };
    }

    /**
     * Build a Discogs search URL for manual searching
     */
    getSearchUrl(metadata) {
        const artist = this.cleanString(metadata.artist);
        const album = this.cleanString(metadata.album);
        const title = this.cleanString(metadata.title);

        let searchTerm = '';
        if (artist && album) {
            searchTerm = `${artist} ${album}`;
        } else if (artist && title) {
            searchTerm = `${artist} ${title}`;
        } else if (artist) {
            searchTerm = artist;
        } else if (title) {
            searchTerm = title;
        }

        return `https://www.discogs.com/search/?q=${encodeURIComponent(searchTerm)}&type=release`;
    }
}
