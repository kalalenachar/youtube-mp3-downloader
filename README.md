# 🎵 SonicMP3 Studio — Pro YouTube to MP3 Downloader (Python GUI)

An ultra-modern, high-fidelity YouTube audio extractor and MP3 ripper with a sleek dark-glass interface, real-time download streaming, automatic ID3 tagging, and a built-in player.

---

## ✨ Features

- **Multi-Source Extraction:**
  - 🎥 Single YouTube Videos
  - ⚡ YouTube Shorts
  - 📜 Full YouTube Playlists (fast flat extraction)
  - 📋 Multi-URL Batch Input (paste multiple links at once)
- **Audiophile Bitrate Presets:**
  - `320 kbps` (CBR — Studio Master Quality, Default)
  - `256 kbps` (CBR — High Definition)
  - `192 kbps` (CBR — Balanced Hi-Fi)
  - `128 kbps` (CBR — Compact)
  - `Best VBR` (Variable Bitrate source matching)
- **ID3 Metadata & Album Art Cover:**
  - Automatic song title and artist detection
  - Embedded high-res thumbnail album artwork directly into the MP3 tags
  - Verified with `mutagen` & FFmpeg
- **Real-Time Live Progress:**
  - Server-Sent Events (SSE) live updates
  - Accurate download percentage, speed (MB/s), ETA clock, and status indicators
- **Audio Vault (Built-in Player & Library):**
  - **1-Click "Download All (.zip)"**: Package your entire downloaded library (or checked selection) into a single ZIP archive for instant 1-click batch downloading!
  - Checkboxes on every track card to select custom subsets of audio files.
  - Instant in-browser playback with seeking scrubber, volume, and pulsing soundwave visualizer
  - 1-click "Open Downloads Folder" in your Linux file manager (`xdg-open`)
  - Direct individual file download or disk management
- **Hotkeys:**
  - `Spacebar`: Play / Pause currently active track
  - `Enter`: Trigger URL Inspection
  - `Ctrl + V`: Paste URL directly into the input

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and set up a virtual environment:
```bash
git clone https://github.com/kalalenachar/youtube-mp3-downloader.git
cd youtube-mp3-downloader
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Ensure `ffmpeg` is installed on your system:
```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# macOS (Homebrew)
brew install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

### 2. Launch the Application
Run the launcher script:
```bash
./start_gui.sh
```
Or run directly with Python:
```bash
python3 app.py
```

Open your browser to:
**http://127.0.0.1:5055**

---

## 📂 Project Structure

```
youtube-mp3-downloader/
├── app.py              # Flask backend server & yt-dlp/ffmpeg engine
├── start_gui.sh        # One-click startup script
├── sonicmp3.desktop    # Linux desktop launcher entry
├── downloads/          # Directory where converted MP3s are stored
├── static/
│   ├── index.html      # Modern semantic HTML5 interface
│   ├── index.css       # Obsidian dark glassmorphism styling
│   └── app.js          # Reactive UI, SSE streaming, audio player
└── README.md           # Documentation
```

---

## 🛠️ Requirements & Tech Stack

- **Python 3.10+** (tested on Python 3.14)
- **yt-dlp** (latest build with Node.js challenge solver enabled)
- **ffmpeg** (with `libmp3lame` encoder)
- **mutagen** (for ID3 v2.3 metadata tagging and cover art embedding)
- **Flask** (lightweight web server with SSE support)
