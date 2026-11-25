/**
 * SonicMP3 Studio - Frontend Application Engine
 * Handles URL parsing, real-time SSE progress updates, batch downloads,
 * audio library management, and built-in MP3 playback.
 */

document.addEventListener('DOMContentLoaded', () => {
  // App State
  const state = {
    mode: 'playlist', // 'playlist' (default) | 'single' | 'batch'
    bitrate: 'best', // 'best' (Source VBR default) | '320' | '256' | '192' | '128'
    inspectedTracks: [],
    selectedTrackIds: new Set(),
    activeTasks: new Map(),
    library: [],
    selectedLibraryFiles: new Set(),
    currentlyPlaying: null,
    isPlaying: false,
    sseConnected: false
  };

  // DOM Elements
  const els = {
    // Tabs & Inputs
    tabs: document.querySelectorAll('.tab-btn'),
    singleInputBox: document.getElementById('single-input-box'),
    batchInputBox: document.getElementById('batch-input-box'),
    inputUrl: document.getElementById('input-url'),
    inputBatchUrls: document.getElementById('input-batch-urls'),
    btnPaste: document.getElementById('btn-paste'),
    btnClear: document.getElementById('btn-clear'),
    btnInspect: document.getElementById('btn-inspect'),
    inspectSpinner: document.getElementById('inspect-spinner'),
    inspectBtnText: document.getElementById('inspect-btn-text'),

    // Bitrate
    bitrateCards: document.querySelectorAll('.bitrate-card'),

    // Inspection Stage
    inspectionStage: document.getElementById('inspection-stage'),
    inspectionCountBadge: document.getElementById('inspection-count-badge'),
    filterTracksInput: document.getElementById('filter-tracks-input'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnDeselectAll: document.getElementById('btn-deselect-all'),
    btnInvertSelection: document.getElementById('btn-invert-selection'),
    tracksListContainer: document.getElementById('tracks-list-container'),
    selectedSummaryText: document.getElementById('selected-summary-text'),
    selectedBitratePill: document.getElementById('selected-bitrate-pill'),
    btnStartDownload: document.getElementById('btn-start-download'),

    // Queue
    queueSection: document.getElementById('queue-section'),
    queueActiveCount: document.getElementById('queue-active-count'),
    queueListContainer: document.getElementById('queue-list-container'),
    btnClearCompleted: document.getElementById('btn-clear-completed'),
    btnRetryAllFailed: document.getElementById('btn-retry-all-failed'),
    failedCountBadge: document.getElementById('failed-count-badge'),

    // Library
    librarySection: document.getElementById('library-section'),
    libraryTotalBadge: document.getElementById('library-total-badge'),
    libraryListContainer: document.getElementById('library-list-container'),
    libraryEmptyState: document.getElementById('library-empty-state'),
    librarySearchInput: document.getElementById('library-search-input'),
    btnRefreshLibrary: document.getElementById('btn-refresh-library'),
    btnDownloadAllZip: document.getElementById('btn-download-all-zip'),
    btnDownloadAllLabel: document.getElementById('btn-download-all-label'),
    btnCloseLibrary: document.getElementById('btn-close-library'),
    btnPurgeLibrary: document.getElementById('btn-purge-library'),
    btnFreshStart: document.getElementById('btn-fresh-start'),
    btnToggleLibrary: document.getElementById('btn-toggle-library'),
    statLibrarySummary: document.getElementById('stat-library-summary'),
    headerLibraryCount: document.getElementById('header-library-count'),
    btnOpenFolder: document.getElementById('btn-open-folder'),

    // Player
    audioPlayerBar: document.getElementById('audio-player-bar'),
    audioEl: document.getElementById('html5-audio-element'),
    playerThumb: document.getElementById('player-thumb'),
    playerSoundwave: document.getElementById('player-soundwave'),
    playerTrackTitle: document.getElementById('player-track-title'),
    playerTrackArtist: document.getElementById('player-track-artist'),
    playerBitrateTag: document.getElementById('player-bitrate-tag'),
    btnPlayerSkipBack: document.getElementById('btn-player-skip-back'),
    btnPlayerPlayPause: document.getElementById('btn-player-play-pause'),
    iconPlayerPlay: document.getElementById('icon-player-play'),
    iconPlayerPause: document.getElementById('icon-player-pause'),
    btnPlayerSkipFwd: document.getElementById('btn-player-skip-fwd'),
    playerCurTime: document.getElementById('player-cur-time'),
    playerTotTime: document.getElementById('player-tot-time'),
    playerScrubberFill: document.getElementById('player-scrubber-fill'),
    playerSeekSlider: document.getElementById('player-seek-slider'),
    btnPlayerMute: document.getElementById('btn-player-mute'),
    iconVolOn: document.getElementById('icon-vol-on'),
    iconVolMute: document.getElementById('icon-vol-mute'),
    playerVolumeSlider: document.getElementById('player-volume-slider'),

    // System
    systemStatusText: document.getElementById('system-status-text'),
    toastContainer: document.getElementById('toast-container')
  };

  // ==========================================
  // Helper: Toast Notifications
  // ==========================================
  function showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
    `;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '0:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  // ==========================================
  // Mode Tabs Switching
  // ==========================================
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      els.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode;

      if (state.mode === 'batch') {
        els.singleInputBox.classList.add('hidden');
        els.batchInputBox.classList.remove('hidden');
        els.inputBatchUrls.focus();
      } else {
        els.singleInputBox.classList.remove('hidden');
        els.batchInputBox.classList.add('hidden');
        els.inputUrl.placeholder = state.mode === 'playlist' 
          ? 'Paste YouTube Playlist link (e.g. https://www.youtube.com/playlist?list=...)'
          : 'Paste YouTube link here (e.g. https://www.youtube.com/watch?v=...)';
        els.inputUrl.focus();
      }
    });
  });

  // URL Input Clear / Paste Handlers
  els.inputUrl.addEventListener('input', () => {
    if (els.inputUrl.value.trim().length > 0) {
      els.btnClear.classList.add('show');
    } else {
      els.btnClear.classList.remove('show');
    }
  });

  els.btnClear.addEventListener('click', () => {
    els.inputUrl.value = '';
    els.btnClear.classList.remove('show');
    els.inputUrl.focus();
  });

  els.btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (state.mode === 'batch') {
          els.inputBatchUrls.value = text;
        } else {
          els.inputUrl.value = text;
          els.btnClear.classList.add('show');
        }
        showToast('Pasted URL from clipboard', 'info');
      }
    } catch (e) {
      showToast('Clipboard access not permitted or empty', 'error');
    }
  });

  // Bitrate Selector Handlers
  els.bitrateCards.forEach(card => {
    card.addEventListener('click', () => {
      els.bitrateCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        state.bitrate = radio.value;
        const rateLabel = state.bitrate === 'best' ? 'Source VBR' : `${state.bitrate} kbps`;
        els.selectedBitratePill.textContent = rateLabel;
      }
    });
  });

  // ==========================================
  // Inspection & Track Fetching
  // ==========================================
  async function performInspection() {
    let urlInput = '';
    if (state.mode === 'batch') {
      urlInput = els.inputBatchUrls.value.trim();
    } else {
      urlInput = els.inputUrl.value.trim();
    }

    if (!urlInput) {
      showToast('Please enter a YouTube video or playlist URL', 'error');
      return;
    }

    // Set Loading State
    els.btnInspect.disabled = true;
    els.inspectSpinner.classList.remove('hidden');
    els.inspectBtnText.textContent = 'Extracting metadata...';

    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to inspect link');
      }

      state.inspectedTracks = data.tracks || [];
      state.selectedTrackIds.clear();

      // By default select all tracks
      state.inspectedTracks.forEach(t => state.selectedTrackIds.add(t.id));

      renderInspectionResults();
      els.inspectionStage.classList.remove('hidden');
      els.inspectionStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`Successfully found ${state.inspectedTracks.length} track(s)!`, 'success');

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      els.btnInspect.disabled = false;
      els.inspectSpinner.classList.add('hidden');
      els.inspectBtnText.textContent = 'Inspect & Fetch Tracks';
    }
  }

  els.btnInspect.addEventListener('click', performInspection);
  els.inputUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performInspection();
  });

  // Render Track List
  function renderInspectionResults() {
    const filterTerm = els.filterTracksInput.value.trim().toLowerCase();
    els.tracksListContainer.innerHTML = '';

    const visibleTracks = state.inspectedTracks.filter(track => {
      if (!filterTerm) return true;
      return (track.title || '').toLowerCase().includes(filterTerm) ||
             (track.uploader || '').toLowerCase().includes(filterTerm);
    });

    els.inspectionCountBadge.textContent = `${state.inspectedTracks.length} Track${state.inspectedTracks.length === 1 ? '' : 's'} Found`;
    updateSelectionSummary();

    if (visibleTracks.length === 0) {
      els.tracksListContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--text-muted);">
          No tracks matching "${filterTerm}"
        </div>
      `;
      return;
    }

    visibleTracks.forEach(track => {
      const isChecked = state.selectedTrackIds.has(track.id);
      const card = document.createElement('div');
      card.className = `track-card ${isChecked ? 'selected' : ''}`;
      card.dataset.id = track.id;

      card.innerHTML = `
        <input type="checkbox" class="track-checkbox" ${isChecked ? 'checked' : ''} />
        <div class="track-thumb-box">
          <img class="track-thumb-img" src="${track.thumbnail || ''}" alt="" loading="lazy" />
          <span class="track-duration-pill">${track.duration_str || '--:--'}</span>
        </div>
        <div class="track-info">
          <div class="track-title" title="${track.title}">${track.title}</div>
          <div class="track-meta">${track.uploader || 'YouTube Artist'}</div>
        </div>
      `;

      // Handle card and checkbox click
      const checkbox = card.querySelector('.track-checkbox');
      const toggleSelection = (e) => {
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked;
        }
        if (checkbox.checked) {
          state.selectedTrackIds.add(track.id);
          card.classList.add('selected');
        } else {
          state.selectedTrackIds.delete(track.id);
          card.classList.remove('selected');
        }
        updateSelectionSummary();
      };

      card.addEventListener('click', toggleSelection);
      els.tracksListContainer.appendChild(card);
    });
  }

  function updateSelectionSummary() {
    const total = state.inspectedTracks.length;
    const selected = state.selectedTrackIds.size;
    els.selectedSummaryText.textContent = `${selected} of ${total} tracks selected`;
    els.btnStartDownload.disabled = selected === 0;
  }

  // Batch Select Controls
  els.btnSelectAll.addEventListener('click', () => {
    state.inspectedTracks.forEach(t => state.selectedTrackIds.add(t.id));
    renderInspectionResults();
  });

  els.btnDeselectAll.addEventListener('click', () => {
    state.selectedTrackIds.clear();
    renderInspectionResults();
  });

  els.btnInvertSelection.addEventListener('click', () => {
    state.inspectedTracks.forEach(t => {
      if (state.selectedTrackIds.has(t.id)) {
        state.selectedTrackIds.delete(t.id);
      } else {
        state.selectedTrackIds.add(t.id);
      }
    });
    renderInspectionResults();
  });

  els.filterTracksInput.addEventListener('input', renderInspectionResults);

  // ==========================================
  // Start Download Action
  // ==========================================
  els.btnStartDownload.addEventListener('click', async () => {
    const selectedItems = state.inspectedTracks.filter(t => state.selectedTrackIds.has(t.id));
    if (selectedItems.length === 0) {
      showToast('No tracks selected for download', 'error');
      return;
    }

    els.btnStartDownload.disabled = true;
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItems,
          bitrate: state.bitrate
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start download queue');
      }

      data.tasks.forEach(task => {
        state.activeTasks.set(task.id, task);
      });

      // Hide the Inspection Results stage once download begins
      els.inspectionStage.classList.add('hidden');

      renderQueue();
      els.queueSection.classList.remove('hidden');
      els.queueSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const rateLabel = state.bitrate === 'best' ? 'Source VBR' : `${state.bitrate} kbps`;
      showToast(`Started downloading ${selectedItems.length} track(s) at ${rateLabel}!`, 'success');

    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      els.btnStartDownload.disabled = false;
    }
  });

  // ==========================================
  // Queue Management & Real-Time Updates
  // ==========================================
  function renderQueue() {
    const tasks = Array.from(state.activeTasks.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const activeCount = tasks.filter(t => ['queued', 'downloading', 'converting'].includes(t.status)).length;
    const failedCount = tasks.filter(t => t.status === 'error').length;

    els.queueActiveCount.textContent = `${activeCount} in progress`;
    els.queueListContainer.innerHTML = '';

    // Manage Retry All Failed button visibility and count badge
    if (els.btnRetryAllFailed) {
      if (failedCount > 0) {
        els.btnRetryAllFailed.classList.remove('hidden');
        els.btnRetryAllFailed.style.display = 'inline-flex';
        if (els.failedCountBadge) {
          els.failedCountBadge.textContent = failedCount;
        }
      } else {
        els.btnRetryAllFailed.classList.add('hidden');
        els.btnRetryAllFailed.style.display = 'none';
      }
    }

    if (tasks.length === 0) {
      els.queueSection.classList.add('hidden');
      return;
    }

    tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'queue-card';
      card.id = `task-card-${task.id}`;

      let badgeClass = 'status-badge-queued';
      let statusLabel = task.status || 'Queued';

      if (task.status === 'downloading') {
        badgeClass = 'status-badge-downloading';
        statusLabel = 'Downloading';
      } else if (task.status === 'converting') {
        badgeClass = 'status-badge-converting';
        statusLabel = 'Converting MP3';
      } else if (task.status === 'completed') {
        badgeClass = 'status-badge-completed';
        statusLabel = 'Completed';
      } else if (task.status === 'error') {
        badgeClass = 'status-badge-error';
        statusLabel = 'Error';
      } else if (task.status === 'cancelled') {
        badgeClass = 'status-badge-cancelled';
        statusLabel = 'Cancelled';
      }

      const percent = task.percent !== undefined ? task.percent : 0;
      const speed = task.speed_str || '';
      const eta = task.eta_str || '';
      const sizeStr = task.file_size_str || (task.downloaded_str && task.total_str ? `${task.downloaded_str} / ${task.total_str}` : '');

      card.innerHTML = `
        <div class="queue-card-main">
          <div class="queue-track-details">
            <img class="queue-thumb" src="${task.thumbnail || ''}" alt="" />
            <div class="queue-titles">
              <div class="queue-track-title">${task.title}</div>
              <div class="queue-track-artist">${task.uploader || 'YouTube Artist'} • ${task.bitrate || '320'} kbps</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="queue-status-badge ${badgeClass}">${statusLabel}</span>
            ${['queued', 'downloading'].includes(task.status) ? `
              <button class="btn btn-sm btn-ghost btn-cancel-task" data-id="${task.id}" title="Cancel Download">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            ` : ''}
            ${task.status === 'error' ? `
              <button class="btn btn-sm btn-ghost btn-retry-task" data-id="${task.id}" title="Retry Download" style="color: var(--primary); padding: 4px 10px; font-size: 0.75rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); display: inline-flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none">
                  <polyline points="1 4 1 10 7 10"></polyline>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                </svg>
                Retry
              </button>
            ` : ''}
          </div>
        </div>

        <div class="queue-progress-bar">
          <div class="queue-progress-fill" style="width: ${percent}%;"></div>
        </div>

        <div class="queue-meta-bar">
          <span>${percent.toFixed(1)}%</span>
          <div class="queue-metrics">
            ${speed ? `<span>${speed}</span>` : ''}
            ${eta ? `<span>${eta}</span>` : ''}
            ${sizeStr ? `<span>${sizeStr}</span>` : ''}
            ${task.error_msg ? `<span style="color: var(--danger); font-size: 0.75rem;">${task.error_msg.slice(0, 45)}...</span>` : ''}
          </div>
        </div>
      `;

      const cancelBtn = card.querySelector('.btn-cancel-task');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelTask(task.id));
      }

      const retryBtn = card.querySelector('.btn-retry-task');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => retryTask(task.id));
      }

      els.queueListContainer.appendChild(card);
    });
  }

  async function retryTask(taskId) {
    try {
      const res = await fetch(`/api/retry/${taskId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Re-queued download with automatic CDN retry', 'info');
      } else {
        showToast(data.error || 'Failed to retry download', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error retrying task', 'error');
    }
  }

  async function cancelTask(taskId) {
    try {
      await fetch(`/api/cancel/${taskId}`, { method: 'POST' });
      showToast('Download cancelled', 'info');
    } catch (e) {
      console.error(e);
    }
  }

  els.btnClearCompleted.addEventListener('click', async () => {
    try {
      await fetch('/api/clear-completed', { method: 'POST' });
      for (const [id, t] of state.activeTasks.entries()) {
        // Only remove completed and cancelled tasks; protect failed/error tasks!
        if (['completed', 'cancelled'].includes(t.status)) {
          state.activeTasks.delete(id);
        }
      }
      renderQueue();
    } catch (e) {
      console.error(e);
    }
  });

  if (els.btnRetryAllFailed) {
    els.btnRetryAllFailed.addEventListener('click', async () => {
      try {
        els.btnRetryAllFailed.disabled = true;
        const res = await fetch('/api/retry-failed', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.retried_count > 0) {
          showToast(`Re-queuing ${data.retried_count} failed track(s) for download!`, 'info');
          for (const tid of data.task_ids || []) {
            if (state.activeTasks.has(tid)) {
              const t = state.activeTasks.get(tid);
              t.status = 'queued';
              t.percent = 0.0;
              t.speed_str = 'Queued for retry';
              t.eta_str = 'Waiting...';
              t.error_msg = null;
            }
          }
          renderQueue();
        } else {
          showToast('No failed tracks to retry', 'info');
        }
      } catch (e) {
        console.error(e);
        showToast('Failed to retry tasks', 'error');
      } finally {
        els.btnRetryAllFailed.disabled = false;
      }
    });
  }

  // ==========================================
  // SSE Real-Time Stream Connection
  // ==========================================
  function setupSSE() {
    const sse = new EventSource('/api/stream');

    sse.addEventListener('task_created', (e) => {
      const task = JSON.parse(e.data);
      state.activeTasks.set(task.id, task);
      renderQueue();
    });

    sse.addEventListener('task_update', (e) => {
      const task = JSON.parse(e.data);
      const prevTask = state.activeTasks.get(task.id);
      state.activeTasks.set(task.id, task);

      // Check if task just finished
      if (task.status === 'completed' && (!prevTask || prevTask.status !== 'completed')) {
        showToast(`Finished: ${task.title} (320kbps MP3)`, 'success');
        if (els.librarySection) {
          els.librarySection.classList.remove('hidden');
          els.librarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        loadLibrary(); // refresh audio vault
      }

      renderQueue();
    });

    sse.addEventListener('tasks_cleared', () => {
      for (const [id, t] of state.activeTasks.entries()) {
        if (['completed', 'cancelled', 'error'].includes(t.status)) {
          state.activeTasks.delete(id);
        }
      }
      renderQueue();
    });

    sse.onopen = () => {
      state.sseConnected = true;
      els.systemStatusText.textContent = 'Engine Ready';
    };

    sse.onerror = () => {
      state.sseConnected = false;
      // Fallback polling if disconnected
      setTimeout(fetchTasksPolling, 3000);
    };
  }

  async function fetchTasksPolling() {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const tasks = await res.json();
        tasks.forEach(t => state.activeTasks.set(t.id, t));
        renderQueue();
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }

  // ==========================================
  // Audio Vault / Library
  // ==========================================
  async function loadLibrary() {
    try {
      const res = await fetch('/api/library');
      if (!res.ok) return;
      state.library = await res.json();
      renderLibrary();
      updateLibrarySummaryHeader();
    } catch (e) {
      console.error('Error fetching library:', e);
    }
  }

  function updateLibrarySummaryHeader() {
    const totalCount = state.library.length;
    const totalBytes = state.library.reduce((acc, t) => acc + (t.size || 0), 0);
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);

    els.headerLibraryCount.textContent = `${totalCount} Tracks (${mb} MB)`;
    els.libraryTotalBadge.textContent = `${totalCount} tracks`;

    if (els.btnDownloadAllZip) {
      if (totalCount === 0) {
        els.btnDownloadAllZip.style.display = 'none';
      } else {
        els.btnDownloadAllZip.style.display = 'inline-flex';
        if (state.selectedLibraryFiles.size > 0) {
          els.btnDownloadAllLabel.textContent = `Download Selected (${state.selectedLibraryFiles.size} .zip)`;
        } else {
          els.btnDownloadAllLabel.textContent = `Download All (${totalCount} .zip)`;
        }
      }
    }
  }

  function renderLibrary() {
    const search = (els.librarySearchInput.value || '').trim().toLowerCase();
    els.libraryListContainer.innerHTML = '';

    const filtered = state.library.filter(track => {
      if (!search) return true;
      return (track.title || '').toLowerCase().includes(search) ||
             (track.artist || '').toLowerCase().includes(search) ||
             (track.filename || '').toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
      els.libraryEmptyState.classList.remove('hidden');
      els.libraryListContainer.appendChild(els.libraryEmptyState);
      updateLibrarySummaryHeader();
      return;
    }

    els.libraryEmptyState.classList.add('hidden');

    filtered.forEach(track => {
      const isSelected = state.selectedLibraryFiles.has(track.filename);
      const card = document.createElement('div');
      card.className = `library-card ${isSelected ? 'selected-for-download' : ''}`;
      card.dataset.filename = track.filename;
      const artworkSrc = track.artwork_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80';

      card.innerHTML = `
        <div class="library-card-art-box">
          <div class="library-card-checkbox-wrap" title="Select track for download">
            <input type="checkbox" class="library-card-checkbox" ${isSelected ? 'checked' : ''} />
          </div>
          <img class="library-card-art" src="${artworkSrc}" alt="${track.title}" loading="lazy" />
          <div class="library-play-btn-overlay" title="Play track">
            <div class="play-circle-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
          </div>
        </div>

        <div class="library-card-info">
          <div class="library-card-title" title="${track.title}">${track.title}</div>
          <div class="library-card-artist">${track.artist || 'YouTube Audio'}</div>

          <div class="library-card-badges">
            <span class="lib-badge lib-badge-bitrate">${track.bitrate}</span>
            <span class="lib-badge">${track.duration_str}</span>
            <span class="lib-badge">${track.size_str}</span>
          </div>

          <div class="library-card-actions">
            <a href="${track.download_url}" download class="btn-card-action" title="Download to device">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Save</span>
            </a>

            <button class="btn-card-action danger btn-delete-track" title="Delete from disk">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;

      // Checkbox handler
      const checkbox = card.querySelector('.library-card-checkbox');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          state.selectedLibraryFiles.add(track.filename);
          card.classList.add('selected-for-download');
        } else {
          state.selectedLibraryFiles.delete(track.filename);
          card.classList.remove('selected-for-download');
        }
        updateLibrarySummaryHeader();
      });

      // Play audio on overlay click
      card.querySelector('.library-play-btn-overlay').addEventListener('click', () => {
        playTrack(track);
      });

      // Delete handler
      card.querySelector('.btn-delete-track').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${track.title}" from library?`)) {
          try {
            const res = await fetch('/api/delete-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: track.filename })
            });
            if (res.ok) {
              state.selectedLibraryFiles.delete(track.filename);
              showToast('Track deleted', 'info');
              loadLibrary();
            }
          } catch (err) {
            showToast('Failed to delete file', 'error');
          }
        }
      });

      els.libraryListContainer.appendChild(card);
    });

    updateLibrarySummaryHeader();
  }

  // Download All (or Selected) ZIP Handler
  if (els.btnDownloadAllZip) {
    els.btnDownloadAllZip.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.library.length === 0) {
        showToast('Your library is empty. Download some tracks first!', 'info');
        return;
      }

      const url = state.selectedLibraryFiles.size > 0
        ? `/api/download-all-zip?files=${encodeURIComponent(Array.from(state.selectedLibraryFiles).join(','))}`
        : `/api/download-all-zip`;

      const trackCount = state.selectedLibraryFiles.size > 0 ? state.selectedLibraryFiles.size : state.library.length;
      showToast(`Preparing ZIP archive with ${trackCount} audio track(s)...`, 'info');

      const dlLink = document.createElement('a');
      dlLink.href = url;
      dlLink.setAttribute('download', '');
      document.body.appendChild(dlLink);
      dlLink.click();
      dlLink.remove();
    });
  }

  els.btnRefreshLibrary.addEventListener('click', loadLibrary);
  els.librarySearchInput.addEventListener('input', renderLibrary);

  // Toggle Library visibility from top bar button
  if (els.btnToggleLibrary) {
    els.btnToggleLibrary.addEventListener('click', () => {
      const isHidden = els.librarySection.classList.contains('hidden');
      if (isHidden) {
        els.librarySection.classList.remove('hidden');
        els.librarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        els.librarySection.classList.add('hidden');
      }
    });
  }

  // Hide Library button inside section
  if (els.btnCloseLibrary) {
    els.btnCloseLibrary.addEventListener('click', () => {
      els.librarySection.classList.add('hidden');
      showToast('Library hidden. Click "Saved Files" in top bar anytime to view.', 'info');
    });
  }

  // Purge / Clear all files from disk
  if (els.btnPurgeLibrary) {
    els.btnPurgeLibrary.addEventListener('click', async () => {
      if (confirm('Permanently delete ALL downloaded audio files from disk? This cannot be undone.')) {
        try {
          const res = await fetch('/api/clear-library', { method: 'POST' });
          const data = await res.json();
          if (res.ok) {
            state.library = [];
            state.selectedLibraryFiles.clear();
            els.librarySection.classList.add('hidden');
            updateLibrarySummaryHeader();
            showToast(`Cleared ${data.deleted_count || 0} audio file(s) from disk.`, 'success');
          } else {
            showToast(data.error || 'Failed to clear files', 'error');
          }
        } catch (err) {
          showToast('Error communicating with server', 'error');
        }
      }
    });
  }

  // Fresh Start button: resets entire app state to pristine clean slate
  if (els.btnFreshStart) {
    els.btnFreshStart.addEventListener('click', () => {
      els.inputUrl.value = '';
      els.inputBatchUrls.value = '';
      els.filterTracksInput.value = '';
      els.btnClear.classList.remove('show');
      els.inspectionStage.classList.add('hidden');
      els.queueSection.classList.add('hidden');
      els.librarySection.classList.add('hidden');

      // Reset to default mode: Playlist
      state.mode = 'playlist';
      els.tabs.forEach(t => t.classList.remove('active'));
      const playlistTab = document.getElementById('tab-playlist');
      if (playlistTab) playlistTab.classList.add('active');
      els.singleInputBox.classList.remove('hidden');
      els.batchInputBox.classList.add('hidden');
      els.inputUrl.placeholder = 'Paste YouTube Playlist link (e.g. https://www.youtube.com/playlist?list=...)';

      // Reset to default bitrate: Source VBR
      state.bitrate = 'best';
      els.bitrateCards.forEach(c => {
        c.classList.remove('selected');
        const radio = c.querySelector('input[type="radio"]');
        if (radio && radio.value === 'best') {
          c.classList.add('selected');
          radio.checked = true;
        }
      });
      els.selectedBitratePill.textContent = 'Source VBR';

      state.inspectedTracks = [];
      state.selectedTrackIds.clear();
      state.selectedLibraryFiles.clear();
      if (els.audioEl && !els.audioEl.paused) {
        els.audioEl.pause();
        setPlayState(false);
      }
      els.audioPlayerBar.classList.add('hidden');
      showToast('Workspace reset to clean slate (saved files remain safe on disk)', 'info');
      els.inputUrl.focus();
    });
  }

  // Open Folder Action
  els.btnOpenFolder.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      if (res.ok) {
        showToast('Opened downloads folder in file manager', 'info');
      } else {
        showToast('Could not open folder automatically', 'error');
      }
    } catch (e) {
      showToast('Error communicating with system', 'error');
    }
  });

  // ==========================================
  // Persistent In-App Audio Player
  // ==========================================
  function playTrack(track) {
    state.currentlyPlaying = track;
    els.audioPlayerBar.classList.remove('hidden');

    els.playerTrackTitle.textContent = track.title;
    els.playerTrackArtist.textContent = track.artist || 'YouTube Audio';
    els.playerBitrateTag.textContent = track.bitrate || '320 kbps';
    els.playerThumb.src = track.artwork_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80';

    els.audioEl.src = track.download_url;
    els.audioEl.play().then(() => {
      setPlayState(true);
    }).catch(err => {
      console.warn('Playback error:', err);
    });
  }

  function setPlayState(playing) {
    state.isPlaying = playing;
    if (playing) {
      els.iconPlayerPlay.classList.add('hidden');
      els.iconPlayerPause.classList.remove('hidden');
      els.playerSoundwave.classList.add('active');
    } else {
      els.iconPlayerPlay.classList.remove('hidden');
      els.iconPlayerPause.classList.add('hidden');
      els.playerSoundwave.classList.remove('active');
    }
  }

  els.btnPlayerPlayPause.addEventListener('click', () => {
    if (!state.currentlyPlaying) return;
    if (els.audioEl.paused) {
      els.audioEl.play();
      setPlayState(true);
    } else {
      els.audioEl.pause();
      setPlayState(false);
    }
  });

  els.btnPlayerSkipBack.addEventListener('click', () => {
    if (els.audioEl) els.audioEl.currentTime = Math.max(0, els.audioEl.currentTime - 10);
  });

  els.btnPlayerSkipFwd.addEventListener('click', () => {
    if (els.audioEl) els.audioEl.currentTime = Math.min(els.audioEl.duration || 0, els.audioEl.currentTime + 10);
  });

  // Scrubber & Timeline Updates
  els.audioEl.addEventListener('timeupdate', () => {
    const cur = els.audioEl.currentTime || 0;
    const dur = els.audioEl.duration || 0;

    els.playerCurTime.textContent = formatTime(cur);
    if (!isNaN(dur) && dur > 0) {
      els.playerTotTime.textContent = formatTime(dur);
      const pct = (cur / dur) * 100;
      els.playerScrubberFill.style.width = `${pct}%`;
      els.playerSeekSlider.value = pct;
    }
  });

  els.audioEl.addEventListener('ended', () => {
    setPlayState(false);
  });

  els.playerSeekSlider.addEventListener('input', (e) => {
    const pct = parseFloat(e.target.value);
    const dur = els.audioEl.duration || 0;
    if (dur > 0) {
      els.audioEl.currentTime = (pct / 100) * dur;
    }
  });

  // Volume Controls
  els.playerVolumeSlider.addEventListener('input', (e) => {
    els.audioEl.volume = parseFloat(e.target.value);
    if (els.audioEl.volume === 0) {
      els.iconVolOn.classList.add('hidden');
      els.iconVolMute.classList.remove('hidden');
    } else {
      els.iconVolOn.classList.remove('hidden');
      els.iconVolMute.classList.add('hidden');
    }
  });

  els.btnPlayerMute.addEventListener('click', () => {
    if (els.audioEl.volume > 0) {
      els.audioEl.dataset.prevVol = els.audioEl.volume;
      els.audioEl.volume = 0;
      els.playerVolumeSlider.value = 0;
      els.iconVolOn.classList.add('hidden');
      els.iconVolMute.classList.remove('hidden');
    } else {
      const prev = parseFloat(els.audioEl.dataset.prevVol || 0.8);
      els.audioEl.volume = prev;
      els.playerVolumeSlider.value = prev;
      els.iconVolOn.classList.remove('hidden');
      els.iconVolMute.classList.add('hidden');
    }
  });

  // Spacebar toggle playback shortcut
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      els.btnPlayerPlayPause.click();
    }
  });

  // Initial Loaders
  setupSSE();
  loadLibrary();
  fetchTasksPolling();
});
