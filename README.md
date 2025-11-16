# AnalogArchiveJS 🎵

A beautiful, self-hosted music streaming server that displays your MP3 or FLAC collection with rich metadata, album artwork, and seamless playback. Supports both local files and cloud storage via Backblaze B2.

**🚀 Runs on a $15 Raspberry Pi Zero!**

## ✨ Features

- **Ultra Lightweight**: Runs smoothly on Raspberry Pi Zero with minimal resource usage via efficient streaming architecture
- **Rich Metadata Display**: Shows artist, album, title, and album artwork extracted from MP3 files
- **Efficient Streaming**: Direct file streaming with minimal memory footprint - no buffering entire files in RAM
- **Auto-Play Queue**: Automatically plays the next song when current track ends
- **Dual Storage Support**:
   - Local files from `./music` directory (root endpoint)
   - Cloud storage via Backblaze B2 buckets (`/analog` and `/live` endpoints)
- **Recursive Directory Scanning**: Automatically discovers music in all subdirectories - symlink your old music hard drives to the `music` folder to find all your long-lost songs
- **FLAC Support**: Now supports high-quality FLAC audio files in addition to MP3
- **Beautiful UI**: Clean, modern interface with album artwork backgrounds
- **HTTPS Ready**: Built-in SSL support for secure streaming
- **Memory Efficient**: Streams files directly without loading into memory - perfect for low-resource devices
- **CORS Proxy**: Handles cloud file streaming without browser restrictions

## 🔧 Hardware Requirements

- **Minimum**: Raspberry Pi Zero ($15) - confirmed working!
- **Recommended**: Raspberry Pi 3B+ or 4 for larger collections and faster metadata processing
- **Storage**: MicroSD card (16GB+) for OS and music, or external USB storage
- **Power**: Standard 5V micro-USB power supply

*Perfect for always-on, low-power music streaming with virtually silent operation.*

## 🚀 Quick Start

Choose either **Docker** (recommended for easy setup) or **Node.js** (for direct installation):

### Option 1: Docker Setup (Recommended)

#### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

#### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/jaemzware/analogarchivejs.git
   cd analogarchivejs
   ```

2. **Set up your music directory**
   ```bash
   mkdir music
   ```
   Copy your MP3 or FLAC files into the `music` directory, or symlink an existing music folder (e.g., `ln -s /path/to/old/harddrive music`) to automatically discover all songs in subdirectories.

3. **Configure environment** (optional - for Backblaze B2)
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Backblaze B2 credentials:
   ```
   B2_APPLICATION_KEY_ID=your_key_id
   B2_APPLICATION_KEY=your_application_key
   B2_BUCKET_NAME=your_bucket_name
   ```
   *Note: SSL certificates are automatically generated inside the container*

4. **Start the container**
   ```bash
   docker-compose up -d
   ```

5. **Open in browser**
   Navigate to: `https://localhost:55557`

   *(Accept the self-signed certificate warning for localhost development)*

6. **Stop the container**
   ```bash
   docker-compose down
   ```

**Note**: If you update your `.env` file with B2 credentials, restart the container with:
```bash
docker-compose down && docker-compose up -d
```

### Option 2: Node.js Local Setup

#### Prerequisites
- [Node.js](https://nodejs.org/en/download) (v14+ recommended)
- OpenSSL for certificate generation (included on macOS/Linux)
- *For Raspberry Pi: Use the official Raspberry Pi OS with Node.js installed*

#### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/jaemzware/analogarchivejs.git
   cd analogarchivejs
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create SSL certificates**
   ```bash
   mkdir sslcert
   openssl genrsa -out sslcert/key.pem 4096
   openssl req -x509 -new -sha256 -nodes -key sslcert/key.pem -days 1095 -out sslcert/cert.pem -subj "/CN=localhost/O=analogarchive/C=US"
   ```
   *Self-signed certificates are automatically generated for localhost development*

4. **Set up your music directory**
   ```bash
   mkdir music
   ```
   Copy your MP3 or FLAC files into the `music` directory, or symlink an existing music folder (e.g., `ln -s /path/to/old/harddrive music`) to automatically discover all songs in subdirectories.

5. **Configure environment** (optional - for Backblaze B2)
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Backblaze B2 credentials:
   ```
   SSL_KEY_PATH=./sslcert/key.pem
   SSL_CERT_PATH=./sslcert/cert.pem
   B2_APPLICATION_KEY_ID=your_key_id
   B2_APPLICATION_KEY=your_application_key
   B2_BUCKET_NAME=your_bucket_name
   ```

6. **Start the server**
   ```bash
   node .
   ```

7. **Open in browser**
   Navigate to: `https://localhost:55557`

   *(Accept the self-signed certificate warning for localhost development)*

## 🔄 Raspberry Pi Auto-Start on Boot

To have the server automatically start when your Raspberry Pi boots:

1. **Copy the service file to systemd**
   ```bash
   sudo cp analogarchivejs.service /etc/systemd/system/
   ```

2. **Reload systemd**
   ```bash
   sudo systemctl daemon-reload
   ```

3. **Enable the service to start on boot**
   ```bash
   sudo systemctl enable analogarchivejs
   ```

4. **Start the service now**
   ```bash
   sudo systemctl start analogarchivejs
   ```

5. **Check the service status**
   ```bash
   sudo systemctl status analogarchivejs
   ```

6. **View logs** (optional)
   ```bash
   journalctl -u analogarchivejs -f
   ```

**Note**: The included `analogarchivejs.service` file assumes the project is located at `/home/jaemzware/Desktop/analogarchivejs`. Update the `WorkingDirectory` and `User` fields in the service file if your setup differs.

## 🔍 Endpoints

| Endpoint | Description | Storage |
|----------|-------------|---------|
| `/` | Local music collection | `./music` directory |
| `/analog` | Analog bucket collection | Backblaze B2 `analog` folder |
| `/live` | Live recordings collection | Backblaze B2 `live` folder |
| `/digital` | Digital music collection | Backblaze B2 `digital` folder |

## ☁️ Backblaze B2 Setup (Optional)

For cloud storage support:

1. **Create a Backblaze B2 account** at [backblaze.com](https://www.backblaze.com/b2/cloud-storage.html)

2. **Create application keys**:
   - Go to "App Keys" in your B2 dashboard
   - Create a new application key
   - Note the Key ID and Application Key

3. **Create a bucket** and organize with folders:
   ```
   your-bucket/
   ├── analog/
   │   ├── song1.mp3
   │   └── song2.mp3
   ├── live/
   │   ├── recording1.mp3
   │   └── recording2.mp3
   └── digital/
       ├── album1.flac
       └── album2.mp3
   ```

4. **Configure environment variables** in `.env`

## 🎵 Discogs Integration (Optional)

For Discogs integration support:

1. **Get a Discogs API token**:
   - Go to [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
   - Generate a new personal access token
   - Note the token for your `.env` file

2. **Configure environment variables** in `.env`:
   ```
   DISCOGS_API_TOKEN=your_discogs_api_token
   DISCOGS_COLLECTION_URL=https://www.discogs.com/user/your-username/collection
   ```

**What these do**:
- **DISCOGS_API_TOKEN**: Enables searching Discogs to find a particular release link for albums in your collection
- **DISCOGS_COLLECTION_URL**: Adds a hardcoded collection button that links to your Discogs collection page (can be any URL you want)

## 🎨 How It Works

- **Metadata Extraction**: Uses `music-metadata` to read ID3 tags from audio files (downloads only first 10MB for efficiency)
- **Album Artwork**: Extracts embedded artwork and displays as background images
- **Efficient Streaming**: Files are streamed directly with zero-copy architecture - no buffering in RAM for excellent performance on low-resource devices
- **Auto-Queue**: Automatically advances to the next song in the list
- **Responsive Design**: Clean, mobile-friendly interface

## 🛠️ Technical Details

- **Framework**: Express.js with HTTPS server
- **Metadata**: `music-metadata` library for ID3 tag parsing
- **Cloud Storage**: Backblaze B2 SDK for cloud file access
- **SSL**: Self-signed certificates for development
- **Port**: 55557 (customizable in code)
- **Resource Usage**: Minimal CPU and RAM - runs great on Pi Zero
- **Architecture**: ARM64/ARM compatible

## 📁 File Structure

```
analogarchivejs/
├── index.js              # Main server file
├── audio-handler.js      # Client-side audio player
├── styles.css           # UI styling
├── package.json         # Dependencies
├── .env.example         # Environment template
├── sslcert/             # SSL certificates
│   ├── key.pem
│   └── cert.pem
└── music/               # Local MP3 files
    ├── song1.mp3
    └── song2.mp3
```

## 🔧 Customization

- **Port**: Change `port` variable in `index.js`
- **Styling**: Modify `styles.css` for custom appearance
- **Buckets**: Add more endpoints by following the `/analog` and `/live` pattern
- **Audio Formats**: Supports MP3 and FLAC formats

## 🐛 Troubleshooting

**SSL Certificate Issues**:
- Make sure certificates are in the `sslcert/` directory
- Verify file paths in `.env` match your certificate locations

**No Audio Playback**:
- Check browser console for CORS errors
- Ensure MP3 files have proper metadata
- Verify file permissions in the `music` directory

**Backblaze B2 Errors**:
- Confirm your application key has read permissions
- Check bucket name matches your `.env` configuration
- Ensure files are in the correct folder structure

## Endpoints

**Analog Archive JS (Port 55557)**
- `https://localhost:55557/` - Audio player for onboard music folders (scanned from Pi's hard drives)
- `https://localhost:55557/analog` - Backblaze B2 bucket audio library (requires home WiFi with gateway)
- `https://localhost:55557/live` - Backblaze B2 live recordings library (requires home WiFi with gateway)
- `https://localhost:55557/digital` - Backblaze B2 digital music library (requires home WiFi with gateway)

## 🤝 Contributing

Pull requests welcome! Please feel free to submit issues and enhancement requests.

## 📄 License

Open source - feel free to use and modify for your projects!

---

*Built with ❤️ for music lovers who want to self-host their collections*