#!/usr/bin/env bash
# ==============================================================================
# SonicMP3 Studio - One-Click Launcher
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Check local project venv first, then system python
if [ -f "$SCRIPT_DIR/venv/bin/python3" ]; then
    VENV_PYTHON="$SCRIPT_DIR/venv/bin/python3"
elif [ -f "$HOME/.gemini/antigravity-ide/scratch/ypd_env/bin/python3" ]; then
    VENV_PYTHON="$HOME/.gemini/antigravity-ide/scratch/ypd_env/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    VENV_PYTHON="$(command -v python3)"
else
    VENV_PYTHON="python"
fi

echo "=================================================================="
echo " 🎵 Starting SonicMP3 Studio - YouTube to MP3 GUI"
echo " 🚀 Engine: yt-dlp + FFmpeg (libmp3lame 320kbps)"
echo " 🌐 Web GUI URL: http://127.0.0.1:5055"
echo " 📁 Output Dir: $SCRIPT_DIR/downloads"
echo "=================================================================="

# If SonicMP3 Studio is already running in background, just open browser UI and exit
if curl -s -m 1 http://127.0.0.1:5055/api/system-status > /dev/null 2>&1; then
    echo "🎵 SonicMP3 Studio is already active! Opening browser..."
    xdg-open "http://127.0.0.1:5055" 2>/dev/null || sensible-browser "http://127.0.0.1:5055" 2>/dev/null || true
    exit 0
fi


# Export node and local binaries to PATH for YouTube JS challenge solving
if [ -d "$HOME/.local/bin" ]; then
    export PATH="$HOME/.local/bin:$PATH"
fi
if [ -d "$HOME/.gemini/antigravity-ide/bin" ]; then
    export PATH="$HOME/.gemini/antigravity-ide/bin:$PATH"
fi

exec "$VENV_PYTHON" "$SCRIPT_DIR/app.py" "$@"
