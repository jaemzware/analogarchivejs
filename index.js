//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import 'dotenv/config';
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync} from 'fs';
import {join, extname} from 'path';
import * as url from 'url';
import express from 'express';
import B2 from 'backblaze-b2';

const app = express();
const port = 55557;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
//use self-signed certificate for localhost development
const options = {key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH)}
const directoryPathMusic = "./music";

// Backblaze B2 configuration
const b2 = new B2({
    applicationKeyId: process.env.B2_APPLICATION_KEY_ID, // Set these in your environment
    applicationKey: process.env.B2_APPLICATION_KEY
});
const bucketName = process.env.B2_BUCKET_NAME;

//make files available in music subdirectory
app.use('/music', express.static(join(__dirname, directoryPathMusic.substring(2))));
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
app.get('/localmetadata/:filename(*)', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = join(directoryPathMusic, filename);

        console.log(`Getting local metadata for: ${filePath}`);

        // Parse metadata from local file
        const metadata = await parseFile(filePath);
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

        // For large files, download full file
        // Note: Partial downloads can cause "Invalid FLAC preamble" errors
        // because we might cut metadata blocks in the middle
        console.log(`Downloading file for metadata extraction`);

        // Download file from B2
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer'
        });

        // The actual file data is in fileData.data, but we need to handle the response correctly
        const rawData = fileData.data;

        if (rawData) {
            // Convert to buffer for metadata parsing
            let buffer;
            if (rawData instanceof ArrayBuffer) {
                buffer = Buffer.from(rawData);
            } else if (Buffer.isBuffer(rawData)) {
                buffer = rawData;
            } else if (rawData instanceof Uint8Array) {
                buffer = Buffer.from(rawData);
            } else if (typeof rawData === 'object' && rawData.data) {
                // Handle nested data structure
                buffer = Buffer.from(rawData.data);
            } else {
                buffer = Buffer.from(rawData);
            }

            console.log(`Buffer size: ${buffer.length} bytes`);
            console.log(`First bytes: ${buffer.slice(0, 4).toString('hex')}`);

            // Parse metadata from the buffer using parseBuffer
            const { parseBuffer } = await import('music-metadata');
            const metadata = await parseBuffer(buffer, {
                duration: true,
                skipCovers: false
            });

            console.log('Metadata parsed successfully');
            console.log('Artist:', metadata.common.artist);
            console.log('Title:', metadata.common.title);
            console.log('Album:', metadata.common.album);
            console.log('Picture array:', metadata.common.picture);

            // Extract artwork with better error handling
            let artwork = "";
            if (metadata.common.picture && metadata.common.picture.length > 0) {
                const picture = metadata.common.picture[0];
                console.log('Picture object:', picture);
                console.log('Picture data type:', typeof picture.data);
                console.log('Picture data is Buffer:', Buffer.isBuffer(picture.data));
                console.log('Picture data is Uint8Array:', picture.data instanceof Uint8Array);

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

        // Download the file from B2
        console.log('Starting B2 download...');
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer'
        });

        console.log(`Download successful`);
        console.log(`Data exists: ${fileData.data ? 'yes' : 'no'}`);

        if (fileData.data) {
            console.log(`Data type: ${typeof fileData.data}`);
            console.log(`Data length: ${fileData.data.byteLength || fileData.data.length || 'unknown'}`);
        }

        // Set appropriate headers based on file extension
        const contentType = fullPath.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/mpeg';
        res.set('Content-Type', contentType);
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Access-Control-Allow-Origin', '*');

        // Handle the data
        if (fileData.data) {
            let buffer;
            if (fileData.data instanceof ArrayBuffer) {
                buffer = Buffer.from(fileData.data);
                console.log('Converted ArrayBuffer to Buffer');
            } else if (Buffer.isBuffer(fileData.data)) {
                buffer = fileData.data;
                console.log('Data is already a Buffer');
            } else {
                buffer = Buffer.from(fileData.data);
                console.log('Converted data to Buffer');
            }

            console.log(`Sending buffer of size: ${buffer.length}`);
            res.send(buffer);
            console.log('=== B2 Proxy Request Success ===');
        } else {
            console.error('No file data in response');
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

// Original local music endpoint with enhanced search support
app.get('/', async (req,res) =>{
    try {
        const files = await promises.readdir(directoryPathMusic);
        let fileNames = `<html>
<head>
    <title>analogarchivejs</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<div class="container">`;

        for (const file of files) {
            const filePath = join(directoryPathMusic, file);
            const stats = await promises.stat(filePath);
            if (stats.isFile() && ['.mp3', '.flac'].includes(extname(filePath).toLowerCase())) {
                try {
                    const fileExt = extname(filePath).toLowerCase();
                    const mimeType = fileExt === '.flac' ? 'audio/flac' : 'audio/mpeg';
                    const metadata = await parseFile(filePath, { mimeType });
                    const artwork = await extractArtwork(filePath);

                    // Enhanced link with better data attributes for search
                    fileNames += `
                    <a class="link"
                       style="background-image:url('data:image/png;base64,${artwork}')"
                       onclick="audioHandler.playAudio('music/${file}', this, 'local')"
                       data-filename="${file}"
                       data-artist="${metadata.common.artist || 'Unknown Artist'}"
                       data-album="${metadata.common.album || 'Unknown Album'}"
                       data-title="${metadata.common.title || file}">
                    ${metadata.common.artist || 'Unknown Artist'}
                    ${metadata.common.album || 'Unknown Album'}
                    ${metadata.common.title || file}
                    </a>`;
                } catch (err) {
                    console.error(`Error parsing metadata for ${file}:`, err.message);
                    // Skip files that can't be parsed
                }
            }
        }

        fileNames += `</div>
<script src="/audio-handler.js"></script>
<script>
    // Initialize search functionality for local files
    window.addEventListener('DOMContentLoaded', function() {
        audioHandler.initializePage();
    });
</script>
</body></html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
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

        let fileNames = `<html>
<head>
    <title>analogarchivejs - ${folderName.charAt(0).toUpperCase() + folderName.slice(1)}</title>
    <link rel="stylesheet" href="styles.css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<div class="container">`;

        for (const file of response.data.files) {
            if ((file.fileName.toLowerCase().endsWith('.mp3') || file.fileName.toLowerCase().endsWith('.flac')) && file.fileName !== `${folderName}/`) {
                const fileName = file.fileName.split('/').pop();
                const proxyUrl = `/b2proxy/${folderName}/${encodeURIComponent(fileName)}`;
                const metadataUrl = `/b2metadata/${folderName}/${encodeURIComponent(fileName)}`;

                // Enhanced link with comprehensive data attributes for search
                fileNames += `
                <a class="link" 
                   data-filename="${fileName}"
                   data-folder="${folderName}"
                   data-proxy-url="${proxyUrl}"
                   data-metadata-url="${metadataUrl}"
                   onclick="audioHandler.playAudio('${proxyUrl}', this, 'b2')">
                ${fileName}
                </a>`;
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

// Create server and start listening
createServer(options, app).listen(port, () => {
    console.log(`Server listening on https://localhost:${port}`);
    console.log(`Server listening on https://localhost:${port}/analog`);
    console.log(`Server listening on https://localhost:${port}/live`);
});

async function extractArtwork(filePath) {
    const fileExt = extname(filePath).toLowerCase();
    const mimeType = fileExt === '.flac' ? 'audio/flac' : 'audio/mpeg';
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