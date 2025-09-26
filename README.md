# AnalogArchiveJS 🎵

A beautiful, self-hosted music streaming server that displays your MP3 collection with rich metadata, album artwork, and seamless playback. Supports both local files and cloud storage via Backblaze B2.

## ✨ Features

- **Rich Metadata Display**: Shows artist, album, title, and album artwork extracted from MP3 files
- **Streaming Audio Player**: Click to play songs with built-in HTML5 audio controls
- **Auto-Play Queue**: Automatically plays the next song when current track ends
- **Dual Storage Support**:
   - Local files from `./music` directory (root endpoint)
   - Cloud storage via Backblaze B2 buckets (`/analog` and `/live` endpoints)
- **Beautiful UI**: Clean, modern interface with album artwork backgrounds
- **HTTPS Ready**: Built-in SSL support for secure streaming
- **CORS Proxy**: Handles cloud file streaming without browser restrictions

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/en/download) (v14+ recommended)
- OpenSSL for certificate generation (included on macOS/Linux)

### Local Setup

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
   mkdir ssl
   openssl req -nodes -new -x509 -keyout ssl/server.key -out ssl/server.cert
   ```
   *Follow the prompts - you can use default values for localhost development*

4. **Set up your music directory**
   ```bash
   mkdir music
   ```
   Copy your MP3 files into the `music` directory.

5. **Configure environment** (optional - for Backblaze B2)
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Backblaze B2 credentials:
   ```
   SSL_KEY_PATH=./ssl/server.key
   SSL_CERT_PATH=./ssl/server.cert
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

## 📁 Endpoints

| Endpoint | Description | Storage |
|----------|-------------|---------|
| `/` | Local music collection | `./music` directory |
| `/analog` | Analog bucket collection | Backblaze B2 `analog` folder |
| `/live` | Live recordings collection | Backblaze B2 `live` folder |

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
   └── live/
       ├── recording1.mp3
       └── recording2.mp3
   ```

4. **Configure environment variables** in `.env`

## 🎨 How It Works

- **Metadata Extraction**: Uses `music-metadata` to read ID3 tags from MP3 files
- **Album Artwork**: Extracts embedded artwork and displays as background images
- **Streaming**: Files are served directly with proper MIME types and caching headers
- **Auto-Queue**: Automatically advances to the next song in the list
- **Responsive Design**: Clean, mobile-friendly interface

## 🛠️ Technical Details

- **Framework**: Express.js with HTTPS server
- **Metadata**: `music-metadata` library for ID3 tag parsing
- **Cloud Storage**: Backblaze B2 SDK for cloud file access
- **SSL**: Self-signed certificates for development
- **Port**: 55557 (customizable in code)

## 📝 File Structure

```
analogarchivejs/
├── index.js              # Main server file
├── audio-handler.js      # Client-side audio player
├── styles.css           # UI styling
├── package.json         # Dependencies
├── .env.example         # Environment template
├── ssl/                 # SSL certificates
│   ├── server.key
│   └── server.cert
└── music/               # Local MP3 files
    ├── song1.mp3
    └── song2.mp3
```

## 🔧 Customization

- **Port**: Change `port` variable in `index.js`
- **Styling**: Modify `styles.css` for custom appearance
- **Buckets**: Add more endpoints by following the `/analog` and `/live` pattern
- **Audio Formats**: Currently supports MP3 (can be extended for other formats)

## 🐛 Troubleshooting

**SSL Certificate Issues**:
- Make sure certificates are in the `ssl/` directory
- Verify file paths in `.env` match your certificate locations

**No Audio Playback**:
- Check browser console for CORS errors
- Ensure MP3 files have proper metadata
- Verify file permissions in the `music` directory

**Backblaze B2 Errors**:
- Confirm your application key has read permissions
- Check bucket name matches your `.env` configuration
- Ensure files are in the correct folder structure

## 🤝 Contributing

Pull requests welcome! Please feel free to submit issues and enhancement requests.

## 📄 License

Open source - feel free to use and modify for your projects!

---

*Built with ❤️ for music lovers who want to self-host their collections*