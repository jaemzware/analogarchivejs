// Create a separate file: public/audio-handler.js
class AudioHandler {
    constructor() {
        this.currentAudio = null;
        this.currentLink = null;
        this.currentMetadataDiv = null;
    }

    async playAudio(audioSrc, link, metadataEndpoint = null) {
        console.log('Playing:', audioSrc);

        // If there's already a playing audio, stop it and convert back to link
        if (this.currentAudio && this.currentLink && this.currentMetadataDiv) {
            this.currentAudio.pause();
            // Insert the old link back where the container was
            this.currentMetadataDiv.parentNode.replaceChild(this.currentLink, this.currentMetadataDiv);
            this.currentAudio = null;
            this.currentLink = null;
            this.currentMetadataDiv = null;
        }

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
        await this.loadMetadata(audioSrc, metadataDiv, metadataEndpoint);

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

    async loadMetadata(audioSrc, metadataDiv, metadataEndpoint = null) {
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
            const response = await fetch(metadataUrl);
            const metadata = await response.json();

            console.log('Metadata received:', metadata);

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
        } catch (metadataError) {
            console.error('Failed to load metadata:', metadataError);
            // Keep loading state or show error
        }
    }
}

// Global instance
const audioHandler = new AudioHandler();