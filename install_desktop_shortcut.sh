#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.local/share/applications"
mkdir -p "$TARGET_DIR"

cat <<EOF > "$TARGET_DIR/sonicmp3.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=SonicMP3 Studio
Comment=Pro YouTube to MP3 Downloader & Audio Vault
Exec=$SCRIPT_DIR/start_gui.sh
Path=$SCRIPT_DIR
Icon=$SCRIPT_DIR/icon.png
Terminal=false
Categories=AudioVideo;Audio;
Keywords=YouTube;MP3;Audio;Downloader;Music;
StartupNotify=true
EOF

chmod +x "$TARGET_DIR/sonicmp3.desktop"
echo "✅ Installed SonicMP3 Studio desktop shortcut to $TARGET_DIR/sonicmp3.desktop"
