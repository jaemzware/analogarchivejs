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

// Backblaze B2 configuration
const b2 = new B2({
    applicationKeyId: process.env.B2_APPLICATION_KEY_ID, // Set these in your environment
    applicationKey: process.env.B2_APPLICATION_KEY
});
const bucketName = process.env.B2_BUCKET_NAME;

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

                // Return metadata as JSON
                res.json({
                    artist: metadata.common.artist || 'Unknown Artist',
                    album: metadata.common.album || 'Unknown Album',
                    title: metadata.common.title || filename,
                    artwork: artwork,
                    duration: metadata.format.duration || 0
                });
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

// Helper function to build directory structure
function buildDirectoryStructure(musicFiles) {
    const structure = new Map();

    musicFiles.forEach(fileInfo => {
        const parts = fileInfo.folderPath ? fileInfo.folderPath.split('/') : [];

        if (parts.length === 0) {
            // Files in root directory
            if (!structure.has('__root__')) {
                structure.set('__root__', { files: [], subdirs: new Set() });
            }
            structure.get('__root__').files.push(fileInfo);
        } else {
            // Files in subdirectories
            const topLevel = parts[0];

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
        let breadcrumbHtml = '<a href="/" class="breadcrumb-link">Home</a>';
        let buildPath = '';
        pathParts.forEach(part => {
            buildPath += (buildPath ? '/' : '') + part;
            breadcrumbHtml += ` / <a href="/?dir=${encodeURIComponent(buildPath)}" class="breadcrumb-link">${part}</a>`;
        });

        // Send HTML head right away
        res.write(`<html>
<head>
    <title>analogarchivejs - ${currentPath || 'Home'}</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<div class="breadcrumb">${breadcrumbHtml}</div>
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
<script src="/audio-handler.js"></script>
<script>
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

// Shared function for B2 folder endpoints with enhanced search support
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

        await b2.authorize();

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

        // Build breadcrumb for B2 endpoints
        const breadcrumbHtml = `<a href="/" class="breadcrumb-link">Home</a> / <span style="color: deepskyblue;">${folderName.charAt(0).toUpperCase() + folderName.slice(1)}</span>`;

        let fileNames = `<html>
<head>
    <title>analogarchivejs - ${folderName.charAt(0).toUpperCase() + folderName.slice(1)}</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<div class="breadcrumb">${breadcrumbHtml}</div>
<div class="container">`;

        for (const file of response.data.files) {
            const lowerFileName = file.fileName.toLowerCase();
            if ((lowerFileName.endsWith('.mp3') || lowerFileName.endsWith('.flac') || lowerFileName.endsWith('.m4b')) && file.fileName !== `${folderName}/`) {
                const fileName = file.fileName.split('/').pop();
                const proxyUrl = `/b2proxy/${folderName}/${encodeURIComponent(fileName)}`;
                const metadataUrl = `/b2metadata/${folderName}/${encodeURIComponent(fileName)}`;

                // Enhanced link with comprehensive data attributes for search
                fileNames += `
                <div class="song-row">
                    <a class="link"
                       data-filename="${fileName}"
                       data-folder="${folderName}"
                       data-proxy-url="${proxyUrl}"
                       data-metadata-url="${metadataUrl}"
                       data-audio-type="b2">
                    ${fileName}
                    </a>
                    <a class="direct-link" href="${proxyUrl}" title="Direct link to file">&#128279;</a>
                </div>`;
            }
        }

        fileNames += `</div>
<script src="/audio-handler.js"></script>
<script>
    // Initialize search functionality for B2 pages
    window.addEventListener('DOMContentLoaded', function() {
        audioHandler.initializePage();
    });
</script>
</body></html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
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