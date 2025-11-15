/**
 * Discogs API Service
 * Handles searching Discogs database and checking user collection
 */
class DiscogsService {
    constructor() {
        this.hasToken = false;
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
                this.hasToken = config.hasToken;
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
                // Use server proxy to avoid CORS issues
                const proxyUrl = `/api/discogs-proxy?url=${encodeURIComponent(url)}`;

                // Add timeout for offline detection
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                const response = await fetch(proxyUrl, {
                    signal: controller.signal
                });
                clearTimeout(timeout);

                this.lastRequestTime = Date.now();

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
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
            // Remove vinyl/format-specific info (before other cleaning)
            .replace(/^\d+\s*inch\s*-\s*/gi, '') // "7 inch - " at start
            .replace(/^\d+"\s*-\s*/gi, '') // '7" - ' at start
            .replace(/\b\d+\s*inch\b/gi, '') // "7 inch" anywhere
            .replace(/\b\d+"\b/gi, '') // '7"' anywhere
            .replace(/\bvinyl\b/gi, '')
            .replace(/\bLP\b/gi, '')
            .replace(/\bEP\b/gi, '')
            // Remove B-side notation
            .replace(/\s*b\/w\s*.*/gi, '') // "b/w ..." (backed with) - removes everything after
            .replace(/\s*\(b-side:.*?\)/gi, '')
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
            // Clean up whitespace and dashes
            .replace(/\s*-\s*$/, '') // trailing dash
            .replace(/^\s*-\s*/, '') // leading dash
            .trim()
            .replace(/\s+/g, ' ');
    }

    /**
     * Check if title is a generic side marker
     */
    isGenericSideTitle(title) {
        if (!title) return true;

        const normalized = title.toLowerCase().trim();

        // Common patterns for full album sides
        return /^side\s*[a-d12]$/i.test(normalized) ||
               /^sidea$/i.test(normalized) ||
               /^sideb$/i.test(normalized) ||
               /^sidec$/i.test(normalized) ||
               /^sided$/i.test(normalized) ||
               normalized === 'side 1' ||
               normalized === 'side 2' ||
               normalized === 'side one' ||
               normalized === 'side two';
    }

    /**
     * Build smart search query based on available metadata
     */
    buildSearchQuery(metadata) {
        const artist = this.cleanString(metadata.artist);
        const album = this.cleanString(metadata.album);
        const rawTitle = this.cleanString(metadata.title);

        // Check if title is just a side marker (Side A, Side B, etc.)
        const isGenericSide = this.isGenericSideTitle(rawTitle);
        const title = isGenericSide ? null : rawTitle;

        const strategies = [];

        // Strategy 1: Artist + Album (best for full album sides or when we have album info)
        if (artist && album) {
            strategies.push({
                type: 'release',
                query: `"${artist}" "${album}"`,
                confidence: 'high',
                label: 'Album match'
            });
        }

        // Strategy 2: Artist + Track (only if title is NOT a generic side marker)
        if (artist && title && !isGenericSide) {
            strategies.push({
                type: 'release',
                query: `"${artist}" "${title}"`,
                confidence: 'medium',
                label: 'Track on release'
            });
        }

        // Strategy 3: Artist only (fallback)
        if (artist) {
            strategies.push({
                type: 'release',
                query: `"${artist}"`,
                confidence: 'low',
                label: 'Artist releases'
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
                console.log(`Discogs: Trying strategy "${strategy.label}":`, strategy.query);

                const data = await this.makeRequest(url);
                console.log(`Discogs: Got ${data.results?.length || 0} results for "${strategy.label}"`);

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
                    console.log('Discogs: Returning successful result');
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
     * Get track info: just search, no collection check
     */
    async getTrackInfo(metadata) {
        console.log('Discogs: Searching for', metadata);
        const searchResult = await this.search(metadata);
        console.log('Discogs: Search result', searchResult);

        if (!searchResult.success || searchResult.results.length === 0) {
            console.log('Discogs: No results found');
            return {
                found: false,
                searchResult
            };
        }

        const topResult = searchResult.results[0];
        console.log('Discogs: Top result', topResult);

        return {
            found: true,
            confidence: searchResult.confidence,
            strategy: searchResult.strategy,
            release: topResult,
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
