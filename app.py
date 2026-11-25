#!/usr/bin/env python3
"""
SonicMP3 Studio - Advanced YouTube to MP3 Downloader & Audio Extraction Server
Features:
- Single video, YouTube Shorts, Playlist, and Multi-URL batch extraction
- Bitrate selector: 320k, 256k, 192k, 128k, and best VBR
- Embedded ID3 metadata (Title, Artist, Album) and HD album cover art
- Real-time SSE (Server-Sent Events) progress streaming (speed, ETA, percentage)
- Built-in audio library management with in-browser playback & direct download
- System integration (Open Folder in file manager via xdg-open)
"""

import os
import sys
import json
import time
import uuid
import shutil
import queue
import argparse
import subprocess
import threading
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from flask import Flask, request, jsonify, Response, send_file, send_from_directory, abort

class SafeStream:
    """Safely wraps stdout/stderr to prevent EIO (Errno 5 Input/output error) when detached from a terminal."""
    def __init__(self, stream):
        self._stream = stream
    def write(self, s):
        try:
            return self._stream.write(s)
        except (OSError, BrokenPipeError):
            return len(s)
    def flush(self):
        try:
            return self._stream.flush()
        except (OSError, BrokenPipeError):
            pass
    def fileno(self):
        try:
            return self._stream.fileno()
        except Exception:
            raise OSError("No fileno")

sys.stdout = SafeStream(sys.stdout)
sys.stderr = SafeStream(sys.stderr)


# Configure Node.js runtime for yt-dlp challenge solver
NODE_PATHS = [
    shutil.which("node"),
    os.path.expanduser("~/.local/bin/node"),
    os.path.expanduser("~/.gemini/antigravity-ide/bin/node"),
    "/usr/bin/node",
    "/usr/local/bin/node"
]
NODE_BIN = next((p for p in NODE_PATHS if p and os.path.exists(p) and os.access(p, os.X_OK)), None)
if NODE_BIN:
    node_dir = os.path.dirname(NODE_BIN)
    if node_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{node_dir}:{os.environ.get('PATH', '')}"

import yt_dlp
import mutagen
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, ID3NoHeaderError
from mutagen.mp3 import MP3

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = BASE_DIR / ".temp"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

def cleanup_temp_dir(force_all=False):
    """Removes temporary archives on disk to prevent storage buildup."""
    try:
        now = time.time()
        if TEMP_DIR.exists():
            for item in TEMP_DIR.iterdir():
                if item.is_file() and (force_all or (now - item.stat().st_mtime > 600)):
                    try:
                        item.unlink()
                    except Exception:
                        pass
    except Exception:
        pass

app = Flask(__name__, static_folder="static", static_url_path="")

# Task Management Data Structures
tasks = {}
tasks_lock = threading.Lock()
sse_listeners = []
sse_lock = threading.Lock()

# Worker Queues for Pipelined Architecture (Download Next while Converting Previous)
download_queue = queue.Queue()
convert_queue = queue.Queue()
download_workers = []
convert_workers = []
MAX_CONCURRENT_DOWNLOADS = 1  # Strictly 1 YouTube stream at a time (100% safe from 403 CDN blocks)
MAX_CONCURRENT_CONVERSIONS = 1  # Pipelined local FFmpeg conversion worker

def notify_clients(event_type, data):
    """Broadcast an update event to all connected SSE clients."""
    payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with sse_lock:
        stale = []
        for q in sse_listeners:
            try:
                q.put_nowait(payload)
            except queue.Full:
                stale.append(q)
        for s in stale:
            if s in sse_listeners:
                sse_listeners.remove(s)

def format_duration(seconds):
    if not seconds:
        return "Unknown"
    try:
        seconds = int(float(seconds))
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"
        return f"{m}:{s:02d}"
    except Exception:
        return "Unknown"

def format_bytes(num_bytes):
    if not num_bytes:
        return "0 B"
    try:
        num_bytes = float(num_bytes)
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if abs(num_bytes) < 1024.0:
                return f"{num_bytes:.1f} {unit}"
            num_bytes /= 1024.0
        return f"{num_bytes:.1f} PB"
    except Exception:
        return "0 B"

def sanitize_filename(name):
    """Sanitize string for filesystem safety."""
    keepcharacters = (' ', '.', '_', '-')
    clean = "".join(c for c in name if c.isalnum() or c in keepcharacters).strip()
    return clean or "audio_track"

class QuietYtdlLogger:
    def debug(self, msg):
        pass
    def info(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        pass

def get_base_ydl_opts():
    opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'logger': QuietYtdlLogger(),
        'remote_components': ['ejs:github'],
    }
    if NODE_BIN:
        opts['js_runtimes'] = {'node': {'path': NODE_BIN}}
    return opts


def extract_metadata_from_urls(raw_input):
    """
    Parses single video, playlist, or multi-line batch URLs.
    Returns structured list of tracks.
    """
    lines = [line.strip() for line in raw_input.strip().splitlines() if line.strip()]
    if not lines:
        return {"error": "No URLs provided"}

    all_tracks = []
    seen_ids = set()

    ydl_opts = get_base_ydl_opts()
    ydl_opts['extract_flat'] = True
    ydl_opts['skip_download'] = True

    for url in lines:
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if not info:
                    continue

                entries = list(info.get('entries') or []) if 'entries' in info else []

                # Check if it's a playlist or collection
                if entries:
                    playlist_title = info.get('title') or "YouTube Playlist"
                    for idx, entry in enumerate(entries):
                        if not entry:
                            continue
                        track_id = entry.get('id') or f"track_{idx}"
                        if track_id in seen_ids:
                            continue
                        seen_ids.add(track_id)

                        thumbnails = entry.get('thumbnails') or []
                        thumb_url = thumbnails[-1].get('url') if thumbnails else f"https://i.ytimg.com/vi/{track_id}/hqdefault.jpg"

                        all_tracks.append({
                            'id': track_id,
                            'url': entry.get('url') or f"https://www.youtube.com/watch?v={track_id}",
                            'title': entry.get('title') or f"Track {idx + 1}",
                            'duration': entry.get('duration'),
                            'duration_str': format_duration(entry.get('duration')),
                            'uploader': entry.get('uploader') or entry.get('channel') or "YouTube Artist",
                            'thumbnail': thumb_url,
                            'playlist_title': playlist_title,
                            'view_count': entry.get('view_count'),
                        })
                else:
                    track_id = info.get('id')
                    if track_id in seen_ids:
                        continue
                    seen_ids.add(track_id)

                    thumbnails = info.get('thumbnails') or []
                    thumb_url = thumbnails[-1].get('url') if thumbnails else f"https://i.ytimg.com/vi/{track_id}/hqdefault.jpg"

                    all_tracks.append({
                        'id': track_id,
                        'url': info.get('webpage_url') or url,
                        'title': info.get('title') or "YouTube Audio",
                        'duration': info.get('duration'),
                        'duration_str': format_duration(info.get('duration')),
                        'uploader': info.get('uploader') or info.get('channel') or "YouTube Artist",
                        'thumbnail': thumb_url,
                        'playlist_title': None,
                        'view_count': info.get('view_count'),
                    })
        except Exception as e:
            # Add fallback card if inspection had issues
            all_tracks.append({
                'id': str(uuid.uuid4())[:8],
                'url': url,
                'title': f"URL: {url[:50]}...",
                'duration': None,
                'duration_str': "Unknown",
                'uploader': "YouTube",
                'thumbnail': "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80",
                'playlist_title': None,
                'error': str(e)
            })

    return {'tracks': all_tracks, 'count': len(all_tracks)}

def post_process_mp3_tags(file_path, title, artist, album="YouTube Audio", artwork_path=None):
    """Embed and fix ID3 tags directly using mutagen, including album artwork."""
    try:
        try:
            audio = MP3(file_path, ID3=ID3)
        except ID3NoHeaderError:
            audio = MP3(file_path)
            audio.add_tags()

        if audio.tags is None:
            audio.add_tags()

        if title:
            audio.tags.add(TIT2(encoding=3, text=title))
        if artist:
            audio.tags.add(TPE1(encoding=3, text=artist))
        if album:
            audio.tags.add(TALB(encoding=3, text=album))

        if artwork_path and os.path.exists(artwork_path):
            try:
                with open(artwork_path, "rb") as f:
                    art_data = f.read()
                mime = "image/jpeg" if artwork_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
                audio.tags.add(APIC(
                    encoding=3,
                    mime=mime,
                    type=3,  # Cover (front)
                    desc="Cover",
                    data=art_data
                ))
            except Exception as e_art:
                print(f"Error embedding artwork for {file_path}: {e_art}")

        audio.save(v2_version=3)
    except Exception as e:
        print(f"Error fine-tuning ID3 tags for {file_path}: {e}")

def run_download_task(task_id):
    """Network stage: Downloads raw stream from YouTube (strictly 1 concurrent at a time)."""
    with tasks_lock:
        task = tasks.get(task_id)
        if not task:
            return

    url = task['url']
    output_dir = DOWNLOADS_DIR

    task['status'] = 'downloading'
    task['started_at'] = time.time()
    task['percent'] = 0.0
    task['speed_str'] = 'Initializing...'
    task['eta_str'] = 'Calculating...'
    notify_clients('task_update', task)

    def progress_hook(d):
        with tasks_lock:
            current_task = tasks.get(task_id)
            if not current_task or current_task.get('cancelled'):
                raise yt_dlp.utils.DownloadCancelled('Download cancelled by user')

            status = d.get('status')
            if status == 'downloading':
                current_task['status'] = 'downloading'
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes') or 0
                if total > 0:
                    pct = round((downloaded / total) * 100, 1)
                    current_task['percent'] = min(pct, 98.0)
                    current_task['downloaded_str'] = format_bytes(downloaded)
                    current_task['total_str'] = format_bytes(total)

                speed = d.get('speed')
                if speed:
                    current_task['speed_str'] = f"{format_bytes(speed)}/s"
                eta = d.get('eta')
                if eta:
                    current_task['eta_str'] = f"{eta}s remaining"

            elif status == 'finished':
                current_task['percent'] = 98.0
                current_task['speed_str'] = 'Download complete'
                current_task['eta_str'] = 'Pipelining conversion...'

            notify_clients('task_update', current_task)

    max_attempts = 3
    last_error = None
    info = None

    for attempt in range(1, max_attempts + 1):
        with tasks_lock:
            if task.get('cancelled'):
                task['status'] = 'cancelled'
                task['speed_str'] = 'Cancelled'
                notify_clients('task_update', task)
                return

        if attempt == 1:
            clients = ['android', 'ios', 'web']
        elif attempt == 2:
            clients = ['ios', 'android', 'web']
        else:
            clients = ['web', 'mweb']

        ydl_opts = get_base_ydl_opts()
        ydl_opts.update({
            'format': 'bestaudio/best',
            'outtmpl': str(output_dir / '%(title).180B [%(id)s].raw.%(ext)s'),
            'progress_hooks': [progress_hook],
            'writethumbnail': True,
            'retries': 10,
            'fragment_retries': 10,
            'file_access_retries': 5,
            'socket_timeout': 30,
            'extractor_args': {
                'youtube': {
                    'player_client': clients
                }
            },
        })

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if not info:
                    raise Exception("Failed to retrieve track details")
            last_error = None
            break
        except yt_dlp.utils.DownloadCancelled:
            with tasks_lock:
                task['status'] = 'cancelled'
                task['speed_str'] = 'Cancelled'
                notify_clients('task_update', task)
            return
        except Exception as e:
            last_error = e
            if attempt < max_attempts:
                with tasks_lock:
                    if task.get('cancelled'):
                        return
                    task['speed_str'] = f'Retrying (attempt {attempt + 1}/{max_attempts})...'
                    task['eta_str'] = 'Recovering 403...'
                    notify_clients('task_update', task)
                time.sleep(2.0)

    if last_error or not info:
        with tasks_lock:
            task['status'] = 'error'
            task['error_msg'] = str(last_error or "Download failed")
            task['speed_str'] = 'Failed'
            task['eta_str'] = 'Error'
            notify_clients('task_update', task)
        return

    # Locate raw audio file and raw thumbnail
    track_id = info.get('id', '')
    raw_audio_path = None
    raw_thumb_path = None

    for f in os.listdir(output_dir):
        if track_id in f and '.raw.' in f and not f.endswith('.mp3'):
            if f.endswith(('.webp', '.jpg', '.png', '.jpeg')):
                raw_thumb_path = output_dir / f
            else:
                raw_audio_path = output_dir / f

    # Pipelined handoff: Mark task converting, enqueue into convert_queue,
    # and IMMEDIATELY RETURN to free the download worker for the next video!
    with tasks_lock:
        if task.get('cancelled'):
            task['status'] = 'cancelled'
            notify_clients('task_update', task)
            return
        task['status'] = 'converting'
        task['percent'] = 99.0
        task['speed_str'] = 'Downloaded'
        task['eta_str'] = 'Converting to MP3...'
        notify_clients('task_update', task)

    convert_queue.put({
        'task_id': task_id,
        'raw_audio_path': raw_audio_path,
        'raw_thumb_path': raw_thumb_path,
        'info': info
    })

def run_conversion_task(job):
    """Local CPU stage: Converts raw audio to MP3 using FFmpeg and embeds tags/artwork."""
    task_id = job['task_id']
    raw_audio = job.get('raw_audio_path')
    raw_thumb = job.get('raw_thumb_path')
    info = job.get('info') or {}

    with tasks_lock:
        task = tasks.get(task_id)
        if not task or task.get('cancelled'):
            if raw_audio and os.path.exists(raw_audio):
                try: os.remove(raw_audio)
                except Exception: pass
            if raw_thumb and os.path.exists(raw_thumb):
                try: os.remove(raw_thumb)
                except Exception: pass
            return

    bitrate = task.get('bitrate', 'best')
    title = info.get('title') or task.get('title') or "Audio Track"
    artist = info.get('uploader') or info.get('channel') or "YouTube Artist"
    album = task.get('playlist_title') or "YouTube Audio"
    track_id = info.get('id') or task.get('id') or str(uuid.uuid4())[:8]

    clean_title = sanitize_filename(title)[:180]
    final_mp3_name = f"{clean_title} [{track_id}].mp3"
    final_mp3_path = DOWNLOADS_DIR / final_mp3_name

    try:
        # Search fallback if exact raw_audio path moved
        if not raw_audio or not os.path.exists(raw_audio):
            for f in os.listdir(DOWNLOADS_DIR):
                if track_id in f and '.raw.' in f and not f.endswith(('.mp3', '.webp', '.jpg', '.png')):
                    raw_audio = DOWNLOADS_DIR / f
                    break

        if not raw_audio or not os.path.exists(raw_audio):
            raise Exception("Raw audio stream file missing for conversion")

        # Convert to MP3 using FFmpeg
        cmd = ['ffmpeg', '-y', '-i', str(raw_audio), '-vn', '-acodec', 'libmp3lame']
        if bitrate == 'best':
            cmd.extend(['-q:a', '0'])
        else:
            cmd.extend(['-b:a', f'{bitrate}k'])
        cmd.append(str(final_mp3_path))

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise Exception(f"FFmpeg conversion failed: {res.stderr[-300:] if res.stderr else 'Unknown'}")

        # Prepare artwork
        thumb_jpg_path = None
        if raw_thumb and os.path.exists(raw_thumb):
            if str(raw_thumb).lower().endswith(('.jpg', '.jpeg')):
                thumb_jpg_path = raw_thumb
            else:
                temp_jpg = DOWNLOADS_DIR / f"{track_id}_cover.jpg"
                res_th = subprocess.run(['ffmpeg', '-y', '-i', str(raw_thumb), str(temp_jpg)], capture_output=True)
                if res_th.returncode == 0 and temp_jpg.exists():
                    thumb_jpg_path = temp_jpg

        # Embed ID3 tags and album cover
        post_process_mp3_tags(str(final_mp3_path), title, artist, album, str(thumb_jpg_path) if thumb_jpg_path else None)

        # Cleanup raw audio and temp thumbnails
        if raw_audio and os.path.exists(raw_audio):
            try: os.remove(raw_audio)
            except Exception: pass
        if raw_thumb and os.path.exists(raw_thumb):
            try: os.remove(raw_thumb)
            except Exception: pass
        if thumb_jpg_path and thumb_jpg_path != raw_thumb and os.path.exists(thumb_jpg_path):
            try: os.remove(thumb_jpg_path)
            except Exception: pass

        # Clean any remaining temp files with this track_id
        for f in os.listdir(DOWNLOADS_DIR):
            if track_id in f and ('.raw.' in f or f.endswith('.temp.mp3') or f.endswith('.temp.webp')):
                try: os.remove(DOWNLOADS_DIR / f)
                except Exception: pass

        file_size = final_mp3_path.stat().st_size if final_mp3_path.exists() else 0

        with tasks_lock:
            task['status'] = 'completed'
            task['percent'] = 100.0
            task['speed_str'] = 'Complete'
            task['eta_str'] = '0s'
            task['filename'] = final_mp3_name
            task['file_size_str'] = format_bytes(file_size)
            task['completed_at'] = time.time()
            notify_clients('task_update', task)

    except Exception as e:
        with tasks_lock:
            task['status'] = 'error'
            task['error_msg'] = str(e)
            task['speed_str'] = 'Conversion Failed'
            task['eta_str'] = 'Error'
            notify_clients('task_update', task)

def download_worker_loop():
    """Background consumer taking jobs from the download queue (strictly 1 YouTube download at a time)."""
    while True:
        task_id = download_queue.get()
        if task_id is None:
            break
        try:
            run_download_task(task_id)
        except Exception as e:
            print(f"Exception in download worker for task {task_id}: {e}")
        finally:
            download_queue.task_done()

def convert_worker_loop():
    """Background consumer converting finished downloads to MP3 on local CPU."""
    while True:
        job = convert_queue.get()
        if job is None:
            break
        try:
            run_conversion_task(job)
        except Exception as e:
            print(f"Exception in conversion worker: {e}")
        finally:
            convert_queue.task_done()

# Start background download worker (strictly 1 active stream from YouTube)
for _ in range(MAX_CONCURRENT_DOWNLOADS):
    t = threading.Thread(target=download_worker_loop, daemon=True)
    t.start()
    download_workers.append(t)

# Start background conversion worker (processes conversions concurrently with downloads)
for _ in range(MAX_CONCURRENT_CONVERSIONS):
    t = threading.Thread(target=convert_worker_loop, daemon=True)
    t.start()
    convert_workers.append(t)

# ========================
# API ROUTES
# ========================

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/api/system-status")
def system_status():
    """Returns system status, active paths, and environment tools."""
    return jsonify({
        "status": "online",
        "ytdlp_ready": True,
        "ffmpeg_ready": bool(shutil.which("ffmpeg")),
        "node_solver": bool(NODE_BIN),
        "downloads_dir": str(DOWNLOADS_DIR),
        "active_tasks_count": sum(1 for t in tasks.values() if t.get('status') in ['queued', 'downloading', 'converting'])
    })

@app.route("/api/inspect", methods=["POST"])
def inspect_urls():
    """Inspects given YouTube URLs and returns tracks metadata."""
    data = request.get_json(force=True, silent=True) or {}
    url_input = data.get("url", "").strip()
    if not url_input:
        return jsonify({"error": "Please enter at least one YouTube URL."}), 400

    result = extract_metadata_from_urls(url_input)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)

@app.route("/api/download", methods=["POST"])
def queue_downloads():
    """Receives list of tracks to download with selected bitrate."""
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items", [])
    bitrate = str(data.get("bitrate", "320"))

    if not items:
        return jsonify({"error": "No items provided for download."}), 400

    created_tasks = []
    for item in items:
        task_id = str(uuid.uuid4())
        task_data = {
            'id': task_id,
            'url': item.get('url'),
            'title': item.get('title', 'Unknown Track'),
            'thumbnail': item.get('thumbnail', ''),
            'uploader': item.get('uploader', 'YouTube Artist'),
            'duration_str': item.get('duration_str', ''),
            'bitrate': bitrate,
            'status': 'queued',
            'percent': 0.0,
            'speed_str': 'Queued',
            'eta_str': 'Waiting...',
            'created_at': time.time(),
            'cancelled': False
        }
        with tasks_lock:
            tasks[task_id] = task_data
        download_queue.put(task_id)
        created_tasks.append(task_data)
        notify_clients('task_created', task_data)

    return jsonify({"success": True, "tasks": created_tasks})

@app.route("/api/tasks")
def get_tasks():
    with tasks_lock:
        return jsonify(list(tasks.values()))

@app.route("/api/cancel/<task_id>", methods=["POST"])
def cancel_task(task_id):
    with tasks_lock:
        task = tasks.get(task_id)
        if not task:
            return jsonify({"error": "Task not found"}), 404
        task['cancelled'] = True
        task['status'] = 'cancelled'
        task['speed_str'] = 'Cancelled'
        notify_clients('task_update', task)
    return jsonify({"success": True})

@app.route("/api/retry/<task_id>", methods=["POST"])
def retry_task(task_id):
    """Re-queues a failed task for download."""
    with tasks_lock:
        task = tasks.get(task_id)
        if not task:
            return jsonify({"error": "Task not found"}), 404
        task['status'] = 'queued'
        task['percent'] = 0.0
        task['speed_str'] = 'Queued for retry'
        task['eta_str'] = 'Waiting...'
        task['cancelled'] = False
        task['error_msg'] = None
        notify_clients('task_update', task)
    download_queue.put(task_id)
    return jsonify({"success": True})

@app.route("/api/retry-failed", methods=["POST"])
def retry_failed_tasks():
    """Re-queues all tasks currently in 'error' status for download."""
    retried_ids = []
    with tasks_lock:
        for tid, task in tasks.items():
            if task.get('status') == 'error':
                task['status'] = 'queued'
                task['percent'] = 0.0
                task['speed_str'] = 'Queued for retry'
                task['eta_str'] = 'Waiting...'
                task['cancelled'] = False
                task['error_msg'] = None
                download_queue.put(tid)
                retried_ids.append(tid)
                notify_clients('task_update', task)
    return jsonify({"success": True, "retried_count": len(retried_ids), "task_ids": retried_ids})

@app.route("/api/clear-completed", methods=["POST"])
def clear_completed():
    """Clears completed and cancelled tasks from queue; keeps failed tasks visible for retry."""
    with tasks_lock:
        for tid in list(tasks.keys()):
            if tasks[tid].get('status') in ['completed', 'cancelled'] or tasks[tid].get('cancelled'):
                del tasks[tid]
        notify_clients('tasks_cleared', {})
    return jsonify({"success": True})

@app.route("/api/stream")
def sse_stream():
    """SSE endpoint for pushing real-time progress to clients."""
    client_queue = queue.Queue(maxsize=100)
    with sse_lock:
        sse_listeners.append(client_queue)

    def event_stream():
        try:
            # Send initial greeting
            yield "event: connected\ndata: {}\n\n"
            while True:
                msg = client_queue.get()
                yield msg
        except GeneratorExit:
            with sse_lock:
                if client_queue in sse_listeners:
                    sse_listeners.remove(client_queue)

    return Response(event_stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive"
    })

@app.route("/api/library")
def get_library():
    """Lists all downloaded MP3 tracks in the downloads folder with metadata."""
    files = []
    if not DOWNLOADS_DIR.exists():
        return jsonify([])

    for entry in os.scandir(DOWNLOADS_DIR):
        if entry.is_file() and entry.name.lower().endswith(".mp3"):
            stat = entry.stat()
            file_path = entry.path

            # Extract ID3 tags if available
            title = entry.name[:-4]
            artist = "Unknown Artist"
            album = ""
            duration_sec = None
            bitrate_kbps = None
            has_artwork = False

            try:
                audio = MP3(file_path, ID3=ID3)
                duration_sec = int(audio.info.length) if audio.info else None
                bitrate_kbps = int(audio.info.bitrate / 1000) if audio.info and audio.info.bitrate else None
                if audio.tags:
                    if 'TIT2' in audio.tags:
                        title = str(audio.tags['TIT2'])
                    if 'TPE1' in audio.tags:
                        artist = str(audio.tags['TPE1'])
                    if 'TALB' in audio.tags:
                        album = str(audio.tags['TALB'])
                    if any(k.startswith('APIC') for k in audio.tags.keys()):
                        has_artwork = True
            except Exception:
                pass

            files.append({
                'filename': entry.name,
                'title': title,
                'artist': artist,
                'album': album,
                'size': stat.st_size,
                'size_str': format_bytes(stat.st_size),
                'mtime': stat.st_mtime,
                'duration_str': format_duration(duration_sec) if duration_sec else "--:--",
                'bitrate': f"{bitrate_kbps} kbps" if bitrate_kbps else "MP3 Audio",
                'has_artwork': has_artwork,
                'download_url': f"/downloads/{entry.name}",
                'artwork_url': f"/api/artwork/{entry.name}" if has_artwork else None
            })

    # Sort newest first
    files.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify(files)

@app.route("/api/download-all-zip")
def download_all_zip():
    """Packages all (or specified) MP3 files into a zip archive and sends it as a download attachment."""
    filenames_param = request.args.get("files")
    if filenames_param:
        requested = [f.strip() for f in filenames_param.split(",") if f.strip()]
        mp3_files = [f for f in requested if (DOWNLOADS_DIR / f).is_file() and f.lower().endswith(".mp3")]
    else:
        mp3_files = [f for f in os.listdir(DOWNLOADS_DIR) if f.lower().endswith(".mp3")]

    if not mp3_files:
        return jsonify({"error": "No MP3 tracks available to download"}), 404

    cleanup_temp_dir(force_all=False)
    temp_zip = tempfile.NamedTemporaryFile(dir=TEMP_DIR, delete=False, suffix=".zip")
    temp_zip_path = temp_zip.name
    temp_zip.close()

    try:
        with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_STORED) as zf:
            for fname in mp3_files:
                file_path = DOWNLOADS_DIR / fname
                if file_path.exists():
                    zf.write(file_path, arcname=fname)

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        count = len(mp3_files)
        zip_filename = f"SonicMP3_{count}_Tracks_{timestamp}.zip"

        response = send_file(
            temp_zip_path,
            mimetype="application/zip",
            as_attachment=True,
            download_name=zip_filename
        )

        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(temp_zip_path):
                    os.remove(temp_zip_path)
            except Exception:
                pass

        return response
    except Exception as e:
        if os.path.exists(temp_zip_path):
            try:
                os.remove(temp_zip_path)
            except Exception:
                pass
        return jsonify({"error": str(e)}), 500

@app.route("/downloads/<path:filename>")
def serve_download_file(filename):
    """Direct streaming/download of MP3 files with range requests supported."""
    return send_from_directory(str(DOWNLOADS_DIR), filename, as_attachment=False)

@app.route("/api/artwork/<path:filename>")
def serve_artwork(filename):
    """Extracts and streams embedded album art from the MP3."""
    file_path = DOWNLOADS_DIR / filename
    if not file_path.exists():
        abort(404)
    try:
        audio = MP3(str(file_path), ID3=ID3)
        if audio.tags:
            for tag in audio.tags.values():
                if isinstance(tag, APIC):
                    mime = tag.mime or "image/jpeg"
                    return Response(tag.data, mimetype=mime)
    except Exception:
        pass
    abort(404)

@app.route("/api/open-folder", methods=["POST"])
def open_folder():
    """Opens the downloads directory in Linux file manager."""
    try:
        subprocess.Popen(["xdg-open", str(DOWNLOADS_DIR)])
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/delete-file", methods=["POST"])
def delete_file():
    """Deletes an MP3 file from the library."""
    data = request.get_json(force=True, silent=True) or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "Filename required"}), 400

    target = DOWNLOADS_DIR / filename
    if target.exists() and target.is_file() and target.name.lower().endswith(".mp3"):
        try:
            target.unlink()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "File not found"}), 404

@app.route("/api/clear-library", methods=["POST"])
def clear_library():
    """Deletes all MP3 files from the downloads directory for a completely clean slate."""
    deleted_count = 0
    try:
        if DOWNLOADS_DIR.exists():
            for f in os.listdir(DOWNLOADS_DIR):
                if f.lower().endswith(".mp3"):
                    try:
                        (DOWNLOADS_DIR / f).unlink()
                        deleted_count += 1
                    except Exception:
                        pass
        return jsonify({"success": True, "deleted_count": deleted_count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def start_browser_thread(url):
    """Opens default browser after a brief server start delay."""
    time.sleep(1.2)
    try:
        import webbrowser
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not auto-open browser: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SonicMP3 Studio Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5055, help="Port (default 5055)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    args = parser.parse_args()

    port = args.port
    url = f"http://{args.host}:{port}"

    print("=" * 64)
    print("🎵 SonicMP3 Studio - YouTube to MP3 Downloader")
    print(f"🌐 Server running at: {url}")
    print(f"📁 Downloads saved to: {DOWNLOADS_DIR}")
    print("=" * 64)

    cleanup_temp_dir(force_all=True)

    if not args.no_browser:
        threading.Thread(target=start_browser_thread, args=(url,), daemon=True).start()

    app.run(host=args.host, port=port, debug=False, threaded=True)
