//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import 'dotenv/config';
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync, writeFileSync, unlinkSync} from 'fs';
import {join, extname} from 'path';
import * as url from 'url';
import express from 'express';
import B2 from 'backblaze-b2';
import {tmpdir} from 'os';

const app = express();
const port = process.env.PORT || 55557;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
//use self-signed certificate for localhost development
const options = {key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH)}
const directoryPathMusic = process.env.MUSIC_DIRECTORY || "./music";

// Cache for music files - always scans fresh on startup
let musicFilesCache = null;

// In-memory cache for B2 metadata - ephemeral, privacy-focused
const metadataCache = new Map();
const folderListingCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (configurable)

// Helper function to check if cache entry is still valid
function isCacheValid(cacheEntry) {
    return cacheEntry && (Date.now() - cacheEntry.timestamp) < CACHE_TTL_MS;
}

// Backblaze B2 configuration
const b2 = new B2({
    applicationKeyId: process.env.B2_APPLICATION_KEY_ID, // Set these in your environment
    applicationKey: process.env.B2_APPLICATION_KEY
});
const bucketName = process.env.B2_BUCKET_NAME;

// Helper to check if we have internet/B2 connectivity
async function checkB2Connectivity() {
    try {
        // Set a short timeout for the connection check
        await Promise.race([
            b2.authorize(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 5000)
            )
        ]);
        return { connected: true };
    } catch (err) {
        console.log('B2 connectivity check failed:', err.message);
        // Determine if it's a network error or auth error
        const isNetworkError = 
            err.code === 'ENOTFOUND' || 
            err.code === 'ECONNREFUSED' || 
            err.code === 'ETIMEDOUT' ||
            err.code === 'EAI_AGAIN' ||
            err.message.includes('timeout') ||
            err.message.includes('network') ||
            err.message.toLowerCase().includes('getaddrinfo');
        
        return { 
            connected: false, 
            isNetworkError,
            error: err.message 
        };
    }
}

// Generate offline error page
function generateOfflinePage(folderName) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>analogarchivejs - ${folderName.charAt(0).toUpperCase() + folderName.slice(1)} (Offline)</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        .offline-container {
            max-width: 600px;
            margin: 100px auto;
            padding: 40px;
            text-align: center;
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        .offline-icon {
            font-size: 80px;
            margin-bottom: 20px;
        }
        .offline-title {
            color: #fff;
            font-size: 32px;
            margin-bottom: 15px;
            font-weight: bold;
        }
        .offline-message {
            color: #cce5ff;
            font-size: 18px;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .offline-details {
            background: rgba(0,0,0,0.2);
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            text-align: left;
        }
        .offline-details h3 {
            color: #fff;
            margin-top: 0;
            font-size: 18px;
        }
        .offline-details ul {
            color: #cce5ff;
            list-style-type: none;
            padding-left: 0;
        }
        .offline-details li {
            margin: 10px 0;
            padding-left: 25px;
            position: relative;
        }
        .offline-details li:before {
            content: "\\2022";
            position: absolute;
            left: 0;
            color: #4CAF50;
        }
        .back-button {
            display: inline-block;
            padding: 12px 30px;
            background-color: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        .back-button:hover {
            background-color: #45a049;
        }
        .nav-links {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.2);
        }
        .nav-links a {
            color: #cce5ff;
            text-decoration: none;
            margin: 0 15px;
        }
        .nav-links a:hover {
            color: #fff;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">&#127794;&#128225;</div>
        <h1 class="offline-title">No Internet Gateway</h1>
        <p class="offline-message">
            You're connected to the local WiFi access point, but there's no internet connection available. 
            Cloud storage locations (/${folderName}) require internet access.
        </p>
        
        <div class="offline-details">
            <h3>What's Still Available:</h3>
            <ul>
                <li>Local music collection works perfectly</li>
                <li>All locally stored files are accessible</li>
                <li>Full playback and metadata features</li>
            </ul>
        </div>

        <p style="color: #cce5ff; font-size: 14px; margin-bottom: 20px;">
            <strong>Why this happens:</strong><br>
            The /${folderName} endpoint streams from Backblaze B2 cloud storage, which requires an active internet connection. 
            When serving from a wireless access point without internet (like "in the woods"), only local storage is available.
        </p>

        <a href="/" class="back-button">View Local Music</a>
        
        <div class="nav-links">
            <a href="/">Local Music</a> |
            <a href="/analog">Analog (Offline)</a> |
            <a href="/live">Live (Offline)</a> |
            <a href="/digital">Digital (Offline)</a>
        </div>
    </div>
</body>
</html>`;
}

//make files available in music subdirectory
const musicStaticPath = directoryPathMusic.startsWith('./')
    ? join(__dirname, directoryPathMusic.substring(2))
    : directoryPathMusic;
app.use('/music', express.static(musicStaticPath, {
    setHeaders: (res, path) => {
        // Set proper content-type headers to prevent download prompts
        if (path.toLowerCase().endsWith('.flac')) {
            res.set('Content-Type', 'audio/flac');
        } else if (path.toLowerCase().endsWith('.m4b')) {
            res.set('Content-Type', 'audio/mp4');
        } else if (path.toLowerCase().endsWith('.mp3')) {
            res.set('Content-Type', 'audio/mpeg');
        }
        // Allow range requests for seeking
        res.set('Accept-Ranges', 'bytes');
    }
}));
app.get('/favicon.ico', function(req,res){
    res.sendFile(__dirname + '/favicon.ico');
});
app.get('/styles.css', function(req, res) {
    res.set('Content-Type', 'text/css');
    res.sendFile(__dirname + '/styles.css');
});
app.get('/audio-handler.js', function(req, res) {
    res.set('Content-Type', 'application/javascript');
    res.sendFile(__dirname + '/audio-handler.js');
});
app.get('/discogs-service.js', function(req, res) {
    res.set('Content-Type', 'application/javascript');
    res.sendFile(__dirname + '/discogs-service.js');
});

// Cloud connectivity status endpoint
app.get('/api/cloud-status', async (req, res) => {
    const connectivity = await checkB2Connectivity();
    res.json({
        online: connectivity.connected,
        isNetworkError: connectivity.isNetworkError || false
    });
});

// Discogs configuration endpoint
app.get('/api/discogs-config', function(req, res) {
    res.json({
        hasToken: !!process.env.DISCOGS_API_TOKEN,
        collectionUrl: process.env.DISCOGS_COLLECTION_URL
    });
});

// Discogs API proxy endpoint
app.get('/api/discogs-proxy', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }

        // Verify it's a Discogs API URL
        if (!url.startsWith('https://api.discogs.com/')) {
            return res.status(400).json({ error: 'Invalid Discogs API URL' });
        }

        const headers = {
            'User-Agent': 'AnalogArchive/1.0'
        };

        if (process.env.DISCOGS_API_TOKEN) {
            headers['Authorization'] = `Discogs token=${process.env.DISCOGS_API_TOKEN}`;
        }

        const response = await fetch(url, { headers });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('Discogs proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Local metadata endpoint for root endpoint files
app.get('/localmetadata/:filename(.*)', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = join(directoryPathMusic, filename);

        console.log(`Getting local metadata for: ${filePath}`);

        // Parse metadata from local file
        const fileExt = extname(filePath).toLowerCase();
        let mimeType;
        if (fileExt === '.flac') {
            mimeType = 'audio/flac';
        } else if (fileExt === '.m4b') {
            mimeType = 'audio/mp4';
        } else {
            mimeType = 'audio/mpeg';
        }
        const metadata = await parseFile(filePath, { mimeType });
        const artwork = await extractArtwork(filePath);

        console.log('Local metadata parsed successfully');
        console.log('Artist:', metadata.common.artist);
        console.log('Title:', metadata.common.title);
        console.log('Album:', metadata.common.album);

        // Return metadata as JSON
        res.json({
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            title: metadata.common.title || filename,
            artwork: artwork,
            duration: metadata.format.duration || 0
        });
    } catch (err) {
        console.error('Error getting local metadata:', err);
        res.status(500).json({ error: 'Local metadata extraction failed', message: err.message });
    }
});

// Metadata endpoint to get song info from B2 files
app.get('/b2metadata/:folder/:filename(*)', async (req, res) => {
    try {
        await b2.authorize();
        const folder = req.params.folder;
        const filename = decodeURIComponent(req.params.filename);
        const fullPath = `${folder}/${filename}`;

        console.log(`Getting metadata for: ${fullPath}`);

        // Check cache first
        const cacheKey = fullPath;
        const cachedData = metadataCache.get(cacheKey);
        if (isCacheValid(cachedData)) {
            console.log(`✓ Cache hit for metadata: ${fullPath}`);
            return res.json(cachedData.data);
        }
        console.log(`✗ Cache miss for metadata: ${fullPath}`);

        // Download only first 10MB for metadata extraction (includes artwork)
        // Metadata and album art are typically in the first few MB of audio files
        console.log(`Downloading first 10MB for metadata extraction`);

        const METADATA_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

        // Download file from B2 with range header
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer',
            axios: {
                headers: {
                    'Range': `bytes=0-${METADATA_CHUNK_SIZE - 1}`
                }
            }
        });

        // The actual file data is in fileData.data, but we need to handle the response correctly
        const rawData = fileData.data;

        if (rawData) {
            // Convert to buffer for metadata parsing
            let buffer;
            if (Buffer.isBuffer(rawData)) {
                buffer = rawData;
            } else if (rawData instanceof ArrayBuffer) {
                buffer = Buffer.from(rawData);
            } else if (rawData instanceof Uint8Array) {
                buffer = Buffer.from(rawData);
            } else if (typeof rawData === 'object' && rawData.data) {
                // Handle nested data structure
                if (Buffer.isBuffer(rawData.data)) {
                    buffer = rawData.data;
                } else if (rawData.data instanceof ArrayBuffer) {
                    buffer = Buffer.from(rawData.data);
                } else if (rawData.data instanceof Uint8Array) {
                    buffer = Buffer.from(rawData.data);
                } else {
                    buffer = Buffer.from(rawData.data);
                }
            } else {
                buffer = Buffer.from(rawData);
            }

            console.log(`Buffer size: ${buffer.length} bytes`);

            // Write buffer to temporary file and use parseFile instead of parseBuffer
            const lowerPath = fullPath.toLowerCase();
            const isFlac = lowerPath.endsWith('.flac');
            const isM4b = lowerPath.endsWith('.m4b');
            let fileExt = '.mp3';
            if (isFlac) fileExt = '.flac';
            if (isM4b) fileExt = '.m4b';
            const tempFilePath = join(tmpdir(), `b2-temp-${Date.now()}${fileExt}`);

            try {
                writeFileSync(tempFilePath, buffer);

                let mimeType;
                if (isFlac) {
                    mimeType = 'audio/flac';
                } else if (isM4b) {
                    mimeType = 'audio/mp4';
                } else {
                    mimeType = 'audio/mpeg';
                }
                const metadata = await parseFile(tempFilePath, {
                    duration: true,
                    skipCovers: false,
                    mimeType
                });

                console.log('Metadata parsed successfully');
                console.log('Artist:', metadata.common.artist);
                console.log('Title:', metadata.common.title);
                console.log('Album:', metadata.common.album);
                // console.log('Picture array:', metadata.common.picture);

                // Extract artwork with better error handling
                let artwork = "";
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                    const picture = metadata.common.picture[0];
                    // console.log('Picture object:', picture);
                    // console.log('Picture data type:', typeof picture.data);
                    // console.log('Picture data is Buffer:', Buffer.isBuffer(picture.data));
                    // console.log('Picture data is Uint8Array:', picture.data instanceof Uint8Array);

                    if (picture.data) {
                        // Handle both Buffer and Uint8Array
                        if (Buffer.isBuffer(picture.data)) {
                            artwork = picture.data.toString('base64');
                        } else if (picture.data instanceof Uint8Array) {
                            artwork = Buffer.from(picture.data).toString('base64');
                        } else {
                            artwork = Buffer.from(picture.data).toString('base64');
                        }
                        console.log('Artwork extracted, size:', artwork.length);
                    } else {
                        console.log('Picture data is empty');
                    }
                } else {
                    console.log('No artwork found in metadata');
                }

                // Prepare metadata response
                const metadataResponse = {
                    artist: metadata.common.artist || 'Unknown Artist',
                    album: metadata.common.album || 'Unknown Album',
                    title: metadata.common.title || filename,
                    artwork: artwork,
                    duration: metadata.format.duration || 0
                };

                // Cache the successful response
                metadataCache.set(cacheKey, {
                    data: metadataResponse,
                    timestamp: Date.now()
                });
                console.log(`✓ Cached metadata for: ${fullPath}`);

                // Return metadata as JSON
                res.json(metadataResponse);
            } catch (tempFileError) {
                console.error('Error with temp file approach:', tempFileError);
                throw tempFileError;
            } finally {
                // Always clean up temp file
                try {
                    unlinkSync(tempFilePath);
                    console.log('Temp file cleaned up:', tempFilePath);
                } catch (cleanupError) {
                    console.error('Error cleaning up temp file:', cleanupError.message);
                }
            }
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        console.error('Error getting metadata:', err);
        res.status(500).json({ error: 'Metadata extraction failed', message: err.message });
    }
});

// Proxy endpoint to serve B2 files and avoid CORS issues
app.get('/b2proxy/:folder/:filename(*)', async (req, res) => {
    try {
        console.log('=== B2 Proxy Request Start ===');
        console.log(`Folder: ${req.params.folder}`);
        console.log(`Filename param: ${req.params.filename}`);

        await b2.authorize();
        const folder = req.params.folder;
        const filename = decodeURIComponent(req.params.filename);
        const fullPath = `${folder}/${filename}`;

        console.log(`Decoded filename: ${filename}`);
        console.log(`Full path: ${fullPath}`);

        // First, get file info to know the content length
        const bucket = await b2.getBucket({ bucketName });
        const bucketId = bucket.data.buckets[0].bucketId;

        const fileInfo = await b2.listFileNames({
            bucketId: bucketId,
            startFileName: fullPath,
            maxFileCount: 1,
            prefix: fullPath
        });

        if (!fileInfo.data.files || fileInfo.data.files.length === 0) {
            return res.status(404).send('File not found');
        }

        const fileSize = fileInfo.data.files[0].contentLength;
        console.log(`File size: ${fileSize} bytes`);

        // Set appropriate headers based on file extension
        const lowerFullPath = fullPath.toLowerCase();
        let contentType;
        if (lowerFullPath.endsWith('.flac')) {
            contentType = 'audio/flac';
        } else if (lowerFullPath.endsWith('.m4b')) {
            contentType = 'audio/mp4';
        } else {
            contentType = 'audio/mpeg';
        }
        res.set('Content-Type', contentType);
        res.set('Content-Length', fileSize);
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Access-Control-Allow-Origin', '*');

        // Stream the file from B2 instead of loading into memory
        console.log('Starting B2 download stream...');
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'stream'  // Stream to avoid loading entire file in memory
        });

        console.log(`Download stream initiated`);

        // Pipe the stream directly to the response
        if (fileData.data) {
            fileData.data.pipe(res);
            fileData.data.on('end', () => {
                console.log('=== B2 Proxy Request Success ===');
            });
            fileData.data.on('error', (streamErr) => {
                console.error('Stream error:', streamErr);
                if (!res.headersSent) {
                    res.status(500).end();
                }
            });
        } else {
            console.error('No file data stream in response');
            res.status(404).send('File data not found');
        }
    } catch (err) {
        console.error('=== B2 Proxy Request Error ===');
        console.error('Error type:', err.constructor.name);
        console.error('Error message:', err.message);
        console.error('Error status:', err.status);
        console.error('Error response:', err.response?.data);
        console.error('Full error stack:', err.stack);

        // Don't crash the server, send error response
        try {
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Proxy error',
                    message: err.message,
                    file: req.params.filename
                });
            }
        } catch (sendError) {
            console.error('Error sending error response:', sendError);
        }
        console.error('=== B2 Proxy Request Error End ===');
    }
});

// Helper function to recursively find all music files in a directory
async function findMusicFiles(dir, baseDir = dir, files = []) {
    const items = await promises.readdir(dir);

    for (const item of items) {
        // Skip macOS and Windows metadata files BEFORE trying to stat them
        if (item.startsWith('._') || item.startsWith('.__') ||
            item === '.DS_Store' || item.toLowerCase() === 'desktop.ini' ||
            item.toLowerCase() === 'thumbs.db') {
            continue;
        }

        const fullPath = join(dir, item);
        const stats = await promises.stat(fullPath);

        if (stats.isDirectory()) {
            await findMusicFiles(fullPath, baseDir, files);
        } else if (stats.isFile() && ['.mp3', '.flac', '.m4b'].includes(extname(fullPath).toLowerCase())) {
            // Get the relative path from the base directory
            // Normalize baseDir to handle path.join's normalization
            const normalizedBaseDir = join(baseDir);
            const relativePath = fullPath.substring(normalizedBaseDir.length + 1);
            // Extract folder name (empty string if in root)
            const folderPath = relativePath.includes('/')
                ? relativePath.substring(0, relativePath.lastIndexOf('/'))
                : '';

            files.push({
                fullPath,
                relativePath,
                fileName: item,
                folderPath
            });
        }
    }

    return files;
}

// Rescan endpoint
app.get('/rescan', async (req, res) => {
    try {
        console.log('Manual rescan triggered');
        await scanMusicFiles();
        res.json({
            success: true,
            fileCount: musicFilesCache ? musicFilesCache.length : 0,
            message: 'Rescan completed successfully'
        });
    } catch (err) {
        console.error('Rescan failed:', err);
        res.status(500).json({
            success: false,
            error: 'Rescan failed',
            message: err.message
        });
    }
});

// Rescan B2 bucket folder (clear cache to force fresh fetch)
app.get('/rescan-b2/:folder', async (req, res) => {
    try {
        const folderName = req.params.folder;

        // Validate folder name
        if (folderName !== 'analog' && folderName !== 'live' && folderName !== 'digital') {
            return res.status(400).json({
                success: false,
                error: 'Invalid folder',
                message: 'Folder must be "analog", "live", or "digital"'
            });
        }

        console.log(`Manual B2 rescan triggered for folder: ${folderName}`);

        // Clear the cache for this folder
        const folderCacheKey = folderName;
        folderListingCache.delete(folderCacheKey);
        console.log(`✓ Cleared cache for folder: ${folderName}`);

        res.json({
            success: true,
            folder: folderName,
            message: `B2 cache cleared for ${folderName}. Fresh data will be fetched on next page load.`
        });
    } catch (err) {
        console.error('B2 rescan failed:', err);
        res.status(500).json({
            success: false,
            error: 'B2 rescan failed',
            message: err.message
        });
    }
});

// API endpoint to get all files for search
app.get('/api/all-files', async (req, res) => {
    try {
        if (!musicFilesCache) {
            res.status(503).json({
                success: false,
                error: 'Music library not yet scanned'
            });
            return;
        }

        // Return all files with necessary metadata for search
        const files = musicFilesCache.map(fileInfo => ({
            fileName: fileInfo.fileName,
            relativePath: fileInfo.relativePath,
            folderPath: fileInfo.folderPath
        }));

        res.json({
            success: true,
            files: files,
            total: files.length
        });
    } catch (err) {
        console.error('Failed to get all files:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve files'
        });
    }
});

// API endpoint to get all files from a B2 folder for search functionality
app.get('/api/all-b2-files/:folder', async (req, res) => {
    try {
        const folderName = req.params.folder;

        // Validate folder name (only allow 'analog', 'live', or 'digital')
        if (folderName !== 'analog' && folderName !== 'live' && folderName !== 'digital') {
            res.status(400).json({
                success: false,
                error: 'Invalid folder name. Must be "analog", "live", or "digital".'
            });
            return;
        }

        // Check if B2 credentials are configured
        if (!process.env.B2_APPLICATION_KEY_ID || !process.env.B2_APPLICATION_KEY || !process.env.B2_BUCKET_NAME ||
            process.env.B2_APPLICATION_KEY_ID === '' || process.env.B2_APPLICATION_KEY === '' || process.env.B2_BUCKET_NAME === '') {
            res.status(503).json({
                success: false,
                error: 'B2 credentials not configured'
            });
            return;
        }

        await b2.authorize();

        // Check cache first for folder listings (reuse same cache as handleB2FolderEndpoint)
        const folderCacheKey = folderName;
        const cachedFolderData = folderListingCache.get(folderCacheKey);
        let b2Files;

        if (isCacheValid(cachedFolderData)) {
            console.log(`✓ Cache hit for API folder listing: ${folderName}`);
            // Remove fullB2Path for API response (not needed)
            b2Files = cachedFolderData.data.map(file => ({
                fileName: file.fileName,
                relativePath: file.relativePath,
                folderPath: file.folderPath
            }));
        } else {
            console.log(`✗ Cache miss for API folder listing: ${folderName}`);

            const bucket = await b2.getBucket({ bucketName });
            const bucketId = bucket.data.buckets[0].bucketId;

            const response = await b2.listFileNames({
                bucketId: bucketId,
                startFileName: `${folderName}/`,
                prefix: `${folderName}/`,
                maxFileCount: 10000
            });

            // Parse B2 files and extract directory structure
            const b2FilesWithFullPath = [];
            for (const file of response.data.files) {
                const lowerFileName = file.fileName.toLowerCase();
                if ((lowerFileName.endsWith('.mp3') || lowerFileName.endsWith('.flac') || lowerFileName.endsWith('.m4b')) && file.fileName !== `${folderName}/`) {
                    // Remove the folderName prefix to get the relative path
                    const relativePath = file.fileName.substring(folderName.length + 1);
                    const fileName = relativePath.split('/').pop();
                    const folderPath = relativePath.includes('/')
                        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
                        : '';

                    b2FilesWithFullPath.push({
                        fileName: fileName,
                        relativePath: relativePath,
                        folderPath: folderPath,
                        fullB2Path: file.fileName
                    });
                }
            }

            // Cache the folder listing (with fullB2Path for handleB2FolderEndpoint compatibility)
            folderListingCache.set(folderCacheKey, {
                data: b2FilesWithFullPath,
                timestamp: Date.now()
            });
            console.log(`✓ Cached API folder listing for: ${folderName} (${b2FilesWithFullPath.length} files)`);

            // Remove fullB2Path for API response
            b2Files = b2FilesWithFullPath.map(file => ({
                fileName: file.fileName,
                relativePath: file.relativePath,
                folderPath: file.folderPath
            }));
        }

        res.json({
            success: true,
            files: b2Files,
            total: b2Files.length,
            folder: folderName
        });
    } catch (err) {
        console.error('Failed to get B2 files:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve B2 files'
        });
    }
});

// Helper function to build directory structure
function buildDirectoryStructure(musicFiles) {
    const structure = new Map();

    // Initialize root directory
    if (!structure.has('__root__')) {
        structure.set('__root__', { files: [], subdirs: new Set() });
    }

    musicFiles.forEach(fileInfo => {
        const parts = fileInfo.folderPath ? fileInfo.folderPath.split('/') : [];

        if (parts.length === 0) {
            // Files in root directory
            structure.get('__root__').files.push(fileInfo);
        } else {
            // Files in subdirectories
            const topLevel = parts[0];

            // Add top-level directory to root's subdirs
            structure.get('__root__').subdirs.add(topLevel);

            // Track top-level directory
            if (!structure.has(topLevel)) {
                structure.set(topLevel, { files: [], subdirs: new Set(), hasChildren: parts.length > 1 });
            }

            // Track that this top-level has subdirectories if needed
            if (parts.length > 1) {
                structure.get(topLevel).hasChildren = true;
            }

            // For all subdirectory paths (including top-level)
            for (let i = 1; i <= parts.length; i++) {
                const currentPath = parts.slice(0, i).join('/');
                if (!structure.has(currentPath)) {
                    structure.set(currentPath, { files: [], subdirs: new Set() });
                }

                // Add files that are directly in this path
                if (i === parts.length) {
                    structure.get(currentPath).files.push(fileInfo);
                }

                // Track subdirectories
                if (i < parts.length) {
                    const nextPath = parts.slice(0, i + 1).join('/');
                    structure.get(currentPath).subdirs.add(parts[i]);
                }
            }
        }
    });

    return structure;
}

// Original local music endpoint with directory navigation
app.get('/', async (req,res) =>{
    try {
        // If cache isn't ready yet, show loading page
        if (!musicFilesCache) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html>
<head>
    <title>analogarchivejs</title>
    <link rel="stylesheet" href="styles.css">
    <meta http-equiv="refresh" content="2">
</head>
<body>
<div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9); color: lime; padding: 30px 50px;
            border: 2px solid lime; border-radius: 10px; font-size: 24px; text-align: center;">
    Scanning music library...<br>
    <span style="font-size: 14px; opacity: 0.7;">Page will refresh automatically</span>
</div>
</body>
</html>`);
            return;
        }

        console.log(`Using cached file list (${musicFilesCache.length} files)`);
        const musicFiles = musicFilesCache;

        // If no music files found, show helpful message
        if (musicFiles.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html>
<head>
    <title>analogarchivejs</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
<div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9); color: lime; padding: 30px 50px;
            border: 2px solid lime; border-radius: 10px; font-size: 24px; text-align: center;">
    No music folder found<br>
    <span style="font-size: 14px; opacity: 0.7;">Create a "${directoryPathMusic}" directory or symlink</span>
</div>
</body>
</html>`);
            return;
        }

        // Get current directory from query parameter
        const currentPath = req.query.dir || '';

        // Build directory structure
        const dirStructure = buildDirectoryStructure(musicFiles);

        // Get content for current directory
        let currentContent;
        if (currentPath === '') {
            // Root level - show top-level directories and root files
            currentContent = { files: [], subdirs: [] };

            // Add root files if any
            if (dirStructure.has('__root__')) {
                currentContent.files = dirStructure.get('__root__').files;
            }

            // Add top-level directories
            dirStructure.forEach((value, key) => {
                if (key !== '__root__' && !key.includes('/')) {
                    currentContent.subdirs.push(key);
                }
            });
        } else {
            // Show contents of specific directory
            if (dirStructure.has(currentPath)) {
                const dirInfo = dirStructure.get(currentPath);
                currentContent = {
                    files: dirInfo.files,
                    subdirs: Array.from(dirInfo.subdirs || [])
                };
            } else {
                currentContent = { files: [], subdirs: [] };
            }
        }

        // Sort files and folders
        currentContent.subdirs.sort();
        currentContent.files.sort((a, b) => a.fileName.localeCompare(b.fileName));

        // Send header immediately
        res.writeHead(200, { 'Content-Type': 'text/html' });

        // Build breadcrumb path
        const pathParts = currentPath ? currentPath.split('/') : [];
        let breadcrumbHtml = pathParts.length > 0
            ? '<a href="/" class="breadcrumb-link">Local Music</a>'
            : '<span class="breadcrumb-current">Local Music</span>';
        let buildPath = '';
        pathParts.forEach((part, index) => {
            buildPath += (buildPath ? '/' : '') + part;
            const isLast = index === pathParts.length - 1;
            if (isLast) {
                breadcrumbHtml += ` / <span class="breadcrumb-current">${part}</span>`;
            } else {
                breadcrumbHtml += ` / <a href="/?dir=${encodeURIComponent(buildPath)}" class="breadcrumb-link">${part}</a>`;
            }
        });

        // Send HTML head right away
        res.write(`<html>
<head>
    <title>analogarchivejs - ${currentPath || 'Local Music'}</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<nav class="top-nav">
    <div class="top-nav-left">
        <div class="source-selector" id="sourceSelector">
            <button class="source-selector-button" id="sourceSelectorButton">
                <span class="source-selector-icon">&#x1F4BF;</span>
                <span class="source-selector-text">Local Music</span>
                <span class="source-selector-arrow">&#x25BC;</span>
            </button>
            <div class="source-selector-dropdown">
                <a href="/" class="source-selector-option active">
                    <span class="source-option-icon">&#x1F4BF;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Local Music</span>
                        <span class="source-option-location">On Device</span>
                    </span>
                    <span class="source-option-status local">&#x25CF;</span>
                </a>
                <a href="/analog" class="source-selector-option">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Analog</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
                <a href="/live" class="source-selector-option">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Live</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
                <a href="/digital" class="source-selector-option">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Digital</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
            </div>
        </div>
    </div>
    <div class="breadcrumb">${breadcrumbHtml}</div>
</nav>
<div class="container">
`);

        // Stream subdirectories first
        let chunk = '';
        for (const subdir of currentContent.subdirs) {
            const subdirPath = currentPath ? `${currentPath}/${subdir}` : subdir;
            chunk += `
            <div class="song-row folder-row">
                <a href="/?dir=${encodeURIComponent(subdirPath)}" class="folder-link">
                ${subdir}
                </a>
            </div>`;
        }

        // Stream file links
        for (let i = 0; i < currentContent.files.length; i++) {
            const fileInfo = currentContent.files[i];

            // Encode path for direct file access
            const encodedPath = fileInfo.relativePath.split('/').map(part => encodeURIComponent(part)).join('/');
            const directUrl = `/music/${encodedPath}`;

            chunk += `
            <div class="song-row">
                <a class="link"
                   data-filename="${fileInfo.fileName}"
                   data-folder="${fileInfo.folderPath}"
                   data-relative-path="${fileInfo.relativePath}"
                   data-audio-type="local">
                ${fileInfo.fileName}
                </a>
                <a class="direct-link" href="${directUrl}" title="Direct link to file">&#128279;</a>
            </div>`;

            // Send in chunks of 50 to improve streaming
            if (i % 50 === 0 && chunk.length > 0) {
                res.write(chunk);
                chunk = '';
            }
        }

        // Write any remaining chunk
        if (chunk.length > 0) {
            res.write(chunk);
        }

        // Send footer
        res.write(`</div>
<script src="/discogs-service.js"></script>
<script src="/audio-handler.js"></script>
<script>
    // Source selector dropdown
    (function() {
        const selector = document.getElementById('sourceSelector');
        const button = document.getElementById('sourceSelectorButton');

        if (selector && button) {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                selector.classList.toggle('open');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', function(e) {
                if (!selector.contains(e.target)) {
                    selector.classList.remove('open');
                }
            });
        }

        // Check cloud connectivity status
        async function updateCloudStatus() {
            try {
                const response = await fetch('/api/cloud-status');
                const data = await response.json();

                // Update all cloud endpoint status indicators
                const cloudStatuses = document.querySelectorAll('.source-option-status.online, .source-option-status.offline');
                cloudStatuses.forEach(status => {
                    if (!status.classList.contains('local')) {
                        if (data.online) {
                            status.className = 'source-option-status online';
                        } else {
                            status.className = 'source-option-status offline';
                        }
                    }
                });
            } catch (error) {
                // If fetch fails, mark as offline
                const cloudStatuses = document.querySelectorAll('.source-option-status.online, .source-option-status.offline');
                cloudStatuses.forEach(status => {
                    if (!status.classList.contains('local')) {
                        status.className = 'source-option-status offline';
                    }
                });
            }
        }

        // Check status on load
        updateCloudStatus();

        // Check status every 30 seconds
        setInterval(updateCloudStatus, 30000);
    })();

    window.addEventListener('DOMContentLoaded', function() {
        audioHandler.initializePage();
    });
</script>
</body></html>`);

        res.end();
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

app.get('/analog', async (req, res) => {
    await handleB2FolderEndpoint('analog', req, res);
});

app.get('/live', async (req, res) => {
    await handleB2FolderEndpoint('live', req, res);
});

app.get('/digital', async (req, res) => {
    await handleB2FolderEndpoint('digital', req, res);
});

// Shared function for B2 folder endpoints with enhanced search support and directory structure
async function handleB2FolderEndpoint(folderName, req, res) {
    try {
        // Check if B2 credentials are configured
        if (!process.env.B2_APPLICATION_KEY_ID || !process.env.B2_APPLICATION_KEY || !process.env.B2_BUCKET_NAME ||
            process.env.B2_APPLICATION_KEY_ID === '' || process.env.B2_APPLICATION_KEY === '' || process.env.B2_BUCKET_NAME === '') {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head>
                    <title>Configuration Error</title>
                    <link rel="stylesheet" href="styles.css">
                </head>
                <body>
                    <div class="container">
                        <h1>B2 Configuration Missing</h1>
                        <p>Backblaze B2 credentials are not configured. Please set the following environment variables:</p>
                        <ul>
                            <li>B2_APPLICATION_KEY_ID</li>
                            <li>B2_APPLICATION_KEY</li>
                            <li>B2_BUCKET_NAME</li>
                        </ul>
                    </div>
                </body>
                </html>
            `);
            return;
        }

        // Check internet connectivity before attempting to use B2
        console.log('Checking B2 connectivity...');
        const connectivity = await checkB2Connectivity();
        
        if (!connectivity.connected) {
            if (connectivity.isNetworkError) {
                // Show friendly offline page for network errors (no internet gateway)
                console.log(`No internet gateway - showing offline page for /${folderName}`);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(generateOfflinePage(folderName));
                return;
            } else {
                // Show technical error for auth/config issues
                console.error('B2 authentication error:', connectivity.error);
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <head>
                        <title>B2 Connection Error</title>
                        <link rel="stylesheet" href="styles.css">
                    </head>
                    <body>
                        <div class="container">
                            <h1>B2 Authentication Error</h1>
                            <p>Unable to connect to Backblaze B2: ${connectivity.error}</p>
                            <p>Please check your B2 credentials and try again.</p>
                            <p><a href="/">Back to Local Music</a></p>
                        </div>
                    </body>
                    </html>
                `);
                return;
            }
        }
        
        console.log('✓ B2 connection successful');

        await b2.authorize();

        // Check cache first for folder listings
        const folderCacheKey = folderName;
        const cachedFolderData = folderListingCache.get(folderCacheKey);
        let b2Files;

        if (isCacheValid(cachedFolderData)) {
            console.log(`✓ Cache hit for folder listing: ${folderName}`);
            b2Files = cachedFolderData.data;
        } else {
            console.log(`✗ Cache miss for folder listing: ${folderName}`);

            const bucket = await b2.getBucket({ bucketName });
            const bucketId = bucket.data.buckets[0].bucketId;
            console.log(`Using bucket ID: ${bucketId}`);

            const response = await b2.listFileNames({
                bucketId: bucketId,
                startFileName: `${folderName}/`,
                prefix: `${folderName}/`,
                maxFileCount: 10000
            });

            console.log(`Found ${response.data.files.length} files in ${folderName} folder`);

            // Parse B2 files and extract directory structure
            b2Files = [];
            for (const file of response.data.files) {
                const lowerFileName = file.fileName.toLowerCase();
                if ((lowerFileName.endsWith('.mp3') || lowerFileName.endsWith('.flac') || lowerFileName.endsWith('.m4b')) && file.fileName !== `${folderName}/`) {
                    // Remove the folderName prefix to get the relative path
                    const relativePath = file.fileName.substring(folderName.length + 1);
                    const fileName = relativePath.split('/').pop();
                    const folderPath = relativePath.includes('/')
                        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
                        : '';

                    b2Files.push({
                        fileName: fileName,
                        relativePath: relativePath,
                        folderPath: folderPath,
                        fullB2Path: file.fileName // Keep the full B2 path for proxy URLs
                    });
                }
            }

            // Cache the folder listing
            folderListingCache.set(folderCacheKey, {
                data: b2Files,
                timestamp: Date.now()
            });
            console.log(`✓ Cached folder listing for: ${folderName} (${b2Files.length} files)`);
        }

        // Get the current directory from query parameter (relative to the folderName root)
        const currentDir = req.query.dir || '';

        // Build directory structure using the existing function
        const dirStructure = buildDirectoryStructure(b2Files);

        // Determine which directory to display
        const displayDir = currentDir || '__root__';
        const currentDirData = dirStructure.get(displayDir);

        if (!currentDirData) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('Directory not found');
            return;
        }

        // Build breadcrumb navigation
        const folderDisplayName = folderName.charAt(0).toUpperCase() + folderName.slice(1);
        let breadcrumbHtml = currentDir
            ? `<a href="/${folderName}" class="breadcrumb-link">${folderDisplayName}</a>`
            : `<span class="breadcrumb-current">${folderDisplayName}</span>`;

        if (currentDir) {
            const pathParts = currentDir.split('/');
            let accumulatedPath = '';
            for (let i = 0; i < pathParts.length; i++) {
                accumulatedPath += (i > 0 ? '/' : '') + pathParts[i];
                const isLast = i === pathParts.length - 1;
                if (isLast) {
                    breadcrumbHtml += ` / <span class="breadcrumb-current">${pathParts[i]}</span>`;
                } else {
                    breadcrumbHtml += ` / <a href="/${folderName}?dir=${encodeURIComponent(accumulatedPath)}" class="breadcrumb-link">${pathParts[i]}</a>`;
                }
            }
        }

        // Start HTML response
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(`<html>
<head>
    <title>analogarchivejs - ${folderName.charAt(0).toUpperCase() + folderName.slice(1)}</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<nav class="top-nav">
    <div class="top-nav-left">
        <div class="source-selector" id="sourceSelector">
            <button class="source-selector-button" id="sourceSelectorButton">
                <span class="source-selector-icon">&#x2601;</span>
                <span class="source-selector-text">${folderName.charAt(0).toUpperCase() + folderName.slice(1)}</span>
                <span class="source-selector-arrow">&#x25BC;</span>
            </button>
            <div class="source-selector-dropdown">
                <a href="/" class="source-selector-option">
                    <span class="source-option-icon">&#x1F4BF;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Local Music</span>
                        <span class="source-option-location">On Device</span>
                    </span>
                    <span class="source-option-status local">&#x25CF;</span>
                </a>
                <a href="/analog" class="source-selector-option${folderName === 'analog' ? ' active' : ''}">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Analog</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
                <a href="/live" class="source-selector-option${folderName === 'live' ? ' active' : ''}">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Live</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
                <a href="/digital" class="source-selector-option${folderName === 'digital' ? ' active' : ''}">
                    <span class="source-option-icon">&#x2601;</span>
                    <span class="source-option-text">
                        <span class="source-option-name">Digital</span>
                        <span class="source-option-location">Cloud Storage</span>
                    </span>
                    <span class="source-option-status online">&#x25CF;</span>
                </a>
            </div>
        </div>
    </div>
    <div class="breadcrumb">${breadcrumbHtml}</div>
</nav>
<div class="container">`);

        // Render subdirectories (folders)
        if (currentDirData.subdirs && currentDirData.subdirs.size > 0) {
            const sortedSubdirs = Array.from(currentDirData.subdirs).sort();
            for (const subdir of sortedSubdirs) {
                const subdirPath = currentDir ? `${currentDir}/${subdir}` : subdir;
                const folderUrl = `/${folderName}?dir=${encodeURIComponent(subdirPath)}`;
                res.write(`
                <div class="folder-row">
                    <a href="${folderUrl}" class="folder-link">${subdir}</a>
                </div>`);
            }
        }

        // Render files in the current directory
        if (currentDirData.files && currentDirData.files.length > 0) {
            for (const file of currentDirData.files) {
                // Build proxy URL with folder and full relative path
                // The route pattern is /b2proxy/:folder/:filename(*) where :folder is the root folder (analog/live)
                // and :filename(*) captures the rest of the path
                const proxyUrl = `/b2proxy/${folderName}/${encodeURIComponent(file.relativePath)}`;
                const metadataUrl = `/b2metadata/${folderName}/${encodeURIComponent(file.relativePath)}`;

                res.write(`
                <div class="song-row">
                    <a class="link"
                       data-filename="${file.fileName}"
                       data-folder="${file.folderPath}"
                       data-relative-path="${file.relativePath}"
                       data-proxy-url="${proxyUrl}"
                       data-metadata-url="${metadataUrl}"
                       data-audio-type="b2">
                    ${file.fileName}
                    </a>
                    <a class="direct-link" href="${proxyUrl}" title="Direct link to file">&#128279;</a>
                </div>`);
            }
        }

        res.write(`</div>
<script src="/discogs-service.js"></script>
<script src="/audio-handler.js"></script>
<script>
    // Source selector dropdown
    (function() {
        const selector = document.getElementById('sourceSelector');
        const button = document.getElementById('sourceSelectorButton');

        if (selector && button) {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                selector.classList.toggle('open');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', function(e) {
                if (!selector.contains(e.target)) {
                    selector.classList.remove('open');
                }
            });
        }

        // Check cloud connectivity status
        async function updateCloudStatus() {
            try {
                const response = await fetch('/api/cloud-status');
                const data = await response.json();

                // Update all cloud endpoint status indicators
                const cloudStatuses = document.querySelectorAll('.source-option-status.online, .source-option-status.offline');
                cloudStatuses.forEach(status => {
                    if (!status.classList.contains('local')) {
                        if (data.online) {
                            status.className = 'source-option-status online';
                        } else {
                            status.className = 'source-option-status offline';
                        }
                    }
                });
            } catch (error) {
                // If fetch fails, mark as offline
                const cloudStatuses = document.querySelectorAll('.source-option-status.online, .source-option-status.offline');
                cloudStatuses.forEach(status => {
                    if (!status.classList.contains('local')) {
                        status.className = 'source-option-status offline';
                    }
                });
            }
        }

        // Check status on load
        updateCloudStatus();

        // Check status every 30 seconds
        setInterval(updateCloudStatus, 30000);
    })();

    // Initialize search functionality for B2 pages
    window.addEventListener('DOMContentLoaded', function() {
        audioHandler.initializePage();
    });
</script>
</body></html>`);
        res.end();
    } catch (err) {
        console.error(`Error fetching ${folderName} folder:`, err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
}

// Scan music files on server startup
async function scanMusicFiles() {
    console.log('Scanning music directory...');
    const scanStart = Date.now();
    try {
        // Check if music directory exists
        try {
            await promises.access(directoryPathMusic);
        } catch (err) {
            console.error(`Music directory "${directoryPathMusic}" not found. Please create it or add a symlink.`);
            musicFilesCache = []; // Set empty array so page doesn't hang
            return;
        }

        musicFilesCache = await findMusicFiles(directoryPathMusic);
        const scanDuration = ((Date.now() - scanStart) / 1000).toFixed(2);
        console.log(`Scan complete: ${musicFilesCache.length} files indexed in ${scanDuration}s`);
    } catch (err) {
        console.error('Failed to scan music directory:', err.message);
        musicFilesCache = []; // Set empty array so page doesn't hang
    }
}

// Create server and start listening
createServer(options, app).listen(port, async () => {
    console.log(`Server listening on https://localhost:${port}`);
    console.log(`Server listening on https://localhost:${port}/analog`);
    console.log(`Server listening on https://localhost:${port}/live`);
    console.log(`Server listening on https://localhost:${port}/digital`);

    // Scan music directory on startup
    scanMusicFiles();
});

async function extractArtwork(filePath) {
    const fileExt = extname(filePath).toLowerCase();
    let mimeType;
    if (fileExt === '.flac') {
        mimeType = 'audio/flac';
    } else if (fileExt === '.m4b') {
        mimeType = 'audio/mp4';
    } else {
        mimeType = 'audio/mpeg';
    }
    const metadata = await parseFile(filePath, { mimeType });
    if(metadata.common.picture===undefined){
        return "";
    }else {
        const picture = metadata.common.picture[0];
        // Ensure picture.data is a Buffer before converting to base64
        if (Buffer.isBuffer(picture.data)) {
            return picture.data.toString('base64');
        } else {
            return Buffer.from(picture.data).toString('base64');
        }
    }
}