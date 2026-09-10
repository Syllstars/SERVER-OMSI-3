// Configuration
// ─── Runtime environment injection ───────────────────────────────────────────
// The server (or a generated env.js loaded before this file) can expose
// window.__ENV__ = { API_BASE_URL: '...', WS_BASE_URL: '...' }
// to override the default development values below.
// Example for production: <script>window.__ENV__={ API_BASE_URL:'/api', WS_BASE_URL:'wss://yourhost/ws/logs' };</script>
const _env = window.__ENV__ || {};

const CONFIG = {
    API_BASE_URL:       _env.API_BASE_URL    || 'http://100.65.176.92:5220/api',
    WS_BASE_URL:        _env.WS_BASE_URL     || 'ws://100.65.176.92:5220/ws/logs',
    REFRESH_INTERVAL:   _env.REFRESH_INTERVAL || 2000,   // ms
    LOG_PREFIX:         '[GameServerAdmin]',
    MAX_LOG_LINES:      200,
    WS_RECONNECT_DELAY: 3000                              // ms
};

/**
 * ============================================
 * OMSI HOF LANGUAGE SUPPORT
 * ============================================
 *
 * FEATURES:
 * ✅ Syntax highlighting for OMSI HOF format
 * ✅ Section folding ([addtrip], [addbusstop], etc.)
 * ✅ Comment support (lines starting with ;)
 * ✅ Key=Value pair highlighting
 * ✅ StringCount and TripsCount variables
 * ✅ Hex color detection (#RRGGBB)
 * ✅ Auto-closing brackets and quotes
 * ✅ Bracket pair colorization
 * ✅ Sticky scroll for section headers
 * ✅ Indentation guides
 * ✅ Compatible with validation markers
 * ✅ Custom OMSI Dark theme
 *
 * LANGUAGE RULES:
 * - Sections: [SectionName]
 * - Comments: ; comment text
 * - Variables: stringcount_*, tripscount_*
 * - Colors: #RRGGBB format
 * - Key-value: key=value
 *
 * KEYBOARD SHORTCUTS:
 * - Ctrl+S: Save file
 * - Ctrl+K Ctrl+0: Fold all
 * - Ctrl+K Ctrl+J: Unfold all
 * - Ctrl+/: Toggle comment
 * - Alt+Click: Multi-cursor
 */

// ============================================
// CONSOLIDATED STATE MANAGEMENT
// ============================================
const state = {
    // Server Manager
    servers: [],
    isLoading: false,
    lastError: null,
    autoRefreshInterval: null,
    isStarting: false,

    // Instance Manager
    instances: {
        list:            [],      // raw array from GET /api/servers/instances
        isLoading:       false,
        lastError:       null,
        refreshInterval: null,    // separate 5-second interval
        searchQuery:     '',
        statusFilter:    '',
        lastFetchAt:     null,
        events:          [],      // local event log [{type, instanceId, name, ts, detail}]
        autoRestartMap:  {}       // {[instanceId]: boolean} — local optimistic state
    },

    // Logs & WebSocket
    logState: {
        serverId: null,
        serverName: null,
        logSocket: null,
        isConnected: false,
        autoScroll: true,
        logCount: 0,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5
    },

    // Timetable Manager
    timetableState: {
        routes: [],
        selectedRoute: null,
        selectedRouteId: null,
        timetables: [],
        selectedTimetable: null,
        selectedTimetableName: null,
        stops: [],
        currentStops: [],
        isEditing: false,
        isDirty: false
    },

    // 📋 HOF Manager (CORRECTED)
    hof: {
        files: [],
        selectedFile: null,
        preview: null,
        previewId: null,
        searchTerm: '',
        isUploading: false,
        isLoading: false,
        isImporting: false,
        lastError: null,

        // Edit state
        currentEditId: null,
        currentEditContent: null,
        editorInstance: null,
        editorType: null,  // 'monaco' or 'textarea'

        // ── Multi-tab workspace ──────────────────────────────────────
        openTabs:    [],   // Array of TabState objects (see openHofTab)
        activeTabId: null, // tabId of the currently visible tab
        validationState: {
            isCollapsed: false,
            isDragging: false,
            dragStartY: 0,
            panelHeight: 200,
            minHeight: 40,
            maxHeight: 600
        },

        // Navigator tree state
        navigatorExpandedGroups: null,   // lazy init on first open
        navigatorTree:           null,   // last parsed tree (for sync)
        navigatorFlatItems:      [],      // flat list for cursor sync

        // Safety / backup state
        isDirty:             false,      // unsaved changes guard
        backupTimeout:       null,       // debounce timer for auto-backup
        autoBackupSavedAt:   null,       // Date of last auto-backup
        currentEditFileName: null,       // current file name (for backup metadata)

        // Diff viewer state
        originalEditContent: null,       // pristine server version (never mutated during edit)
        diffEditorInstance:  null,       // Monaco DiffEditor instance (disposed on close)
        diffSideBySide:      true,       // rendering mode

        // Format state
        pendingFormattedContent: null    // formatted content waiting for Apply
    }
};

/**
 * Cache for HOF file route/stop counts.
 * Avoids N+1 preview fetches on every fetchHofFiles() call.
 * Key: hofId (string) → Value: { routesCount, stopsCount }
 * Invalidated selectively by operations that mutate file content.
 */
const _hofCountsCache = new Map();

/** HOF list pagination */
const HOF_PAGE_SIZE   = 20;
let   _hofCurrentPage = 1;

// Guard: OMSI language providers registered only once per Monaco instance
let _omsiProvidersRegistered = false;

/**
 * Utility: Log to console with prefix
 */
function log(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `${CONFIG.LOG_PREFIX} [${timestamp}] ${message}`;
    if (data) {
        console.log(logMessage, data);
    } else {
        console.log(logMessage);
    }
    updateDebugInfo(logMessage);
}

/**
 * Update debug info in footer
 */
function updateDebugInfo(message) {
    const debugEl = document.getElementById('debug-info');
    if (debugEl) {
        debugEl.textContent = `Debug: ${message}`;
    }
}

/**
 * Utility: Update timestamp
 */
function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleTimeString();
}

/**
 * Utility: Update server statistics
 */
function updateStats() {
    const reg = window.__registryServers || [];
    const total = state.servers.length + reg.length;
    const running = state.servers.filter(s => s.isRunning).length + reg.filter(s => s.online).length;

    const statsEl = document.getElementById('server-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <span class="stat">📊 Total: <strong>${total}</strong></span>
            <span class="stat">🟢 Running: <strong>${running}</strong></span>
        `;
    }

    log(`Stats updated: ${running}/${total} servers running`);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * ============================================
 *  SERVERS MODULE
 * ============================================
 */

async function fetchServers() {
    if (state.isLoading) {
        log('Skipping refresh: already loading');
        return;
    }

    state.isLoading = true;
    state.lastError = null;

    try {
        log('Fetching servers...');
        const response = await fetch(`${CONFIG.API_BASE_URL}/servers`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        state.servers = Array.isArray(data) ? data : [];
        state.isLoading = false;

        log(`Fetched ${state.servers.length} server(s)`, state.servers);
        updateLastUpdate();
        updateStats();
        renderServers();
        clearError();
        updateSyncStatus(true);
    } catch (error) {
        state.isLoading = false;
        log('Error fetching servers:', error);
        state.lastError = error.message;
        showError(`Failed to fetch servers: ${error.message}`);
        renderServers();
        updateSyncStatus(false);
    } finally {
        state.isLoading = false;
    }
}

function isPortInUse(port) {
    return state.servers.some(s => s.port === parseInt(port) && s.isRunning);
}

async function startServer(mapName, port) {
    if (isPortInUse(port)) {
        showError(`⚠ Port ${port} is already in use by another running server`);
        log('Port conflict detected', { port, mapName });
        return;
    }

    state.isStarting = true;
    const startBtn = document.getElementById('start-btn');

    try {
        startBtn.disabled = true;
        startBtn.classList.add('loader-spinner');
        startBtn.textContent = '⏳ Starting...';

        log('Starting server...', { mapName, port });

        const response = await fetch(`${CONFIG.API_BASE_URL}/servers/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mapName, port: parseInt(port) })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `HTTP Error: ${response.status}`);
        }

        const newServer = await response.json();
        log('Server started successfully', newServer);

        await fetchServers();
        document.getElementById('start-server-form').reset();
        showSuccess(`✓ Server started successfully on port ${port}`);
    } catch (error) {
        log('Error starting server:', error);
        showError(`Failed to start server: ${error.message}`);
    } finally {
        state.isStarting = false;
        startBtn.disabled = false;
        startBtn.classList.remove('loader-spinner');
        startBtn.textContent = '▶ Start Server';
    }
}

async function stopServer(serverId) {
    try {
        log('Stopping server...', { serverId });

        const response = await fetch(`${CONFIG.API_BASE_URL}/servers/${serverId}/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `HTTP Error: ${response.status}`);
        }

        log('Server stopped successfully', { serverId });
        await fetchServers();
        showSuccess(`✓ Server ${serverId} stopped successfully`);
    } catch (error) {
        log('Error stopping server:', error);
        showError(`Failed to stop server: ${error.message}`);
    }
}

async function restartServer(serverId, mapName, port) {
    try {
        log('Restarting server...', { serverId, mapName, port });
        await stopServer(serverId);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await startServer(mapName, port);
        showSuccess(`✓ Server ${serverId} restarted successfully`);
    } catch (error) {
        log('Error restarting server:', error);
        showError(`Failed to restart server: ${error.message}`);
    }
}

function renderServers() {
    const container = document.getElementById('servers-container');
    container.innerHTML = '';

    if (state.lastError && state.servers.length === 0) {
        container.innerHTML = `
            <div class="error-message">
                Unable to connect to server. Please check your API configuration.
            </div>
        `;
    }

    if (state.isLoading && state.servers.length === 0) {
        container.innerHTML = '<div class="loading">Loading servers...</div>';
        return;
    }

    if (state.servers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎮</div>
                <div class="empty-state-text">No servers running</div>
                <div class="empty-state-subtext">Start a new server using the form on the left</div>
            </div>
        `;
        return;
    }

    state.servers.forEach(server => {
        const isRunning = server.isRunning;
        const statusClass = isRunning ? '' : 'stopped';
        const statusText = isRunning ? '● Running' : '● Stopped';

        const serverCard = document.createElement('div');
        serverCard.className = `server-card ${isRunning ? 'running' : 'stopped'}`;
        serverCard.innerHTML = `
            <div class="server-card-header">
                <span class="server-name">${escapeHtml(server.mapName || 'Server')}</span>
                <span class="server-status ${statusClass}">${statusText}</span>
            </div>
            <div class="server-details">
                <div class="detail-item">
                    <span class="detail-label">Map</span>
                    <span class="detail-value">${escapeHtml(server.mapName || 'N/A')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Port</span>
                    <span class="detail-value">${server.port || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">ID</span>
                    <span class="detail-value" title="${server.id}">${escapeHtml(server.id?.substring(0, 8) || 'N/A')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">PID</span>
                    <span class="detail-value">${server.processId || 'N/A'}</span>
                </div>
            </div>
            <div class="server-actions">
                ${isRunning ? `
                    <button class="btn btn-secondary action-logs">
                        📋 View Logs
                    </button>
                    <button class="btn btn-danger action-stop">
                        ⏹ Stop
                    </button>
                    <button class="btn btn-secondary action-restart">
                        🔄 Restart
                    </button>
                ` : `
                    <button class="btn btn-secondary" disabled>
                        ✓ Already Stopped
                    </button>
                `}
            </div>
        `;

        if (isRunning) {
            const logsBtn = serverCard.querySelector('.action-logs');
            const stopBtn = serverCard.querySelector('.action-stop');
            const restartBtn = serverCard.querySelector('.action-restart');

            logsBtn.addEventListener('click', () => {
                openLogsModal(server.id, server.mapName);
            });

            stopBtn.addEventListener('click', () => {
                if (confirm(`Stop server ${escapeHtml(server.mapName)}?`)) {
                    stopServer(server.id);
                }
            });

            restartBtn.addEventListener('click', () => {
                if (confirm(`Restart server ${escapeHtml(server.mapName)}?`)) {
                    restartServer(server.id, server.mapName, server.port);
                }
            });
        }

        container.appendChild(serverCard);
    });
}

function handleStartServerForm(event) {
    event.preventDefault();

    const mapName = document.getElementById('map-name').value.trim();
    const port = document.getElementById('port').value.trim();

    if (!mapName || !port) {
        showError('Please fill in all fields');
        return;
    }

    const form = document.getElementById('start-server-form');
    const inputs = form.querySelectorAll('input');
    inputs.forEach(input => input.disabled = true);

    startServer(mapName, port).finally(() => {
        inputs.forEach(input => input.disabled = false);
    });
}

function showError(message) {
    log('Error:', message);
    showToast(message, 'error');
}

function showSuccess(message) {
    log('Success:', message);
    showToast(message, 'success');
}

function clearError() {
    // Removed — toasts auto-dismiss; kept as stub for any future call sites.
}

function updateSyncStatus(isOnline) {
    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
        if (isOnline) {
            statusEl.textContent = '● Connected';
            statusEl.classList.remove('offline');
        } else {
            statusEl.textContent = '● Disconnected';
            statusEl.classList.add('offline');
        }
    }
}

/**
 * ============================================
 *  TIMETABLE MODULE
 * ============================================
 */

async function fetchRoutes() {
    try {
        log('Fetching routes...');
        const response = await fetch(`${CONFIG.API_BASE_URL}/routes`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        state.timetableState.routes = Array.isArray(data) ? data : [];

        log(`Fetched ${state.timetableState.routes.length} route(s)`, state.timetableState.routes);
        renderRoutes();
    } catch (error) {
        log('Error fetching routes:', error);
        showTimetableError(`Failed to fetch routes: ${error.message}`);
    }
}

async function fetchTimetables(routeId) {
    try {
        log(`Fetching timetables for route ${routeId}...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/routes/${routeId}/timetables`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        state.timetableState.timetables = Array.isArray(data) ? data : [];

        log(`Fetched ${state.timetableState.timetables.length} timetable(s)`);
        renderTimetables();
    } catch (error) {
        log('Error fetching timetables:', error);
        showTimetableError(`Failed to fetch timetables: ${error.message}`);
    }
}

async function fetchStops(routeId) {
    try {
        log(`Fetching stops for route ${routeId}...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/routes/${routeId}/stops`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        state.timetableState.stops = Array.isArray(data) ? data : [];

        log(`Fetched ${state.timetableState.stops.length} stop(s)`);
    } catch (error) {
        log('Error fetching stops:', error);
        showTimetableError(`Failed to fetch stops: ${error.message}`);
    }
}

async function createTimetable(routeId) {
    try {
        log(`Creating new timetable for route ${routeId}...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/routes/${routeId}/timetables`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `Timetable ${new Date().toLocaleString()}`,
                stops: []
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const newTimetable = await response.json();
        log('Timetable created successfully', newTimetable);

        state.timetableState.selectedTimetable = newTimetable.id;
        state.timetableState.currentStops = [];

        await fetchTimetables(routeId);
        selectTimetable(newTimetable.id);

        showTimetableSuccess('Timetable created successfully');
    } catch (error) {
        log('Error creating timetable:', error);
        showTimetableError(`Failed to create timetable: ${error.message}`);
    }
}

async function selectTimetable(timetableId) {
    try {
        log(`Selecting timetable ${timetableId}...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/timetables/${timetableId}`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        state.timetableState.selectedTimetable = timetableId;
        state.timetableState.selectedTimetableName = data.name || null;
        state.timetableState.currentStops = data.stops || [];
        state.timetableState.isDirty = false;

        log(`Loaded timetable ${timetableId}`, data);
        renderTimetableEditor();
    } catch (error) {
        log('Error selecting timetable:', error);
        showTimetableError(`Failed to load timetable: ${error.message}`);
    }
}

async function saveTimetable() {
    try {
        const tbody = document.getElementById('timetable-tbody');
        const rows = tbody.querySelectorAll('tr');
        let isValid = true;

        rows.forEach((row) => {
            const arrivalInput = row.querySelector('.arrival-time');
            const departureInput = row.querySelector('.departure-time');

            if (!isValidTime(arrivalInput.value) || !isValidTime(departureInput.value)) {
                row.classList.add('error');
                isValid = false;
            } else {
                row.classList.remove('error');
            }
        });

        if (!isValid) {
            showTimetableError('Please fix time format errors (HH:mm)');
            return;
        }

        const stops = [];
        rows.forEach((row, index) => {
            const stopSelect = row.querySelector('.stop-select');
            const arrivalInput = row.querySelector('.arrival-time');
            const departureInput = row.querySelector('.departure-time');

            stops.push({
                stopId: stopSelect.value,
                stopName: stopSelect.options[stopSelect.selectedIndex].text,
                arrivalTime: arrivalInput.value,
                departureTime: departureInput.value,
                order: index + 1
            });
        });

        log(`Saving timetable ${state.timetableState.selectedTimetable}...`, stops);

        const response = await fetch(
            `${CONFIG.API_BASE_URL}/timetables/${state.timetableState.selectedTimetable}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stops })
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const saved = await response.json();
        state.timetableState.currentStops = saved.stops || [];
        state.timetableState.isDirty = false;

        log('Timetable saved successfully', saved);
        showTimetableSuccess('Timetable saved successfully!');
        renderTimetableEditor();
    } catch (error) {
        log('Error saving timetable:', error);
        showTimetableError(`Failed to save timetable: ${error.message}`);
    }
}

async function renameTimetable(timetableId, newName) {
    try {
        log(`Renaming timetable ${timetableId} to "${newName}"...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/timetables/${timetableId}/rename`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newName })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const updated = await response.json();
        state.timetableState.selectedTimetableName = updated.name;

        if (state.timetableState.selectedRouteId) {
            await fetchTimetables(state.timetableState.selectedRouteId);
        }
        renderTimetableEditor();

        log('Timetable renamed successfully', updated);
        showTimetableSuccess('Timetable renamed successfully');
    } catch (error) {
        log('Error renaming timetable:', error);
        showTimetableError(`Failed to rename timetable: ${error.message}`);
    }
}

function isValidTime(timeString) {
    const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return regex.test(timeString);
}

function addStopRow() {
    const tbody = document.getElementById('timetable-tbody');
    const newRow = document.createElement('tr');
    const order = tbody.querySelectorAll('tr').length + 1;

    newRow.innerHTML = `
        <td><input type="number" class="table-input order-input" value="${order}" min="1" readonly></td>
        <td>
            <select class="table-input stop-select">
                <option value="">-- Select Stop --</option>
                ${state.timetableState.stops.map(stop =>
        `<option value="${stop.id}">${escapeHtml(stop.name)}</option>`
    ).join('')}
            </select>
        </td>
        <td><input type="time" class="table-input arrival-time" value="08:00" required></td>
        <td><input type="time" class="table-input departure-time" value="08:05" required></td>
        <td>
            <div class="table-actions">
                <button type="button" class="table-btn remove-row-btn">🗑 Remove</button>
            </div>
        </td>
    `;

    const removeBtn = newRow.querySelector('.remove-row-btn');
    removeBtn.addEventListener('click', () => {
        newRow.remove();
        reorderRows();
        state.timetableState.isDirty = true;
        log('Stop row removed');
    });

    tbody.appendChild(newRow);
    state.timetableState.isDirty = true;
    log('New stop row added');
}

function reorderRows() {
    const tbody = document.getElementById('timetable-tbody');
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((row, index) => {
        const orderInput = row.querySelector('.order-input');
        orderInput.value = index + 1;
    });
}

function renderRoutes() {
    const selector = document.getElementById('route-selector');
    const options = ['<option value="">-- Select a route --</option>'];

    state.timetableState.routes.forEach(route => {
        options.push(`<option value="${route.id}">${escapeHtml(route.name || route.id)}</option>`);
    });

    selector.innerHTML = options.join('');
}

function renderTimetables() {
    const selector = document.getElementById('timetable-selector');
    const selectorGroup = document.getElementById('timetable-selector-group');

    if (state.timetableState.timetables.length === 0) {
        selectorGroup.style.display = 'none';
        return;
    }

    selectorGroup.style.display = 'flex';

    const options = ['<option value="">-- Select a timetable --</option>'];

    state.timetableState.timetables.forEach(tt => {
        options.push(`<option value="${tt.id}">${escapeHtml(tt.name || `Timetable ${tt.id}`)}</option>`);
    });

    selector.innerHTML = options.join('');
    selector.value = state.timetableState.selectedTimetable || '';
}

function renderTimetableEditor() {
    if (!state.timetableState.selectedTimetable) {
        document.getElementById('timetable-editor').style.display = 'none';
        return;
    }

    document.getElementById('timetable-editor').style.display = 'block';

    const routeName = state.timetableState.selectedRoute || 'Unknown Route';
    const timetableName = state.timetableState.selectedTimetableName || 'Untitled timetable';
    document.getElementById('timetable-info').textContent = `${timetableName} — Route: ${routeName}`;

    const tbody = document.getElementById('timetable-tbody');
    tbody.innerHTML = '';

    state.timetableState.currentStops.forEach((stop, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="number" class="table-input order-input" value="${index + 1}" min="1" readonly></td>
            <td>
                <select class="table-input stop-select">
                    <option value="">-- Select Stop --</option>
                    ${state.timetableState.stops.map(s =>
            `<option value="${s.id}" ${s.id === stop.stopId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
        ).join('')}
                </select>
            </td>
            <td><input type="time" class="table-input arrival-time" value="${stop.arrivalTime}" required></td>
            <td><input type="time" class="table-input departure-time" value="${stop.departureTime}" required></td>
            <td>
                <div class="table-actions">
                    <button type="button" class="table-btn remove-row-btn">🗑 Remove</button>
                </div>
            </td>
        `;

        const removeBtn = row.querySelector('.remove-row-btn');
        removeBtn.addEventListener('click', () => {
            row.remove();
            reorderRows();
            state.timetableState.isDirty = true;
            log('Stop row removed');
        });

        tbody.appendChild(row);
    });

    log('Timetable editor rendered with ' + state.timetableState.currentStops.length + ' stops');
}

function showTimetableError(message) {
    log('Timetable Error:', message);
    showToast(message, 'error');
}

function showTimetableSuccess(message) {
    log('Timetable Success:', message);
    showToast(message, 'success');
}

/**
 * ============================================
 *  WEBSOCKET & LOGS MODULE
 * ============================================
 */

function connectLogs(serverId, serverName) {
    log(`Establishing WebSocket connection for server ${serverId}...`);

    state.logState.serverId = serverId;
    state.logState.serverName = serverName;
    state.logState.logCount = 0;
    state.logState.reconnectAttempts = 0;

    document.getElementById('log-server-name').textContent = escapeHtml(serverName);

    const logContent = document.getElementById('log-content');
    logContent.innerHTML = '<div class="terminal-loading">Connecting to WebSocket...</div>';

    updateLogWSStatus('connecting');

    try {
        const wsUrl = `${CONFIG.WS_BASE_URL}/${serverId}`;
        state.logState.logSocket = new WebSocket(wsUrl);

        state.logState.logSocket.onopen = () => {
            log(`WebSocket connected to ${wsUrl}`);
            state.logState.isConnected = true;
            state.logState.reconnectAttempts = 0;
            updateLogWSStatus('connected');
            logContent.innerHTML = '';
        };

        state.logState.logSocket.onmessage = (event) => {
            const logLine = event.data;
            appendLog(logLine);
        };

        state.logState.logSocket.onclose = () => {
            log('WebSocket connection closed');
            state.logState.isConnected = false;
            updateLogWSStatus('disconnected');

            // Snapshot the intended server at schedule time.
            // If disconnectLogs() runs during the delay, serverId becomes null —
            // the guard inside the callback detects this and aborts the reconnect.
            const intentServerId   = state.logState.serverId;
            const intentServerName = state.logState.serverName;

            if (intentServerId && state.logState.reconnectAttempts < state.logState.maxReconnectAttempts) {
                state.logState.reconnectAttempts++;
                log(`Reconnection attempt ${state.logState.reconnectAttempts}/${state.logState.maxReconnectAttempts}...`);
                setTimeout(() => {
                    // Abort if the modal was closed (serverId cleared) during the delay
                    if (state.logState.serverId !== intentServerId) {
                        log('Reconnect aborted — modal closed during delay');
                        return;
                    }
                    connectLogs(intentServerId, intentServerName);
                }, CONFIG.WS_RECONNECT_DELAY);
            } else if (state.logState.reconnectAttempts >= state.logState.maxReconnectAttempts) {
                log('Max reconnection attempts reached');
                showErrorInTerminal('Connection lost. Max reconnection attempts reached.');
            }
        };

        state.logState.logSocket.onerror = (error) => {
            log('WebSocket error:', error);
            updateLogWSStatus('disconnected');
            showErrorInTerminal('WebSocket error occurred. Check console for details.');
        };

    } catch (error) {
        log('Error connecting to WebSocket:', error);
        updateLogWSStatus('disconnected');
        showErrorInTerminal(`Failed to connect to WebSocket: ${error.message}`);
    }
}

function appendLog(line) {
    const logContent = document.getElementById('log-content');

    const lineEl = document.createElement('div');   // div instead of span+br — simpler
    lineEl.className = 'terminal-line';

    let content = String(line).trim();

    if (content.includes('[ERR]') || content.toLowerCase().includes('error')) {
        lineEl.classList.add('error');
    } else if (content.includes('[WARN]') || content.toLowerCase().includes('warning')) {
        lineEl.classList.add('warning');
    } else if (content.includes('[OUT]') || content.toLowerCase().includes('success')) {
        lineEl.classList.add('success');
    } else if (content.includes('[INFO]') || content.toLowerCase().includes('info')) {
        lineEl.classList.add('info');
    }

    lineEl.textContent = content;
    logContent.appendChild(lineEl);

    state.logState.logCount++;

    // Trim oldest line when over limit — single element removal (div, no orphan br risk)
    if (state.logState.logCount > CONFIG.MAX_LOG_LINES) {
        const oldest = logContent.querySelector('.terminal-line');
        if (oldest) {
            oldest.remove();
            state.logState.logCount--;
        }
    }

    if (state.logState.autoScroll) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function showErrorInTerminal(message) {
    const logContent = document.getElementById('log-content');
    const errorEl = document.createElement('div');
    errorEl.className = 'terminal-line error';
    errorEl.textContent = `[ERROR] ${message}`;
    logContent.appendChild(errorEl);

    if (state.logState.autoScroll) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function disconnectLogs() {
    log('Disconnecting WebSocket...');

    if (state.logState.logSocket) {
        state.logState.logSocket.close();
        state.logState.logSocket = null;
    }

    state.logState.isConnected = false;
    state.logState.serverId = null;
    state.logState.serverName = null;
    state.logState.logCount = 0;
}

function updateLogWSStatus(status) {
    const statusEl = document.getElementById('log-ws-status');
    if (!statusEl) return;

    if (status === 'connecting') {
        statusEl.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'ws-indicator connecting';
        statusEl.appendChild(dot);
        statusEl.appendChild(document.createTextNode(' Connecting...'));
    } else if (status === 'connected') {
        statusEl.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'ws-indicator connected';
        statusEl.appendChild(dot);
        statusEl.appendChild(document.createTextNode(' Connected (LIVE)'));
    } else if (status === 'disconnected') {
        statusEl.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'ws-indicator disconnected';
        statusEl.appendChild(dot);
        statusEl.appendChild(document.createTextNode(' Disconnected'));
    }
}

function openLogsModal(serverId, serverName) {
    log(`Opening logs modal for server ${serverId}`);

    const modal = document.getElementById('log-modal');
    modal.classList.remove('hidden');

    connectLogs(serverId, serverName);

    const handleKeyDown = (e) => {
        if (e.key === 'Escape' || (e.altKey && e.key === 'q')) {
            closeLogsModal();
        }
    };

    document.addEventListener('keydown', handleKeyDown);
    modal.dataset.keydownHandler = handleKeyDown;
}

function closeLogsModal() {
    log('Closing logs modal');

    const modal = document.getElementById('log-modal');
    modal.classList.add('hidden');

    disconnectLogs();

    const handler = modal.dataset.keydownHandler;
    if (handler) {
        document.removeEventListener('keydown', handler);
        delete modal.dataset.keydownHandler;
    }
}

/**
 * ============================================
 *  HOF MANAGER MODULE (CORRECTED)
 * ============================================
 */

/**
 * 📋 Handle file selection (click or drop)
 */
async function handleHofFile(file) {
    // Validate file type
    if (!file || !file.name.endsWith('.hof')) {
        showHofError('⚠ Please select a valid .hof file');
        log('Invalid file type', { name: file?.name });
        return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        showHofError('⚠ File too large (max 10MB)');
        log('File size exceeded', { size: file.size });
        return;
    }

    try {
        await uploadHofFile(file);
    } catch (error) {
        log('Error handling HOF file:', error);
    }
}

/**
 * 📋 Upload HOF file (CORRECTED)
 */
async function uploadHofFile(file) {
    // Prevent double uploads
    if (state.hof.isUploading) {
        log('Upload already in progress');
        return;
    }

    state.hof.isUploading = true;
    const dropzone = document.getElementById('hof-dropzone');
    const uploadBtn = document.getElementById('upload-hof-btn');

    try {
        log('Uploading HOF file...', { fileName: file.name, size: file.size });

        // Show loading state
        if (dropzone) dropzone.style.opacity = '0.6';
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.classList.add('loader-spinner');
            uploadBtn.textContent = '⏳ Uploading...';
        }

        // Create FormData
        const formData = new FormData();
        formData.append('file', file);

        // Upload
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        log('HOF file uploaded successfully', result);

        showHofSuccess(`✓ File uploaded successfully! (ID: ${result.id?.substring(0, 8)})`);

        // Reset file input
        const fileInput = document.getElementById('hof-file-input');
        if (fileInput) fileInput.value = '';

        // Refresh HOF files list
        await fetchHofFiles();

    } catch (error) {
        log('Error uploading HOF file:', error);
        showHofError(`Failed to upload HOF file: ${error.message}`);
    } finally {
        state.hof.isUploading = false;

        // Restore UI
        if (dropzone) dropzone.style.opacity = '1';
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.classList.remove('loader-spinner');
            uploadBtn.textContent = '📤 Upload HOF File';
        }
    }
}

/**
 * 📋 Fetch HOF files list
 *
 * Uses a module-level _hofCountsCache (Map<hofId, {routesCount,stopsCount}>)
 * to avoid firing one GET /preview per file on every refresh.
 * Cache entries are invalidated by uploadHofFile, replaceHofFile,
 * importHofFile, deleteHofFile, rollbackServerNow, and saveHofFileContent
 * (parse-after-save path).
 */
async function fetchHofFiles() {
    state.hof.isLoading = true;
    try {
        log('Fetching HOF files...');
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        const hofFiles = Array.isArray(data) ? data : [];

        // Only fetch preview for files not already in the cache
        const uncached = hofFiles.filter(f => !_hofCountsCache.has(f.id));

        if (uncached.length > 0) {
            log(`Fetching preview counts for ${uncached.length} uncached file(s)...`);
            await Promise.all(
                uncached.map(async (file) => {
                    try {
                        const previewResponse = await fetch(`${CONFIG.API_BASE_URL}/hof/${file.id}/preview`);
                        if (!previewResponse.ok) {
                            _hofCountsCache.set(file.id, { routesCount: 0, stopsCount: 0 });
                            return;
                        }
                        const preview = await previewResponse.json();
                        const routes  = Array.isArray(preview.routes) ? preview.routes : [];
                        const stopsCount = routes.reduce((sum, route) => {
                            return sum + (Array.isArray(route.stops) ? route.stops.length : 0);
                        }, 0);
                        _hofCountsCache.set(file.id, { routesCount: routes.length, stopsCount });
                    } catch {
                        _hofCountsCache.set(file.id, { routesCount: 0, stopsCount: 0 });
                    }
                })
            );
        }

        // Merge cached counts into file objects
        state.hof.files = hofFiles.map(file => {
            const counts = _hofCountsCache.get(file.id) || { routesCount: 0, stopsCount: 0 };
            return { ...file, ...counts };
        });

        log(`Fetched ${state.hof.files.length} HOF file(s) (${uncached.length} preview(s) loaded)`);
        renderHofFiles();
    } catch (error) {
        log('Error fetching HOF files:', error);
        state.hof.lastError = error.message;
        showHofError(`Failed to fetch HOF files: ${error.message}`);
        renderHofFiles();
    } finally {
        state.hof.isLoading = false;
    }
}

/**
 * 📋 Preview HOF file without importing (CORRECTED)
 */
async function previewHofFile(hofId) {
    try {
        log(`Previewing HOF file ${hofId}...`);
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/preview`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        // DEBUG LOGS
        log('HOF preview data loaded', { mapName: data.mapName, routes: data.routes?.length });

        state.hof.preview = data;
        state.hof.previewId = hofId;

        log('HOF preview loaded', data);
        renderHofPreview(data);
    } catch (error) {
        log('Error previewing HOF file:', error);
        showHofError(`Failed to preview HOF file: ${error.message}`);
    }
}

/**
 * 📋 Import HOF file
 */
async function importHofFile(hofId) {
    try {
        const confirmed = confirm(
            'Are you sure you want to import this HOF file?\n\n' +
            'This will create/update routes and stops in the database.'
        );

        if (!confirmed) {
            log('HOF import cancelled by user');
            return;
        }

        state.hof.isImporting = true;
        log(`Importing HOF file ${hofId}...`);

        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/parse`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        log('HOF file imported successfully', result);

        showHofSuccess(
            `✓ HOF imported successfully!\n` +
            `Created ${result.routesCreated || 0} routes and ${result.stopsCreated || 0} stops.`
        );

        // Close preview
        document.getElementById('hof-preview-section').style.display = 'none';
        state.hof.preview = null;
        state.hof.previewId = null;

        // Mark as imported in local state immediately so the Import button
        // disables without waiting for the next fetchHofFiles() round-trip.
        // The flag is also preserved via spread if the API returns it.
        const localFile = state.hof.files.find(f => f.id === hofId);
        if (localFile) localFile.imported = true;
        renderHofFiles();

        // Invalidate cached counts — parse creates/updates routes and stops
        _hofCountsCache.delete(hofId);

        // Refresh data
        await fetchHofFiles();
        await fetchRoutes();

    } catch (error) {
        log('Error importing HOF file:', error);
        showHofError(`Failed to import HOF file: ${error.message}`);
    } finally {
        state.hof.isImporting = false;
    }
}

/**
 * 📋 Render HOF files table
 */
function renderHofFiles() {
    const tbody = document.getElementById('hof-files-tbody');
    if (!tbody) {
        log('HOF files tbody not found');
        return;
    }

    tbody.innerHTML = '';

    if (state.hof.files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No HOF files uploaded yet</td></tr>';
        return;
    }

    state.hof.files.forEach(file => {
        const row = document.createElement('tr');
        // data attributes used by the DOM-only search filter
        row.dataset.name = (file.fileName || '').toLowerCase();
        row.dataset.map  = (file.mapName  || '').toLowerCase();

        row.innerHTML = `
            <td><code>${escapeHtml(file.id?.substring(0, 8) || 'N/A')}</code></td>
            <td>${escapeHtml(file.fileName || 'Unknown')}</td>
            <td>${escapeHtml(file.mapName || 'N/A')}</td>
            <td><strong>${file.routesCount || 0}</strong></td>
            <td><strong>${file.stopsCount || 0}</strong></td>
            <td>
                <div class="hof-actions">
                    <button type="button" class="hof-btn hof-btn-preview" title="Preview">
                        👁 Preview
                    </button>
                    <button type="button" class="hof-btn hof-btn-download" title="Download">
                        ⬇️ Download
                    </button>
                    <button type="button" class="hof-btn hof-btn-edit" title="Edit">
                        ✏️ Edit
                    </button>
                    <button type="button" class="hof-btn hof-btn-replace" title="Replace file">
                        🔄 Replace
                    </button>
                    <button type="button" class="hof-btn hof-btn-import" title="Import" ${file.imported ? 'disabled' : ''}>
                        📥 Import
                    </button>
                    <button type="button" class="hof-btn hof-btn-export" title="Export ZIP package">
                        📦 Export
                    </button>
                    <button type="button" class="hof-btn hof-btn-delete" title="Delete">
                        🗑 Delete
                    </button>
                </div>
            </td>
        `;

        const previewBtn = row.querySelector('.hof-btn-preview');
        const downloadBtn = row.querySelector('.hof-btn-download');
        const editBtn = row.querySelector('.hof-btn-edit');
        const replaceBtn = row.querySelector('.hof-btn-replace');
        const importBtn = row.querySelector('.hof-btn-import');
        const exportBtn = row.querySelector('.hof-btn-export');
        const deleteBtn = row.querySelector('.hof-btn-delete');

        /**
         * Disable all buttons in this row while an async operation runs,
         * restore them (and the clicked button's label) when done.
         * Prevents double-clicks and provides visual feedback.
         */
        const allBtns = [previewBtn, downloadBtn, editBtn, replaceBtn, importBtn, exportBtn, deleteBtn];
        async function withRowBusy(btn, label, asyncFn) {
            if (btn.disabled) return;                       // already busy
            const original = btn.innerHTML;
            allBtns.forEach(b => { if (b) b.disabled = true; });
            btn.innerHTML = `⏳ ${label}`;
            try {
                await asyncFn();
            } finally {
                allBtns.forEach(b => { if (b) b.disabled = false; });
                // Restore import button disabled state if file is imported
                if (importBtn && file.imported) importBtn.disabled = true;
                btn.innerHTML = original;
            }
        }

        previewBtn.addEventListener('click', () =>
            withRowBusy(previewBtn, 'Loading…', () => previewHofFile(file.id))
        );

        downloadBtn.addEventListener('click', () =>
            withRowBusy(downloadBtn, 'Downloading…', () => downloadHofFile(file.id, file.fileName))
        );

        editBtn.addEventListener('click', () =>
            withRowBusy(editBtn, 'Opening…', () => openHofEditModal(file.id, file.fileName))
        );

        replaceBtn.addEventListener('click', () => {
            // openReplaceFilePicker is synchronous (just opens a file picker)
            openReplaceFilePicker(file.id);
        });

        importBtn.addEventListener('click', () =>
            withRowBusy(importBtn, 'Importing…', () => importHofFile(file.id))
        );

        exportBtn.addEventListener('click', () =>
            withRowBusy(exportBtn, 'Exporting…', () => exportHofPackage(file.id, file.fileName))
        );

        deleteBtn.addEventListener('click', () =>
            withRowBusy(deleteBtn, 'Deleting…', () => deleteHofFile(file.id, file.fileName))
        );

        tbody.appendChild(row);
    });

    // Re-apply active search filter then paginate
    const searchInput = document.getElementById('hof-list-search');
    const query = searchInput?.value?.trim() || '';
    if (query) {
        _applyHofListFilter(query);   // sets hof-row-hidden, then calls _applyHofPagination
    } else {
        _applyHofPagination();        // no filter — just paginate
    }
}

/**
 * 📋 Render HOF preview (CORRECTED)
 */
function renderHofPreview(data) {
    const previewSection = document.getElementById('hof-preview-section');
    if (!previewSection) {
        log('Preview section not found');
        return;
    }

    // Validate data structure
    if (!data || typeof data !== 'object') {
        log('Invalid preview data:', data);
        showHofError('Invalid preview data');
        return;
    }

    // Extract routes safely
    const routes = Array.isArray(data.routes) ? data.routes : [];
    const mapName = data.mapName || 'Unknown';

    // Calculate counters
    const routeCount = routes.length;
    const stopCount = routes.reduce((sum, route) => {
        const stops = Array.isArray(route.stops) ? route.stops : [];
        return sum + stops.length;
    }, 0);

    log(`Preview Stats - Routes: ${routeCount}, Stops: ${stopCount}, Map: ${mapName}`);

    // Update map name
    const mapNameEl = document.getElementById('preview-map-name');
    if (mapNameEl) {
        mapNameEl.textContent = escapeHtml(mapName);
    }

    // Update route counter
    const routeCountEl = document.getElementById('hof-route-count');
    if (routeCountEl) {
        routeCountEl.textContent = routeCount;
    }

    // Update stop counter
    const stopCountEl = document.getElementById('hof-stop-count');
    if (stopCountEl) {
        stopCountEl.textContent = stopCount;
    }

    // Show preview section
    previewSection.style.display = 'block';

    // Reset search and render routes
    state.hof.searchTerm = '';
    const searchInput = document.getElementById('routes-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    // Render routes
    const routesList = document.getElementById('routes-list');
    if (routesList) {
        renderRoutesList(routes, routesList);
    }

    log('HOF preview rendered successfully');
}

/**
 * 📋 Render routes list with stops (CORRECTED)
 */
function renderRoutesList(routes, container) {
    if (!container) {
        log('Routes list container not found');
        return;
    }

    // Validate routes
    if (!Array.isArray(routes)) {
        log('Routes is not an array:', routes);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No routes available</div>';
        return;
    }

    container.innerHTML = '';

    // Filter routes based on search term
    const filteredRoutes = routes.filter(route => {
        if (!state.hof.searchTerm) return true;

        const searchLower = state.hof.searchTerm.toLowerCase();

        // Use correct camelCase property names
        const name = (route.name || '').toLowerCase();
        const lineNumber = (route.lineNumber || '').toLowerCase();
        const direction = (route.direction || '').toLowerCase();

        return (
            name.includes(searchLower) ||
            lineNumber.includes(searchLower) ||
            direction.includes(searchLower)
        );
    });

    if (filteredRoutes.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No routes found</div>';
        return;
    }

    log(`Rendering ${filteredRoutes.length} filtered routes`);

    filteredRoutes.forEach((route, index) => {
        // Validate route object
        if (!route || typeof route !== 'object') {
            log('Invalid route object:', route);
            return;
        }

        const routeDiv = document.createElement('div');
        routeDiv.className = 'route-item';

        // Extract route properties with correct camelCase names
        const lineNumber = route.lineNumber || '-';
        const routeName = route.name || 'Unknown Route';
        const direction = route.direction || '';
        const stops = Array.isArray(route.stops) ? route.stops : [];

        const header = document.createElement('div');
        header.className = 'route-header';
        header.innerHTML = `
            <div class="route-info">
                <div class="route-line">${escapeHtml(lineNumber)} - ${escapeHtml(routeName)}</div>
                <div class="route-direction">${escapeHtml(direction)}</div>
                <div class="route-stop-count">
                    <small>${stops.length} stop${stops.length !== 1 ? 's' : ''}</small>
                </div>
            </div>
            <div class="route-toggle">▶</div>
        `;

        const stopsList = document.createElement('div');
        stopsList.className = 'stops-list';

        if (stops.length > 0) {
            stops.forEach(stop => {
                // Validate stop object
                if (!stop || typeof stop !== 'object') {
                    log('Invalid stop object:', stop);
                    return;
                }

                const stopDiv = document.createElement('div');
                stopDiv.className = 'stop-item';

                // Extract stop properties with correct camelCase names
                const stopOrder = stop.order || '';
                const stopName = stop.name || 'Unknown Stop';

                stopDiv.innerHTML = `
                    <span class="stop-order">${stopOrder}</span>
                    <span class="stop-name">${escapeHtml(stopName)}</span>
                `;
                stopsList.appendChild(stopDiv);
            });
        } else {
            const noStopsDiv = document.createElement('div');
            noStopsDiv.style.padding = '10px 20px';
            noStopsDiv.style.color = '#999';
            noStopsDiv.style.fontStyle = 'italic';
            noStopsDiv.textContent = 'No stops for this route';
            stopsList.appendChild(noStopsDiv);
        }

        // Toggle expand/collapse
        header.addEventListener('click', () => {
            header.classList.toggle('expanded');
            stopsList.classList.toggle('expanded');
        });

        routeDiv.appendChild(header);
        routeDiv.appendChild(stopsList);
        container.appendChild(routeDiv);
    });

    log('Routes list rendered successfully');
}

/**
 * 📋 Show HOF error
 */
function showHofError(message) {
    log('HOF Error:', message);
    showToast(message, 'error');
}

/**
 * 📋 Show HOF success
 */
function showHofSuccess(message) {
    log('HOF Success:', message);
    showToast(message, 'success');
}

/**
 * 🔍 Apply DOM-only filter to HOF files table rows.
 * Hides rows that don't match the query (no re-fetch, no re-render).
 */
function _applyHofListFilter(query) {
    const tbody = document.getElementById('hof-files-tbody');
    if (!tbody) return;

    const q = query.toLowerCase().trim();
    const rows = Array.from(tbody.querySelectorAll('tr[data-name]'));

    rows.forEach(row => {
        const matches = !q ||
            row.dataset.name.includes(q) ||
            row.dataset.map.includes(q);
        row.classList.toggle('hof-row-hidden', !matches);
    });

    // Reset to page 1 when filter changes
    _hofCurrentPage = 1;
    _applyHofPagination();
}

/**
 * 📄 Apply pagination over currently-visible rows.
 * Called after filter and after page navigation.
 */
function _applyHofPagination() {
    const tbody = document.getElementById('hof-files-tbody');
    if (!tbody) return;

    // Remove any previous filter-empty message
    tbody.querySelector('.hof-filter-empty')?.remove();

    const allRows = Array.from(tbody.querySelectorAll('tr[data-name]'));
    const visible = allRows.filter(r => !r.classList.contains('hof-row-hidden'));

    const total    = allRows.length;
    const filtered = visible.length;
    const pages    = Math.max(1, Math.ceil(filtered / HOF_PAGE_SIZE));

    _hofCurrentPage = Math.min(_hofCurrentPage, pages);

    const start = (_hofCurrentPage - 1) * HOF_PAGE_SIZE;
    const end   = start + HOF_PAGE_SIZE;

    visible.forEach((row, idx) => {
        row.style.display = (idx >= start && idx < end) ? '' : 'none';
    });

    // No results for this filter
    if (filtered === 0 && total > 0) {
        const q = document.getElementById('hof-list-search')?.value?.trim() || '';
        const noResult = document.createElement('tr');
        noResult.className = 'hof-filter-empty';
        noResult.innerHTML = `<td colspan="6" class="empty-row">No results${q ? ` for "${escapeHtml(q)}"` : ''}</td>`;
        tbody.appendChild(noResult);
    }

    _updateHofListFooter(filtered, total, pages);
}

/**
 * 📊 Update the file count footer below the HOF table.
 */
function _updateHofListFooter(visible, total, pages = 1) {
    const footer = document.getElementById('hof-list-footer');
    if (!footer) return;
    if (total === 0) { footer.style.display = 'none'; return; }
    footer.style.display = 'flex';

    const countStr = visible === total
        ? `${total} file${total !== 1 ? 's' : ''}`
        : `${visible} of ${total} files`;

    const showPager = pages > 1;

    footer.innerHTML =
        `<span class="hof-footer-count">${countStr}</span>` +
        (showPager ? `
            <div class="hof-pager">
                <button class="hof-pager-btn" id="hof-page-prev" ${_hofCurrentPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
                <span class="hof-pager-info">Page ${_hofCurrentPage} / ${pages}</span>
                <button class="hof-pager-btn" id="hof-page-next" ${_hofCurrentPage >= pages ? 'disabled' : ''}>Next ›</button>
            </div>` : '');

    if (showPager) {
        footer.querySelector('#hof-page-prev')?.addEventListener('click', () => {
            if (_hofCurrentPage > 1) { _hofCurrentPage--; _applyHofPagination(); }
        });
        footer.querySelector('#hof-page-next')?.addEventListener('click', () => {
            if (_hofCurrentPage < pages) { _hofCurrentPage++; _applyHofPagination(); }
        });
    }
}

/**
 * 📥 Export HOF files list as a CSV download.
 */
function exportHofListAsCsv() {
    if (!state.hof.files.length) {
        showToast('No files to export', 'warn');
        return;
    }

    const header = ['ID', 'File Name', 'Map Name', 'Routes', 'Stops', 'Imported'];
    const rows = state.hof.files.map(f => [
        f.id?.substring(0, 8) || '',
        f.fileName || '',
        f.mapName || '',
        f.routesCount || 0,
        f.stopsCount  || 0,
        f.imported ? 'Yes' : 'No'
    ]);

    const csv = [header, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `hof-files-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showToast(`✓ Exported ${rows.length} files`, 'success');
    log(`HOF list exported as CSV (${rows.length} files)`);
}

/**
 * 📋 Setup HOF module event listeners
 */
function setupHofModule() {
    const dropzone = document.getElementById('hof-dropzone');
    const fileInput = document.getElementById('hof-file-input');
    const replaceFileInput = document.getElementById('hof-replace-file-input');
    const uploadBtn = document.getElementById('upload-hof-btn');
    const previewCancelBtn = document.getElementById('preview-cancel-btn');
    const previewImportBtn = document.getElementById('preview-import-btn');
    const searchInput = document.getElementById('routes-search-input');

    const editModal = document.getElementById('hof-edit-modal');
    const editModalOverlay = editModal?.querySelector('.modal-overlay');
    const editModalCloseBtn = document.getElementById('edit-modal-close-btn');
    const editHofCancelBtn = document.getElementById('edit-hof-cancel-btn');
    const editHofSaveBtn = document.getElementById('edit-hof-save-btn');
    const editHofSaveParseBtn = document.getElementById('edit-hof-save-parse-btn');

    const navigatorSearch = document.getElementById('hof-navigator-search');
    const navigatorToggle = document.getElementById('hof-navigator-toggle');
    const navigator = document.getElementById('hof-navigator');

    if (!dropzone || !fileInput) {
        log('HOF dropzone or file input not found');
        return;
    }

    // Click to browse
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleHofFile(e.target.files[0]);
        }
    });

    // Drag over
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
    });

    // Drag leave
    dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
    });

    // Drop
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleHofFile(e.dataTransfer.files[0]);
        }
    });

    // Upload button (alternative upload)
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }

    // ========== REPLACE FILE INPUT ==========
    if (replaceFileInput) {
        replaceFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const hofId = replaceFileInput.dataset.hofId;
                if (hofId) {
                    handleReplaceFile(hofId, e.target.files[0]);
                }
            }
        });
    }

    // Preview cancel
    if (previewCancelBtn) {
        previewCancelBtn.addEventListener('click', () => {
            document.getElementById('hof-preview-section').style.display = 'none';
            state.hof.preview = null;
            state.hof.previewId = null;
        });
    }

    // Preview import
    if (previewImportBtn) {
        previewImportBtn.addEventListener('click', () => {
            if (state.hof.previewId) {
                importHofFile(state.hof.previewId);
            }
        });
    }

    // Search routes
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.hof.searchTerm = e.target.value;
            log(`Search term updated: "${state.hof.searchTerm}"`);

            if (state.hof.preview && Array.isArray(state.hof.preview.routes)) {
                const routesList = document.getElementById('routes-list');
                if (routesList) {
                    renderRoutesList(state.hof.preview.routes, routesList);
                }
            }
        });
    }

    // ========== EDIT MODAL CONTROLS ==========
    if (editModal) {
        // Close modal on overlay click
        if (editModalOverlay) {
            editModalOverlay.addEventListener('click', closeHofEditModal);
        }

        // Close modal on close button
        if (editModalCloseBtn) {
            editModalCloseBtn.addEventListener('click', closeHofEditModal);
        }

        // Cancel button
        if (editHofCancelBtn) {
            editHofCancelBtn.addEventListener('click', closeHofEditModal);
        }

        // Save button
        if (editHofSaveBtn) {
            editHofSaveBtn.addEventListener('click', () => {
                saveHofFileContent(false);
            });
        }

        // Save & Parse button
        if (editHofSaveParseBtn) {
            editHofSaveParseBtn.addEventListener('click', () => {
                saveHofFileContent(true);
            });
        }

        // Version note toggle
        const noteToggle = document.getElementById('hof-note-toggle');
        const noteInput  = document.getElementById('hof-version-note');
        if (noteToggle && noteInput) {
            noteToggle.addEventListener('click', () => {
                const shown = noteInput.style.display !== 'none';
                noteInput.style.display = shown ? 'none' : 'flex';
                noteToggle.textContent  = shown ? '🏷 Add note…' : '🏷 Hide note';
                if (!shown) { noteInput.focus(); }
            });
        }
    }

    // ========== HOF NAVIGATOR CONTROLS ==========

    // Navigator search — DOM-only filter (no re-parse, no re-render)
    if (navigatorSearch) {
        navigatorSearch.addEventListener('input', (e) => {
            filterNavTree(e.target.value);
        });
        navigatorSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                navigatorSearch.value = '';
                filterNavTree('');
                navigatorSearch.blur();
            }
        });
    }

    // Navigator toggle (CORRECTED - IDE style)
    if (navigatorToggle && navigator) {
        navigatorToggle.addEventListener('click', (e) => {
            e.stopPropagation();

            // Toggle collapsed class
            navigator.classList.toggle('collapsed');

            // Update button text
            const isCollapsed = navigator.classList.contains('collapsed');
            if (isCollapsed) {
                navigatorToggle.textContent = '>';
                navigatorToggle.title = 'Show Navigator';
                log('Navigator collapsed');
            } else {
                navigatorToggle.textContent = '−';
                navigatorToggle.title = 'Hide Navigator';
                log('Navigator expanded');
            }

            // Persist preference for next session
            try { localStorage.setItem('hof_navigator_collapsed', String(isCollapsed)); } catch (_) {}

            // Force editor layout recalculation
            if (state.hof.editorInstance) {
                setTimeout(() => {
                    try {
                        state.hof.editorInstance.layout();
                        log('Monaco layout recalculated after navigator toggle');
                    } catch (err) {
                        log('Layout recalculation skipped');
                    }
                }, 250);  // Match CSS transition duration
            }

            log(`Navigator toggled - collapsed: ${isCollapsed}`);
        });

        // Set initial button state
        navigatorToggle.textContent = '−';
        navigatorToggle.title = 'Hide Navigator';
    }

    // ── HOF list search filter ────────────────────────────────────────────
    const listSearch = document.getElementById('hof-list-search');
    if (listSearch) {
        listSearch.addEventListener('input', (e) => {
            _applyHofListFilter(e.target.value);
        });
        listSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                listSearch.value = '';
                _applyHofListFilter('');
                listSearch.blur();
            }
        });
    }

    // ── CSV export button ─────────────────────────────────────────────────
    const csvBtn = document.getElementById('hof-export-csv-btn');
    if (csvBtn) {
        csvBtn.addEventListener('click', exportHofListAsCsv);
    }

    log('HOF module initialized');

    // Wire the Diff Viewer modal controls
    setupDiffModal();
}

/**
 * ============================================
 *  UI & INITIALIZATION
 * ============================================
 */

function setupTabSwitching() {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            const tabContent = document.getElementById(`tab-${tabName}`);
            if (tabContent) {
                tabContent.classList.add('active');
            }

            log(`Switched to tab: ${tabName}`);
        });
    });
}

function setupTimetableModule() {
    document.getElementById('route-selector').addEventListener('change', async (e) => {
        const routeId = e.target.value;
        const routeName = e.target.options[e.target.selectedIndex].text;

        if (!routeId) {
            document.getElementById('timetable-selector-group').style.display = 'none';
            document.getElementById('timetable-editor').style.display = 'none';
            return;
        }

        state.timetableState.selectedRouteId = routeId;
        state.timetableState.selectedRoute = routeName;

        log(`Route selected: ${routeName} (${routeId})`);

        await Promise.all([
            fetchTimetables(routeId),
            fetchStops(routeId)
        ]);

        document.getElementById('create-timetable-btn').disabled = false;
        document.getElementById('refresh-timetable-btn').disabled = false;
    });

    document.getElementById('timetable-selector').addEventListener('change', (e) => {
        const timetableId = e.target.value;

        if (!timetableId) {
            document.getElementById('timetable-editor').style.display = 'none';
            return;
        }

        selectTimetable(timetableId);
    });

    document.getElementById('create-timetable-btn').addEventListener('click', () => {
        if (state.timetableState.selectedRouteId) {
            createTimetable(state.timetableState.selectedRouteId);
        }
    });

    document.getElementById('refresh-timetable-btn').addEventListener('click', () => {
        if (state.timetableState.selectedRouteId) {
            fetchTimetables(state.timetableState.selectedRouteId);
        }
    });

    document.getElementById('add-stop-btn').addEventListener('click', addStopRow);
    document.getElementById('save-timetable-btn').addEventListener('click', saveTimetable);

    document.getElementById('rename-timetable-btn').addEventListener('click', () => {
        const timetableId = state.timetableState.selectedTimetable;
        if (!timetableId) return;

        const currentName = state.timetableState.selectedTimetableName || '';
        const newName = prompt('Nouveau nom de la timetable :', currentName);

        if (newName === null) return; // annulé
        if (!newName.trim()) {
            showTimetableError('Le nom ne peut pas être vide');
            return;
        }

        renameTimetable(timetableId, newName.trim());
    });

    log('Timetable module initialized');
}

function startAutoRefresh() {
    log(`Starting auto-refresh every ${CONFIG.REFRESH_INTERVAL}ms`);

    // Initial fetch — report offline state if it fails
    fetchServers().catch(() => { updateSyncStatus(false); });

    state.autoRefreshInterval = setInterval(() => {
        // Pause polling when the browser tab is not visible
        if (document.hidden) return;
        if (!state.isLoading) {
            fetchServers();
        }
    }, CONFIG.REFRESH_INTERVAL);

    // Resume immediately when the tab becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.autoRefreshInterval) {
            fetchServers();
        }
    });
}

function stopAutoRefresh() {
    log('Stopping auto-refresh');
    if (state.autoRefreshInterval) {
        clearInterval(state.autoRefreshInterval);
        state.autoRefreshInterval = null;
    }
}

/**
 * Initialize app
 */
/**
 * ⌨ Keyboard shortcuts help modal
 * Triggered by pressing '?' when no input/textarea has focus.
 */
/**
 * 🌙 Theme toggle — light / dark
 * Persisted in localStorage('omsi_theme').
 * Monaco theme is updated in sync.
 */
function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    // Restore saved preference
    try {
        const saved = localStorage.getItem('omsi_theme');
        if (saved === 'light') _applyTheme('light');
    } catch (_) {}

    btn.addEventListener('click', () => {
        const isLight = document.documentElement.dataset.theme === 'light';
        _applyTheme(isLight ? 'dark' : 'light');
    });
}

function _applyTheme(theme) {
    const root = document.documentElement;
    const btn  = document.getElementById('theme-toggle');

    if (theme === 'light') {
        root.dataset.theme = 'light';
        if (btn) btn.textContent = '☀️';
        // Switch Monaco to a light theme
        try { monaco.editor.setTheme('vs'); } catch (_) {}
        try { if (window._hofDiffEditorInstance) window._hofDiffEditorInstance.editor?.updateOptions({ theme: 'vs' }); } catch (_) {}
    } else {
        delete root.dataset.theme;
        if (btn) btn.textContent = '🌙';
        // Restore OMSI dark theme
        try { monaco.editor.setTheme('omsi-dark'); } catch (_) {}
    }

    try { localStorage.setItem('omsi_theme', theme); } catch (_) {}
    log(`Theme switched to: ${theme}`);
}

function setupShortcutsModal() {
    const modal   = document.getElementById('shortcuts-modal');
    const overlay = modal?.querySelector('.shortcuts-overlay');
    const closeBtn = document.getElementById('shortcuts-close');
    if (!modal) return;

    const open  = () => modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');

    closeBtn?.addEventListener('click', close);
    overlay?.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
        // '?' opens the modal — but not when the user is typing in an input
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
            e.preventDefault();
            modal.classList.contains('hidden') ? open() : close();
        }
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            close();
        }
    });
}

function init() {
    log('Initializing Game Server Admin Dashboard');

    // Initialize Monaco loader
    initializeMonacoLoader();

    // Tab switching
    setupTabSwitching();

    // Main server controls
    document.getElementById('start-server-form').addEventListener('submit', handleStartServerForm);
    document.getElementById('refresh-btn').addEventListener('click', () => {
        log('Manual refresh triggered');
        fetchServers();
    });

    // Modal controls
    document.getElementById('log-modal-close').addEventListener('click', closeLogsModal);
    document.getElementById('log-modal-close-btn').addEventListener('click', closeLogsModal);

    // ── Scoped inside #log-modal to avoid matching HOF/Diff modal overlays ──
    const logModal = document.getElementById('log-modal');
    logModal.querySelector('.modal-overlay').addEventListener('click', closeLogsModal);
    logModal.querySelector('.modal-content').addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.getElementById('log-clear-btn').addEventListener('click', () => {
        const logContent = document.getElementById('log-content');
        logContent.innerHTML = '<div class="terminal-loading">Waiting for logs...</div>';
        state.logState.logCount = 0;
        log('Logs cleared');
    });

    document.getElementById('log-auto-scroll-btn').addEventListener('click', (e) => {
        state.logState.autoScroll = !state.logState.autoScroll;
        const btn = e.target.closest('button');
        if (state.logState.autoScroll) {
            btn.classList.add('active');
            btn.textContent = '📌 Auto-scroll: ON';
            const logContent = document.getElementById('log-content');
            logContent.scrollTop = logContent.scrollHeight;
        } else {
            btn.classList.remove('active');
            btn.textContent = '📌 Auto-scroll: OFF';
        }
        log(`Auto-scroll toggled: ${state.logState.autoScroll}`);
    });

    // Setup modules
    setupTimetableModule();
    setupHofModule();
    setupInstanceModule();

    // Fetch initial data
    fetchRoutes();
    fetchHofFiles();

    // Start auto-refresh (fires an immediate fetchServers + sets up the interval)
    startAutoRefresh();

    // Instance Manager auto-refresh (5s, independent from server polling)
    startInstanceAutoRefresh();

    // Keyboard shortcuts help modal
    setupShortcutsModal();

    // Theme toggle
    setupThemeToggle();

    log('Dashboard initialized successfully');
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', (e) => {
    stopAutoRefresh();
    stopInstanceAutoRefresh();
    disconnectLogs();
    log('Dashboard unloading');

    // Guard: prevent accidental close with unsaved HOF edits (any tab)
    const anyDirty = state.hof.openTabs.some(t => t.isDirty);
    if (anyDirty) {
        const msg = 'You have unsaved changes in the HOF editor. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = msg;  // Required for Chrome/Edge
        return msg;
    }
});

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


/**
 * 📋 Handle file selection for replace
 */
async function handleReplaceFile(hofId, file) {
    // Validate file type
    if (!file || !file.name.endsWith('.hof')) {
        showHofError('⚠ Please select a valid .hof file');
        log('Invalid file type for replace', { name: file?.name });
        return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        showHofError('⚠ File too large (max 10MB)');
        log('File size exceeded', { size: file.size });
        return;
    }

    // Ask for confirmation
    const confirmed = confirm(
        'Are you sure you want to replace this HOF file?\n\n' +
        'The old file will be overwritten.'
    );

    if (!confirmed) {
        log('Replace cancelled by user');
        return;
    }

    try {
        await replaceHofFile(hofId, file);
    } catch (error) {
        log('Error handling replace file:', error);
    }
}

/**
 * 📋 Replace HOF file
 */
async function replaceHofFile(hofId, file) {
    // Prevent double uploads
    if (state.hof.isUploading) {
        log('Upload already in progress');
        return;
    }

    state.hof.isUploading = true;

    try {
        log('Replacing HOF file...', { hofId, fileName: file.name, size: file.size });

        // Create FormData
        const formData = new FormData();
        formData.append('file', file);

        // Replace via PUT
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/replace`, {
            method: 'PUT',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        log('HOF file replaced successfully', result);

        showHofSuccess(`✓ File replaced successfully!`);

        // Reset file input
        const fileInput = document.getElementById('hof-replace-file-input');
        if (fileInput) fileInput.value = '';

        // Invalidate cached counts — content changed, counts may differ
        _hofCountsCache.delete(hofId);

        // Refresh HOF files list
        await fetchHofFiles();

    } catch (error) {
        log('Error replacing HOF file:', error);
        showHofError(`Failed to replace HOF file: ${error.message}`);
    } finally {
        state.hof.isUploading = false;
    }
}

/**
 * 📋 Open file picker for replace
 */
function openReplaceFilePicker(hofId) {
    const fileInput = document.getElementById('hof-replace-file-input');
    if (!fileInput) {
        log('Replace file input not found');
        return;
    }

    // Store the HOF ID in the input element temporarily
    fileInput.dataset.hofId = hofId;

    // Trigger file picker
    fileInput.click();
}

async function deleteHofFile(hofId, fileName) {
    const confirmed = await _confirm(
        '🗑 Delete HOF File',
        `<strong>${escapeHtml(fileName)}</strong><br><br>This action cannot be undone.`,
        'Delete',
        true   // isDanger
    );

    if (!confirmed) {
        log('HOF delete cancelled by user');
        return;
    }

    try {
        log('Deleting HOF file...', { hofId, fileName });

        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/delete`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        showHofSuccess('✓ HOF file deleted successfully');

        if (state.hof.previewId === hofId) {
            const previewSection = document.getElementById('hof-preview-section');
            if (previewSection) previewSection.style.display = 'none';

            state.hof.preview = null;
            state.hof.previewId = null;
        }

        // Remove from cache — file no longer exists
        _hofCountsCache.delete(hofId);

        await fetchHofFiles();

    } catch (error) {
        log('Error deleting HOF file:', error);
        showHofError(`Failed to delete HOF file: ${error.message}`);
    }
}

/**
 * 📋 Download HOF file
 */
async function downloadHofFile(hofId, fileName) {
    try {
        log(`Downloading HOF file ${hofId}...`, { fileName });

        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/download`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        // Get the blob
        const blob = await response.blob();

        // Create blob URL
        const blobUrl = window.URL.createObjectURL(blob);

        // Create temporary link and trigger download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName || `hof_${hofId.substring(0, 8)}.hof`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL
        window.URL.revokeObjectURL(blobUrl);

        log('HOF file downloaded successfully', { fileName });
        showHofSuccess(`✓ File downloaded: ${fileName}`);

    } catch (error) {
        log('Error downloading HOF file:', error);
        showHofError(`Failed to download HOF file: ${error.message}`);
    }
}

/**
 * 📦 Export HOF file as a ZIP package
 * Calls GET /api/hof/{id}/export-package and triggers browser download.
 * The ZIP contains: hof/{file}.hof + metadata/{manifest,preview,validation}.json
 */
async function exportHofPackage(hofId, fileName) {
    try {
        log(`Exporting HOF package for ${hofId}...`, { fileName });

        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/export-package`);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || `HTTP Error: ${response.status}`);
        }

        const blob = await response.blob();

        const baseName  = (fileName || `hof_${hofId.substring(0, 8)}.hof`)
            .replace(/\.hof$/i, '');
        const zipName   = `${baseName}_package.zip`;

        const blobUrl = window.URL.createObjectURL(blob);
        const link    = document.createElement('a');
        link.href     = blobUrl;
        link.download = zipName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);

        log('HOF package exported', { zipName });
        showHofSuccess(`✓ Package exported: ${zipName}`);

    } catch (error) {
        log('Error exporting HOF package:', error);
        showHofError(`Failed to export package: ${error.message}`);
    }
}

/**
 * ============================================================
 * MULTI-TAB WORKSPACE SYSTEM
 * ============================================================
 *
 * Each tab owns:  model, viewState, validationResult, navigatorTree,
 *                 isDirty, backupTimeout, originalContent
 *
 * The Monaco editor instance is created ONCE and reused.
 * Tab switching = editor.setModel(tab.model) + restoreViewState.
 * ============================================================
 */

let _tabCounter = 0;
function _genTabId() { return 'tab_' + (++_tabCounter) + '_' + Date.now(); }

/** @returns {object|null} active tab state */
function getActiveTab() {
    if (!state.hof.activeTabId) return null;
    return state.hof.openTabs.find(t => t.tabId === state.hof.activeTabId) || null;
}

function _getTabById(tabId) {
    return state.hof.openTabs.find(t => t.tabId === tabId) || null;
}

function _getTabByHofId(hofId) {
    return state.hof.openTabs.find(t => t.hofId === hofId) || null;
}

/** Mirror active tab properties into the backwards-compat flat state */
function _syncFlatState(tab) {
    if (!tab) return;
    state.hof.currentEditId       = tab.hofId;
    state.hof.currentEditFileName = tab.fileName;
    state.hof.originalEditContent = tab.originalContent;
    state.hof.isDirty             = tab.isDirty;
}

// ── Open / create a tab ───────────────────────────────────────────────────────

/**
 * 🗂 Open (or focus) a HOF file in the tab workspace.
 * If the file is already open, the existing tab is activated.
 * Otherwise a new tab is created.
 */
function openHofTab(hofId, fileName, content) {
    // If already open → just focus
    const existing = _getTabByHofId(hofId);
    if (existing) {
        activateTab(existing.tabId);
        log(`Focused existing tab: ${fileName}`);
        return;
    }

    // Build tab state
    const tab = {
        tabId:                  _genTabId(),
        hofId,
        fileName,
        model:                  null,   // created below
        originalContent:        content,
        isDirty:                false,
        backupTimeout:          null,
        autoBackupSavedAt:      null,
        viewState:              null,
        validationResult:       null,
        navigatorTree:          null,
        navigatorFlatItems:     [],
        navigatorExpandedGroups: null
    };

    state.hof.openTabs.push(tab);

    // Monaco ready? → create model & switch instantly
    if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
        _createTabModel(tab, content);
        activateTab(tab.tabId);
        // Backup check deferred so editor is ready
        setTimeout(() => checkHofBackupOnOpen(hofId, content), 300);
    } else {
        // First tab → full Monaco bootstrap via createHofEditor
        createHofEditor(content, tab.tabId);
        setTimeout(() => checkHofBackupOnOpen(hofId, content), 500);
    }

    log(`Opened tab: ${fileName} (${hofId})`);
}

/**
 * 📄 Create a Monaco model for the given tab (no editor interaction)
 */
function _createTabModel(tab, content) {
    try {
        const uri = monaco.Uri.parse(`file:///hof/${tab.hofId}/${encodeURIComponent(tab.fileName)}`);

        // If a model with that URI already exists (edge case), reuse it
        const existing = monaco.editor.getModel(uri);
        if (existing) {
            tab.model = existing;
            return;
        }

        tab.model = monaco.editor.createModel(content, 'omsi-hof', uri);
        log(`Model created: ${tab.fileName}`);
    } catch (err) {
        // URI collision safety: create without URI
        log(`Model URI error (${err.message}) — creating without URI`);
        tab.model = monaco.editor.createModel(content, 'omsi-hof');
    }
}

// ── Activate (switch to) a tab ───────────────────────────────────────────────

/**
 * ▶ Activate a tab: save current viewState, switch model, restore target viewState.
 * All UI panels are refreshed from the tab's cached data.
 */
function activateTab(tabId) {
    const editor = state.hof.editorInstance;
    if (!editor || state.hof.editorType !== 'monaco') return;

    // 1. Save current tab's view state
    const prev = getActiveTab();
    if (prev && prev.tabId !== tabId) {
        prev.viewState                = editor.saveViewState();
        prev.navigatorExpandedGroups  = state.hof.navigatorExpandedGroups;
    }

    // 2. Find target tab
    const tab = _getTabById(tabId);
    if (!tab) { log(`activateTab: tab ${tabId} not found`); return; }

    // 3. Mark as active + sync flat state
    state.hof.activeTabId = tabId;
    _syncFlatState(tab);

    // 4. Switch Monaco model
    if (tab.model) {
        editor.setModel(tab.model);
    }

    // 5. Restore view state (cursor + scroll + folding)
    if (tab.viewState) {
        editor.restoreViewState(tab.viewState);
    } else {
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        editor.setPosition({ lineNumber: 1, column: 1 });
    }

    // 6. Restore navigator expanded groups
    state.hof.navigatorExpandedGroups = tab.navigatorExpandedGroups || null;

    // 7. Update tab bar
    renderTabBar();

    // 8. Update breadcrumb + status bar
    updateBreadcrumbFilename(tab.fileName);
    updateBreadcrumb('—');
    updateSaveStateStatus(tab.isDirty ? 'unsaved' : 'saved');
    const modEl = document.getElementById('statusbar-modified');
    if (modEl) modEl.style.display = tab.isDirty ? 'flex' : 'none';
    updateEditorStatusBar(editor);

    // 9. Restore navigator (from cache or re-parse)
    if (tab.navigatorTree) {
        state.hof.navigatorTree      = tab.navigatorTree;
        state.hof.navigatorFlatItems = tab.navigatorFlatItems;
        renderHofNavigatorTree(tab.navigatorTree);
        // Re-apply active search if any
        const searchEl = document.getElementById('hof-navigator-search');
        if (searchEl && searchEl.value.trim()) filterNavTree(searchEl.value);
    } else if (tab.model) {
        updateHofNavigator(tab.model.getValue());
    }

    // 10. Restore validation (Monaco markers are model-bound — auto-applied!)
    //     Only need to update the validation *panel* UI.
    if (tab.validationResult) {
        updateValidationSummary(tab.validationResult);
        updateValidationPanelContent(tab.validationResult);
    } else if (tab.model) {
        scheduleHofValidation(tab.model.getValue());
    }

    // 11. Hide backup banner (per-tab check happens in openHofTab)
    const banner = document.getElementById('hof-backup-banner');
    if (banner) banner.hidden = true;

    // 12. Focus
    requestAnimationFrame(() => { try { editor.focus(); } catch (_) {} });

    log(`Tab activated: ${tab.fileName}`);
}

// ── Close a tab ───────────────────────────────────────────────────────────────

/**
 * ✕ Close a tab. If dirty, prompts for confirmation (unless force=true).
 * Disposes the Monaco model. Activates adjacent tab or closes modal.
 */
async function closeTab(tabId, force = false) {
    const tab = _getTabById(tabId);
    if (!tab) return;

    // Dirty confirmation — styled modal instead of window.confirm
    if (!force && tab.isDirty) {
        const ok = await _confirm(
            `Close "${escapeHtml(tab.fileName)}"?`,
            'This file has unsaved changes.<br><br>Auto-backup is preserved locally — you can restore it next time you open this file.',
            'Close without saving'
        );
        if (!ok) return;
    }

    // Cancel pending backup timer
    if (tab.backupTimeout) { clearTimeout(tab.backupTimeout); tab.backupTimeout = null; }

    const wasActive = (state.hof.activeTabId === tabId);
    const idx       = state.hof.openTabs.indexOf(tab);

    // Dispose model
    if (tab.model) { try { tab.model.dispose(); } catch (_) {} tab.model = null; }

    // Remove from array
    state.hof.openTabs.splice(idx, 1);

    if (state.hof.openTabs.length === 0) {
        // No tabs remain → close the whole modal
        _doCloseModal();
    } else if (wasActive) {
        // Activate an adjacent tab
        const next = state.hof.openTabs[Math.min(idx, state.hof.openTabs.length - 1)];
        activateTab(next.tabId);
    } else {
        // Just re-render bar (inactive tab removed)
        renderTabBar();
    }

    log(`Tab closed: ${tab.fileName}`);
}

/** Internal: perform the actual modal hide + state reset (no dirty check) */
function _doCloseModal() {
    // Release all remaining tabs
    state.hof.openTabs.forEach(t => {
        if (t.backupTimeout) clearTimeout(t.backupTimeout);
        if (t.model) try { t.model.dispose(); } catch (_) {}
    });
    state.hof.openTabs    = [];
    state.hof.activeTabId = null;

    // Keep Monaco editor alive — just disconnect the model
    const editor = state.hof.editorInstance;
    if (editor && state.hof.editorType === 'monaco') {
        try { editor.setModel(null); } catch (_) {}
    }

    // Clear flat state
    state.hof.currentEditId       = null;
    state.hof.currentEditContent  = null;
    state.hof.originalEditContent = null;
    state.hof.isDirty             = false;

    clearHofValidationMarkers();

    const modal = document.getElementById('hof-edit-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';

    renderTabBar();

    const diffModal = document.getElementById('hof-diff-modal');
    if (diffModal && !diffModal.classList.contains('hidden')) closeHofDiffModal();

    log('HOF modal closed — all tabs released');
}

// ── Tab bar render ───────────────────────────────────────────────────────────

/**
 * 🗂 Render the tab bar from state.hof.openTabs
 */
function renderTabBar() {
    const scrollEl = document.getElementById('hof-tabs-scroll');
    if (!scrollEl) return;

    scrollEl.innerHTML = '';

    state.hof.openTabs.forEach(tab => {
        const isActive  = (tab.tabId === state.hof.activeTabId);
        const isDirty   = tab.isDirty;

        const el = document.createElement('div');
        el.className = ['hof-tab', isActive ? 'active' : '', isDirty ? 'dirty' : ''].filter(Boolean).join(' ');
        el.dataset.tabId = tab.tabId;
        el.setAttribute('role', 'tab');
        el.setAttribute('aria-selected', String(isActive));
        el.setAttribute('draggable', 'true');

        // Enrich tooltip with line count when available
        const lineCount = tab.model ? tab.model.getLineCount() : null;
        const lineStr   = lineCount != null ? ` — ${lineCount.toLocaleString()} lines` : '';
        el.title = tab.fileName + (isDirty ? ' (unsaved changes)' : '') + lineStr;

        el.innerHTML =
            `<span class="hof-tab__dot">${isDirty ? '●' : ''}</span>` +
            `<span class="hof-tab__name">${escapeHtml(tab.fileName)}</span>` +
            (lineCount != null ? `<span class="hof-tab__lines">${lineCount > 999 ? Math.round(lineCount/1000)+'k' : lineCount}</span>` : '') +
            `<button class="hof-tab__close" title="Close ${escapeHtml(tab.fileName)}" type="button" aria-label="Close">✕</button>`;

        // Left-click → activate
        el.addEventListener('click', (e) => {
            if (e.target.closest('.hof-tab__close')) return;
            activateTab(tab.tabId);
        });

        // Middle-click → close
        el.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); closeTab(tab.tabId); }
        });

        el.querySelector('.hof-tab__close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.tabId);
        });

        // ── Drag & drop reordering ────────────────────────────────────────
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.tabId);
            // Defer adding class so the ghost image is captured first
            requestAnimationFrame(() => el.classList.add('dragging'));
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            scrollEl.querySelectorAll('.hof-tab').forEach(t => t.classList.remove('drag-over'));
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Highlight drop target
            scrollEl.querySelectorAll('.hof-tab').forEach(t => t.classList.remove('drag-over'));
            el.classList.add('drag-over');
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');

            const sourceId = e.dataTransfer.getData('text/plain');
            const targetId = tab.tabId;
            if (!sourceId || sourceId === targetId) return;

            const tabs     = state.hof.openTabs;
            const srcIdx   = tabs.findIndex(t => t.tabId === sourceId);
            const tgtIdx   = tabs.findIndex(t => t.tabId === targetId);
            if (srcIdx === -1 || tgtIdx === -1) return;

            // Splice source out and insert at target position
            const [moved] = tabs.splice(srcIdx, 1);
            tabs.splice(tgtIdx, 0, moved);

            renderTabBar();
            log(`Tab reordered: ${moved.fileName} → position ${tgtIdx}`);
        });

        scrollEl.appendChild(el);
    });

    // Keep active tab in view
    const activeEl = scrollEl.querySelector('.hof-tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Keyboard: Ctrl+Tab ───────────────────────────────────────────────────────

/**
 * ⌨ Activate next (or previous) tab
 */
function _activateAdjacentTab(dir = 1) {
    const tabs = state.hof.openTabs;
    if (tabs.length <= 1) return;
    const idx  = tabs.findIndex(t => t.tabId === state.hof.activeTabId);
    const next = (idx + dir + tabs.length) % tabs.length;
    activateTab(tabs[next].tabId);
}

/**
 * ============================================================
 * END OF MULTI-TAB WORKSPACE SYSTEM
 * ============================================================
 */

/**
 * 📋 Open Edit modal for HOF file (CORRECTED)
 */
async function openHofEditModal(hofId, fileName) {
    try {
        log(`Opening HOF file: ${hofId} "${fileName}"`);

        // ── If already open, focus existing tab (no need to re-fetch) ──────
        const existing = _getTabByHofId(hofId);
        if (existing) {
            const modal = document.getElementById('hof-edit-modal');
            if (modal) {
                modal.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            }
            activateTab(existing.tabId);
            log(`Re-focused existing tab: ${fileName}`);
            return;
        }

        // ── Fetch raw content ────────────────────────────────────────────────
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/raw`);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();
        let content = '';
        if (typeof data === 'string') {
            content = data;
        } else if (typeof data === 'object' && data !== null) {
            content = data.content || '';
        }

        log('HOF content loaded', { length: content.length });

        // Show modal now (tab bar and editor will render inside)
        const modal = document.getElementById('hof-edit-modal');
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        // Restore navigator collapse preference (persisted across sessions)
        const nav = document.getElementById('hof-navigator');
        const navToggle = document.getElementById('hof-navigator-toggle');
        if (nav) {
            nav.classList.remove('collapsed', 'expanded');
            try {
                const pref = localStorage.getItem('hof_navigator_collapsed');
                if (pref === 'true') {
                    nav.classList.add('collapsed');
                    if (navToggle) { navToggle.textContent = '>'; navToggle.title = 'Show Navigator'; }
                }
            } catch (_) {}
        }

        // ── Open in tab system ───────────────────────────────────────────────
        openHofTab(hofId, fileName || 'Unknown.hof', content);

    } catch (error) {
        log('Error opening edit modal:', error);
        showHofError(`Failed to load HOF file: ${error.message}`);
    }
}

/**
 * 📋 Register OMSI HOF Language (CUSTOM LANGUAGE)
 */
function registerOmsiHofLanguage(monaco) {
    log('Registering OMSI HOF language...');

    // 1. Register language ID
    monaco.languages.register({ id: 'omsi-hof' });

    // 2. Set language configuration
    monaco.languages.setLanguageConfiguration('omsi-hof', {
        comments: {
            lineComment: ';'
        },
        brackets: [
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        surroundingPairs: [
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        folding: {
            offSide: false,
            markers: {
                start: /^\s*\[/,
                end: /^\s*$/
            }
        }
    });

    // 3. Set Monarch tokenizer
    monaco.languages.setMonarchTokensProvider('omsi-hof', {
        // OMSI HOF known section names (complete list)
        omsiSections: [
            'addterminus', 'addbusstop', 'addtrip', 'addtripgroup',
            'infosystem_trip', 'infosystem_busstop_list',
            'setbusstoptext', 'settriptext', 'setbusstopname',
            'route', 'busstop', 'terminus', 'trip', 'tripgroup',
            'timetable', 'schedule', 'line', 'direction'
        ],
        tokenizer: {
            root: [
                // Comments - lines starting with ; (priority: first rule)
                [/;.*$/, 'comment'],

                // OMSI known section headers - specific keywords (colored specially)
                [/\[(addterminus|addbusstop|addtrip|addtripgroup|infosystem_trip|infosystem_busstop_list|setbusstoptext|settriptext|setbusstopname|route|busstop|terminus|trip|tripgroup|timetable|schedule|line|direction)\]/i, 'keyword.omsi-section'],

                // Generic section headers - [SectionName]
                [/\[[a-zA-Z0-9_]+\]/, 'keyword.section'],

                // StringCount variables - stringcount_*
                [/\bstringcount_[a-zA-Z0-9_]+\b/i, 'keyword.stringcount'],

                // TripsCount
                [/\btripscount_[a-zA-Z0-9_]+\b/i, 'keyword.tripscount'],

                // Known OMSI key names in key=value patterns
                [/\b(LineNumber|Direction|LineCode|BusStopName|BusStopId|TripCode|StartTime|EndTime|Interval|Platform|Track|Group|Color|Flags|Count)\b(?=\s*=)/, 'keyword.omsi-key'],

                // Key=Value pairs (generic keys)
                [/([a-zA-Z][a-zA-Z0-9_]*)(\s*=)/, ['identifier.key', 'operator']],

                // Hex colors (#RRGGBB) - before numbers to take priority
                [/#[0-9A-Fa-f]{6}\b/, 'number.hex'],

                // Float numbers (e.g., 1.5, 0.25)
                [/\b\d+\.\d+\b/, 'number.float'],

                // Integer numbers
                [/\b\d+\b/, 'number'],

                // Strings in quotes
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                [/"/, 'string', '@string_double'],
                [/'/, 'string', '@string_single'],

                // Whitespace
                [/\s+/, 'white'],

                // Catch all
                [/./, 'identifier']
            ],
            string_double: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, 'string', '@pop'],
                [/\\$/, 'string']
            ],
            string_single: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, 'string', '@pop'],
                [/\\$/, 'string']
            ]
        }
    });

    // 4. Define OMSI Dark theme
    defineOmsiDarkTheme(monaco);

    log('OMSI HOF language registered successfully');
}

/**
 * 📋 Define OMSI Dark Theme
 */
function defineOmsiDarkTheme(monaco) {
    log('Defining OMSI Dark theme...');

    monaco.editor.defineTheme('omsi-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            // OMSI-specific sections (addterminus, addbusstop, etc.) - bright magenta/purple
            { token: 'keyword.omsi-section', foreground: 'C792EA', fontStyle: 'bold' },

            // Generic sections - bright cyan, bold
            { token: 'keyword.section', foreground: '4FC3F7', fontStyle: 'bold' },

            // StringCount - yellow
            { token: 'keyword.stringcount', foreground: 'FFD54F', fontStyle: 'bold' },

            // TripsCount - orange-yellow
            { token: 'keyword.tripscount', foreground: 'FFCA28', fontStyle: 'bold' },

            // OMSI known key names (LineNumber, Direction, etc.)
            { token: 'keyword.omsi-key', foreground: '82AAFF', fontStyle: 'italic' },

            // Comments - muted green, italic
            { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },

            // Numbers - warm orange
            { token: 'number', foreground: 'F78C6C' },

            // Float numbers - slightly different orange
            { token: 'number.float', foreground: 'FF8A65' },

            // Hex colors - vibrant pink
            { token: 'number.hex', foreground: 'FF79C6' },

            // Keys in key=value - light blue (VSCode variable color)
            { token: 'identifier.key', foreground: '9CDCFE' },

            // Operators
            { token: 'operator', foreground: '89DDFF' },

            // Strings - warm amber
            { token: 'string', foreground: 'C3E88D' },

            // String escape - orange
            { token: 'string.escape', foreground: 'D7BA7D' },

            // Invalid string - red
            { token: 'string.invalid', foreground: 'FF6B6B' },

            // Identifiers - light gray
            { token: 'identifier', foreground: 'D4D4D4' },

            // Whitespace
            { token: 'white', foreground: 'D4D4D4' }
        ],
        colors: {
            'editor.background': '#1A1A1A',
            'editor.foreground': '#D4D4D4',
            'editorLineNumber.foreground': '#4A4A4A',
            'editorLineNumber.activeForeground': '#AEAFAD',
            'editorCursor.foreground': '#84fab0',
            'editor.selectionBackground': '#264F78',
            'editor.selectionHighlightBackground': '#264F7830',
            'editor.inactiveSelectionBackground': '#3A3D41',
            'editor.wordHighlightBackground': '#575757B8',
            'editor.wordHighlightStrongBackground': '#004972B8',
            'editorBracketMatch.background': '#0D3A4A',
            'editorBracketMatch.border': '#4FC3F7',
            'editor.foldBackground': '#264F7820',
            'editorGutter.background': '#1A1A1A',
            'editorGutter.modifiedBackground': '#1B81A844',
            'editorGutter.addedBackground': '#45A91E44',
            'editorGutter.deletedBackground': '#94151B44',
            'editorOverviewRuler.errorForeground': '#ff4757',
            'editorOverviewRuler.warningForeground': '#ffa502',
            'editorOverviewRuler.selectionHighlightForeground': '#264F78',
            'minimap.background': '#141414',
            'minimap.selectionHighlight': '#264F7880',
            'editor.lineHighlightBackground': '#2D2D2D',
            'editor.lineHighlightBorder': '#3A3A3A',
            'editorStickyScroll.background': '#1A1A1A',
            'editorStickyScrollHover.background': '#2D2D2D'
        }
    });

    log('OMSI Dark theme defined successfully');
}

/**
 * 📋 Setup language features — guarded, called once per Monaco instance
 */
function setupOmsiLanguageFeatures(monaco) {
    // Guard: don't register multiple folding providers
    if (_omsiProvidersRegistered) return;

    log('Setting up OMSI language features...');

    // Register the improved OMSI smart folding provider
    setupOmsiSmartFolding(monaco);

    log('OMSI language features setup complete');
}

/**
 * ============================================
 * OMSI SMART FOLDING PROVIDER
 * ============================================
 *
 * Architecture:
 *   - computeOmsiFoldingRanges(lines, typeFilter)
 *       typeFilter: null (all) | 'trip' | 'busstop' | 'terminus' | 'service' | 'global'
 *   - setupOmsiSmartFolding(monaco)  — registers the provider
 *   - foldByType(editor, monaco, typeFilter) — fold only specific section types
 */

/** OMSI section categories for fold-by-type (Part 4 architecture) */
const OMSI_FOLD_CATEGORIES = {
    trip:     ['infosystem_trip', 'addtrip'],
    busstop:  ['infosystem_busstop_list', 'addbusstop', 'addbusstop_list'],
    terminus: ['addterminus', 'addterminus_list'],
    service:  ['servicetrip'],
    global:   ['global_strings', 'name', 'friendlyname', 'stringvar'],
    all:      null  // null = no filter
};

const OMSI_SECTION_REGEX = /^\s*\[([a-zA-Z0-9_]+)\]\s*$/;

/**
 * 🗂 Compute OMSI folding ranges from raw lines
 * @param {string[]} lines     — array of line strings (0-indexed)
 * @param {string|null} typeFilter — section category key from OMSI_FOLD_CATEGORIES
 * @returns {Array}            — array of {start, end} 1-based line numbers
 */
function computeOmsiFoldingRanges(lines, typeFilter = null) {
    const ranges = [];
    const sectionLines = []; // [{lineIdx, sectionName}]

    // Pass 1: collect all section header positions
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(OMSI_SECTION_REGEX);
        if (m) {
            sectionLines.push({ idx: i, name: m[1].toLowerCase() });
        }
    }

    // Determine which sections to include
    let allowed = null;
    if (typeFilter && OMSI_FOLD_CATEGORIES[typeFilter]) {
        allowed = new Set(OMSI_FOLD_CATEGORIES[typeFilter]);
    }

    // Pass 2: build fold ranges — each section folds until just before the next one
    for (let k = 0; k < sectionLines.length; k++) {
        const { idx: startIdx, name } = sectionLines[k];

        // If type filter is active, skip non-matching sections
        if (allowed && !allowed.has(name)) continue;

        // Find end: last non-blank line before next section header (or file end)
        const nextIdx = k + 1 < sectionLines.length ? sectionLines[k + 1].idx : lines.length;

        let endIdx = nextIdx - 1;

        // Skip trailing blank lines to get a tighter fold
        while (endIdx > startIdx && lines[endIdx].trim() === '') {
            endIdx--;
        }

        // Only add range if there's at least one content line inside
        if (endIdx > startIdx) {
            ranges.push({
                start: startIdx + 1,  // Monaco: 1-based
                end:   endIdx + 1
            });
        }
    }

    return ranges;
}

/**
 * 🗂 Register the OMSI folding range provider
 */
function setupOmsiSmartFolding(monaco) {
    monaco.languages.registerFoldingRangeProvider('omsi-hof', {
        provideFoldingRanges: function (model, context, token) {
            const lines = model.getLinesContent();

            // Compute all section folds (no type filter = all sections)
            const rawRanges = computeOmsiFoldingRanges(lines, null);

            return rawRanges.map(r => ({
                start: r.start,
                end:   r.end,
                kind:  monaco.languages.FoldingRangeKind.Region
            }));
        }
    });

    log('OMSI smart folding provider registered');
}

/**
 * 🗂 Fold only sections of a specific type (Part 4 — fold by type)
 * @param {monaco.editor.IStandaloneCodeEditor} editor
 * @param {object} monaco — Monaco namespace
 * @param {string} typeFilter — key from OMSI_FOLD_CATEGORIES
 */
function foldByType(editor, monaco, typeFilter) {
    if (!editor || !typeFilter) return;

    try {
        const model = editor.getModel();
        if (!model) return;

        const lines = model.getLinesContent();
        const ranges = computeOmsiFoldingRanges(lines, typeFilter);

        if (ranges.length === 0) {
            log(`No sections found for type filter: ${typeFilter}`);
            return;
        }

        // Fold each matching range programmatically
        ranges.forEach(r => {
            editor.trigger('fold-by-type', 'editor.fold', {
                selectionLines: [r.start]
            });
        });

        log(`Folded ${ranges.length} sections of type: ${typeFilter}`);
    } catch (e) {
        log(`foldByType error: ${e.message}`);
    }
}

/**
 * ============================================
 * OMSI AUTO-COMPLETION PROVIDER
 * ============================================
 *
 * Triggers on: [ a i s g t b f e n
 * Context-aware:
 *   - "[" → section completions with snippets
 *   - "stringcount" → stringcount_* variables
 *   - previous line = [infosystem_trip] → full trip template
 *   - typing keyword prefix → filtered section suggestions
 */

/**
 * 📝 Setup OMSI HOF Auto-Completion (registered once)
 */
function setupOmsiAutocomplete(monaco) {
    if (_omsiProvidersRegistered) return;

    // ── Complete section definitions with snippets ─────────────────────────
    const OMSI_SECTIONS = [
        {
            label: '[name]',
            filterText: 'name',
            detail: 'Identifiant interne du fichier HOF',
            doc: [
                '### `[name]`',
                '',
                'Définit l\'**identifiant interne** du fichier HOF.',
                '',
                '**Format :**',
                '- `hofName` — Nom unique du fichier'
            ].join('\n'),
            snippet: '[name]\n${1:hofName}'
        },
        {
            label: '[global_strings]',
            filterText: 'global strings',
            detail: 'Compteurs globaux de chaînes (terminus/arrêts/courses)',
            doc: [
                '### `[global_strings]`',
                '',
                'Déclare les **compteurs globaux de chaînes** pour ce fichier HOF.',
                '',
                '**Format :**',
                '- `stringcount_terminus=N` — Nombre de terminus',
                '- `stringcount_busstop=N` — Nombre d\'arrêts',
                '- `stringcount_trip=N` — Nombre de courses',
                '',
                '> ⚠️ Les valeurs doivent correspondre aux définitions réelles.'
            ].join('\n'),
            snippet: [
                '[global_strings]',
                'stringcount_terminus=${1:0}',
                'stringcount_busstop=${2:0}',
                'stringcount_trip=${3:0}'
            ].join('\n')
        },
        {
            label: '[addterminus]',
            filterText: 'add terminus',
            detail: 'Ajouter un terminus',
            doc: [
                '### `[addterminus]`',
                '',
                'Ajoute un **terminus** au système HOF.',
                '',
                '**Format :**',
                '1. `terminusId` — Identifiant unique du terminus',
                '2. `displayName` — Nom affiché sur les écrans IBIS',
                '',
                '> ⚠️ Le terminusId doit correspondre aux références dans les trips.'
            ].join('\n'),
            snippet: '[addterminus]\n${1:terminusId}\n${2:TerminusDisplayName}'
        },
        {
            label: '[addterminus_list]',
            filterText: 'add terminus list',
            detail: 'Nombre total de terminus',
            doc: [
                '### `[addterminus_list]`',
                '',
                'Déclare le **nombre total de terminus** définis dans ce fichier.',
                '',
                '**Format :**',
                '1. `count` — Nombre entier de terminus',
                '',
                '> ⚠️ Doit correspondre exactement au nombre de blocs `[addterminus]`.'
            ].join('\n'),
            snippet: '[addterminus_list]\n${1:count}'
        },
        {
            label: '[addbusstop]',
            filterText: 'add busstop bus stop',
            detail: 'Ajouter un arrêt de bus',
            doc: [
                '### `[addbusstop]`',
                '',
                'Ajoute un **arrêt de bus** au système HOF.',
                '',
                '**Format :**',
                '1. `busstopId` — Identifiant unique de l\'arrêt',
                '2. `stopName` — Nom affiché sur les écrans embarqués'
            ].join('\n'),
            snippet: '[addbusstop]\n${1:busstopId}\n${2:BusStopName}'
        },
        {
            label: '[addbusstop_list]',
            filterText: 'add busstop list',
            detail: 'Nombre total d\'arrêts',
            doc: [
                '### `[addbusstop_list]`',
                '',
                'Déclare le **nombre total d\'arrêts** définis dans ce fichier.',
                '',
                '**Format :**',
                '1. `count` — Nombre entier d\'arrêts',
                '',
                '> ⚠️ Doit correspondre au nombre de blocs `[addbusstop]`.'
            ].join('\n'),
            snippet: '[addbusstop_list]\n${1:count}'
        },
        {
            label: '[addtrip]',
            filterText: 'add trip',
            detail: 'Ajouter une course',
            doc: [
                '### `[addtrip]`',
                '',
                'Ajoute une **course** au système HOF.',
                '',
                '**Format :**',
                '1. `tripId` — Identifiant unique de la course',
                '2. `description` — Description interne de la course'
            ].join('\n'),
            snippet: '[addtrip]\n${1:tripId}\n${2:TripDescription}'
        },
        {
            label: '[infosystem_trip]',
            filterText: 'infosystem trip ibis',
            detail: '⭐ Course IBIS/Infosystem complète',
            doc: [
                '### `[infosystem_trip]`',
                '',
                'Définit une **course** affichée par l\'IBIS/infosystem OMSI.',
                '',
                '**Format :**',
                '1. `internalTripId` — Identifiant interne unique de la course',
                '2. `direction` — Texte de direction *(ex: Liège >> Verviers)*',
                '3. `terminusCode` — Code du terminus de destination',
                '4. `lineNumber` — Numéro de ligne affiché sur le tableau de bord',
                '',
                '> ⚠️ Doit être suivi d\'un bloc `[infosystem_busstop_list]`.'
            ].join('\n'),
            snippet: [
                '[infosystem_trip]',
                '${1:internalTripId}',
                '${2:FROM >> TO}',
                '${3:terminusCode}',
                '${4:lineNumber}',
                '[infosystem_busstop_list]',
                '${5:1}',
                '${6:STOP_NAME_1}'
            ].join('\n')
        },
        {
            label: '[infosystem_busstop_list]',
            filterText: 'infosystem busstop list',
            detail: 'Liste d\'arrêts IBIS',
            doc: [
                '### `[infosystem_busstop_list]`',
                '',
                'Déclare la **liste des arrêts** desservis par la course IBIS précédente.',
                '',
                '**Format :**',
                '1. `stopCount` — Nombre total d\'arrêts',
                '2..N. `stopName` — Nom de chaque arrêt (un par ligne)',
                '',
                '> ⚠️ Doit suivre immédiatement un bloc `[infosystem_trip]`.'
            ].join('\n'),
            snippet: '[infosystem_busstop_list]\n${1:stopCount}\n${2:STOP_NAME_1}'
        },
        {
            label: '[servicetrip]',
            filterText: 'service trip',
            detail: 'Définir une course de service',
            doc: [
                '### `[servicetrip]`',
                '',
                'Définit une **course de service** OMSI.',
                '',
                '**Format :**',
                '1. `tripId` — Identifiant de la course',
                '2. `routeId` — Identifiant de la route',
                '3. `startTime` — Heure de départ (HH:MM)'
            ].join('\n'),
            snippet: '[servicetrip]\n${1:tripId}\n${2:routeId}\n${3:00:00}'
        },
        {
            label: '[friendlyname]',
            filterText: 'friendly name display',
            detail: 'Nom d\'affichage lisible',
            doc: [
                '### `[friendlyname]`',
                '',
                'Définit un **nom lisible** affiché dans l\'interface OMSI.',
                '',
                '**Format :**',
                '1. `displayName` — Texte affiché à l\'utilisateur'
            ].join('\n'),
            snippet: '[friendlyname]\n${1:DisplayName}'
        },
        {
            label: '[stringvar]',
            filterText: 'string var variable',
            detail: 'Variable de chaîne nommée',
            doc: [
                '### `[stringvar]`',
                '',
                'Déclare une **variable de chaîne** nommée.',
                '',
                '**Format :**',
                '1. `variableName` — Nom de la variable',
                '2. `value` — Valeur de la variable'
            ].join('\n'),
            snippet: '[stringvar]\n${1:variableName}\n${2:value}'
        },
        {
            label: '[end]',
            filterText: 'end',
            detail: 'Marqueur de fin de fichier',
            doc: [
                '### `[end]`',
                '',
                '**Marqueur de fin** du fichier HOF.',
                'Toute donnée après ce marqueur est ignorée par OMSI.'
            ].join('\n'),
            snippet: '[end]'
        }
    ];

    // ── StringCount variable completions ────────────────────────────────────
    const STRINGCOUNT_VARS = [
        {
            label: 'stringcount_terminus',
            detail: 'Compteur de terminus',
            doc: 'Nombre de terminus déclarés dans ce bloc.\n\nDoit correspondre au nombre de blocs `[addterminus]` présents.'
        },
        {
            label: 'stringcount_busstop',
            detail: 'Compteur d\'arrêts de bus',
            doc: 'Nombre d\'arrêts déclarés dans ce bloc.\n\nDoit correspondre au nombre de blocs `[addbusstop]` présents.'
        },
        {
            label: 'stringcount_trip',
            detail: 'Compteur de courses',
            doc: 'Nombre de courses déclarées dans ce bloc.\n\nDoit correspondre au nombre de blocs `[addtrip]` présents.'
        },
        {
            label: 'stringcount_destination',
            detail: 'Compteur de destinations',
            doc: 'Nombre de destinations déclarées dans ce bloc HOF.'
        },
        {
            label: 'stringcount_line',
            detail: 'Compteur de lignes',
            doc: 'Nombre de lignes déclarées dans ce bloc HOF.'
        }
    ];

    monaco.languages.registerCompletionItemProvider('omsi-hof', {
        // Only trigger on '[' — quickSuggestions handles the rest during normal typing
        triggerCharacters: ['['],

        provideCompletionItems: function (model, position) {
            const lineContent   = model.getLineContent(position.lineNumber);
            const lineUntil     = lineContent.substring(0, position.column - 1);
            const trimmedUntil  = lineUntil.trim();

            // Previous non-empty line (for context-aware completion)
            let prevLine = '';
            for (let i = position.lineNumber - 1; i >= 1; i--) {
                const l = model.getLineContent(i).trim();
                if (l.length > 0) { prevLine = l; break; }
            }

            const word = model.getWordUntilPosition(position);
            // Standard word range (for general completions)
            const wordRange = new monaco.Range(
                position.lineNumber, word.startColumn,
                position.lineNumber, position.column
            );

            const suggestions = [];

            // ── Context A: line starts with "[" → section completions ─────────
            // This fires on trigger character '[' AND on quickSuggestions while typing inside brackets
            if (trimmedUntil.startsWith('[')) {
                // Find the '[' column (1-based) and replace from there to cursor
                const bracketCol0 = lineUntil.lastIndexOf('['); // 0-based
                const sectionRange = new monaco.Range(
                    position.lineNumber, bracketCol0 + 1, // convert to 1-based
                    position.lineNumber, position.column
                );

                OMSI_SECTIONS.forEach((s, idx) => {
                    suggestions.push({
                        label:          s.label,
                        kind:           monaco.languages.CompletionItemKind.Keyword,
                        detail:         s.detail,
                        documentation:  { value: s.doc, isTrusted: true },
                        insertText:     s.snippet,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range:          sectionRange,
                        sortText:       String(idx).padStart(3, '0'),
                        filterText:     s.label,  // filter against [sectionName] as typed
                        preselect:      idx === 0
                    });
                });

                return { suggestions, incomplete: false };
            }

            // ── Context B: current line starts with "stringcount" ──────────
            if (trimmedUntil.toLowerCase().startsWith('stringcount')) {
                STRINGCOUNT_VARS.forEach((v, idx) => {
                    suggestions.push({
                        label:          v.label,
                        kind:           monaco.languages.CompletionItemKind.Variable,
                        detail:         v.detail,
                        documentation:  { value: v.doc, isTrusted: true },
                        insertText:     v.label + '=${1:0}',
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range:          new monaco.Range(
                            position.lineNumber,
                            lineUntil.search(/\S/) + 1, // start of non-whitespace, 1-based
                            position.lineNumber,
                            position.column
                        ),
                        sortText:       String(idx).padStart(3, '0')
                    });
                });

                return { suggestions, incomplete: false };
            }

            // ── Context C: previous line is [infosystem_trip] → body template ──
            if (prevLine === '[infosystem_trip]' && trimmedUntil === '') {
                suggestions.push({
                    label:          '↵ Trip body template',
                    kind:           monaco.languages.CompletionItemKind.Snippet,
                    detail:         'Template de course IBIS complet',
                    documentation: {
                        value: [
                            '### Template `[infosystem_trip]`',
                            '',
                            'Insère un corps de course IBIS complet avec la liste d\'arrêts.',
                            'Utilisez **Tab** pour naviguer entre les champs.'
                        ].join('\n'),
                        isTrusted: true
                    },
                    insertText: [
                        '${1:internalTripId}',
                        '${2:FROM >> TO}',
                        '${3:terminusCode}',
                        '${4:lineNumber}',
                        '[infosystem_busstop_list]',
                        '${5:1}',
                        '${6:STOP_NAME_1}'
                    ].join('\n'),
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range:          wordRange,
                    sortText:       '000',
                    preselect:      true
                });

                return { suggestions, incomplete: false };
            }

            // ── Context D: general keyword-prefix matching (no "[" typed yet) ─
            const trigger = trimmedUntil.toLowerCase();
            if (trigger.length < 2) {
                return { suggestions: [], incomplete: false };
            }

            OMSI_SECTIONS.forEach((s, idx) => {
                const sectionName   = s.label.replace(/[\[\]]/g, '').toLowerCase();
                const filterWords   = s.filterText.toLowerCase().split(' ');
                const matches       = sectionName.startsWith(trigger) ||
                                      filterWords.some(w => w.startsWith(trigger));

                if (matches) {
                    suggestions.push({
                        label:          s.label,
                        kind:           monaco.languages.CompletionItemKind.Snippet,
                        detail:         s.detail,
                        documentation:  { value: s.doc, isTrusted: true },
                        insertText:     s.snippet,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range:          wordRange,
                        sortText:       String(idx).padStart(3, '0'),
                        filterText:     s.filterText
                    });
                }
            });

            // Also offer stringcount_* when typing 'str' or 'string'
            if (trigger.startsWith('str') || trigger.includes('count')) {
                STRINGCOUNT_VARS.forEach((v, idx) => {
                    suggestions.push({
                        label:          v.label,
                        kind:           monaco.languages.CompletionItemKind.Variable,
                        detail:         v.detail,
                        documentation:  { value: v.doc, isTrusted: true },
                        insertText:     v.label + '=${1:0}',
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range:          wordRange,
                        sortText:       String(100 + idx).padStart(3, '0')
                    });
                });
            }

            return { suggestions, incomplete: false };
        }
    });

    log('OMSI auto-completion provider registered');
}

/**
 * ============================================
 * OMSI HOVER DOCUMENTATION PROVIDER
 * ============================================
 */

/**
 * 📚 Setup OMSI HOF Hover Provider (registered once)
 */
function setupOmsiHoverProvider(monaco) {
    // Guard is shared with autocomplete — only first call registers
    // We use a separate flag so hover can be independently tracked if needed

    // ── Hover documentation database ────────────────────────────────────────
    const SECTION_HOVER_DOCS = {
        'name': {
            title: '`[name]`',
            description: 'Définit l\'**identifiant interne** du fichier HOF.',
            format: ['`hofName` — Nom unique du fichier HOF']
        },
        'global_strings': {
            title: '`[global_strings]`',
            description: 'Déclare les **compteurs globaux de chaînes** pour ce fichier HOF.',
            format: [
                '`stringcount_terminus=N` — Nombre de terminus',
                '`stringcount_busstop=N` — Nombre d\'arrêts',
                '`stringcount_trip=N` — Nombre de courses'
            ],
            note: 'Les valeurs doivent correspondre aux définitions réelles.'
        },
        'addterminus': {
            title: '`[addterminus]`',
            description: 'Ajoute un **terminus** au système HOF.',
            format: [
                '1. `terminusId` — Identifiant unique du terminus',
                '2. `displayName` — Nom affiché sur les écrans IBIS'
            ],
            note: 'Le terminusId doit correspondre aux références dans les trips.'
        },
        'addterminus_list': {
            title: '`[addterminus_list]`',
            description: 'Déclare le **nombre total de terminus** définis dans ce fichier.',
            format: ['1. `count` — Nombre entier de terminus'],
            note: 'Doit correspondre exactement au nombre de blocs `[addterminus]`.'
        },
        'addbusstop': {
            title: '`[addbusstop]`',
            description: 'Ajoute un **arrêt de bus** au système HOF.',
            format: [
                '1. `busstopId` — Identifiant unique de l\'arrêt',
                '2. `stopName` — Nom affiché sur les écrans embarqués'
            ]
        },
        'addbusstop_list': {
            title: '`[addbusstop_list]`',
            description: 'Déclare le **nombre total d\'arrêts** définis dans ce fichier.',
            format: ['1. `count` — Nombre entier d\'arrêts'],
            note: 'Doit correspondre au nombre de blocs `[addbusstop]`.'
        },
        'addtrip': {
            title: '`[addtrip]`',
            description: 'Ajoute une **course** au système HOF.',
            format: [
                '1. `tripId` — Identifiant unique de la course',
                '2. `description` — Description interne de la course'
            ]
        },
        'infosystem_trip': {
            title: '`[infosystem_trip]`',
            description: 'Définit une **course** affichée par l\'IBIS/infosystem OMSI.',
            format: [
                '1. `internalTripId` — Identifiant interne unique de la course',
                '2. `direction` — Texte de direction affiché *(ex: Liège >> Verviers)*',
                '3. `terminusCode` — Code du terminus de destination',
                '4. `lineNumber` — Numéro de ligne affiché sur le tableau de bord'
            ],
            note: 'Doit être suivi d\'un bloc `[infosystem_busstop_list]`.'
        },
        'infosystem_busstop_list': {
            title: '`[infosystem_busstop_list]`',
            description: 'Déclare la **liste des arrêts** desservis par la course IBIS précédente.',
            format: [
                '1. `stopCount` — Nombre total d\'arrêts',
                '2..N. `stopName` — Nom de chaque arrêt (un par ligne)'
            ],
            note: 'Doit suivre immédiatement un bloc `[infosystem_trip]`.'
        },
        'servicetrip': {
            title: '`[servicetrip]`',
            description: 'Définit une **course de service** OMSI.',
            format: [
                '1. `tripId` — Identifiant de la course',
                '2. `routeId` — Identifiant de la route',
                '3. `startTime` — Heure de départ (HH:MM)'
            ]
        },
        'friendlyname': {
            title: '`[friendlyname]`',
            description: 'Définit un **nom lisible** affiché dans l\'interface OMSI.',
            format: ['1. `displayName` — Texte affiché à l\'utilisateur']
        },
        'stringvar': {
            title: '`[stringvar]`',
            description: 'Déclare une **variable de chaîne** nommée.',
            format: [
                '1. `variableName` — Nom de la variable',
                '2. `value` — Valeur de la variable'
            ]
        },
        'end': {
            title: '`[end]`',
            description: '**Marqueur de fin** du fichier HOF. Toute donnée après ce marqueur est ignorée par OMSI.'
        }
    };

    // ── StringCount variable hover docs ─────────────────────────────────────
    const STRINGCOUNT_HOVER = {
        'stringcount_terminus': {
            title: '`stringcount_terminus`',
            description: 'Compte le nombre de **terminus** déclarés dans ce bloc HOF.',
            note: 'Doit correspondre exactement au nombre de blocs `[addterminus]` présents.'
        },
        'stringcount_busstop': {
            title: '`stringcount_busstop`',
            description: 'Compte le nombre d\'**arrêts de bus** déclarés dans ce bloc HOF.',
            note: 'Doit correspondre exactement au nombre de blocs `[addbusstop]` présents.'
        },
        'stringcount_trip': {
            title: '`stringcount_trip`',
            description: 'Compte le nombre de **courses** déclarées dans ce bloc HOF.',
            note: 'Doit correspondre exactement au nombre de blocs `[addtrip]` présents.'
        },
        'stringcount_destination': {
            title: '`stringcount_destination`',
            description: 'Compte le nombre de **destinations** déclarées dans ce bloc HOF.'
        },
        'stringcount_line': {
            title: '`stringcount_line`',
            description: 'Compte le nombre de **lignes** déclarées dans ce bloc HOF.'
        }
    };

    /**
     * Build Monaco hover content (MarkdownString array) from a doc entry
     */
    function buildHoverContents(doc) {
        const lines = [];

        lines.push({ value: `### ${doc.title}` });
        lines.push({ value: '' });
        lines.push({ value: doc.description });

        if (doc.format && doc.format.length > 0) {
            lines.push({ value: '' });
            lines.push({ value: '**Format :**' });
            doc.format.forEach(f => lines.push({ value: `- ${f}` }));
        }

        if (doc.note) {
            lines.push({ value: '' });
            lines.push({ value: `> ⚠️ ${doc.note}` });
        }

        return lines;
    }

    monaco.languages.registerHoverProvider('omsi-hof', {
        provideHover: function (model, position) {
            const lineContent = model.getLineContent(position.lineNumber);
            const trimmed     = lineContent.trim();
            const col         = position.column;

            // ── Hover on section header: [sectionName] ──────────────────
            const sectionMatch = trimmed.match(/^\[([a-zA-Z0-9_]+)\]$/);
            if (sectionMatch) {
                const key = sectionMatch[1].toLowerCase();
                const doc = SECTION_HOVER_DOCS[key];

                if (doc) {
                    return {
                        range: new monaco.Range(
                            position.lineNumber, 1,
                            position.lineNumber, lineContent.length + 1
                        ),
                        contents: buildHoverContents(doc)
                    };
                }
                // Unknown section — generic hover
                return {
                    range: new monaco.Range(
                        position.lineNumber, 1,
                        position.lineNumber, lineContent.length + 1
                    ),
                    contents: [
                        { value: `### \`[${sectionMatch[1]}]\`` },
                        { value: '' },
                        { value: 'Section OMSI HOF.' }
                    ]
                };
            }

            // ── Hover on stringcount_* variable ─────────────────────────
            const scMatch = trimmed.match(/^(stringcount_[a-zA-Z0-9_]+)/);
            if (scMatch) {
                const key = scMatch[1].toLowerCase();
                const doc = STRINGCOUNT_HOVER[key];

                if (doc) {
                    return {
                        range: new monaco.Range(
                            position.lineNumber, 1,
                            position.lineNumber, lineContent.length + 1
                        ),
                        contents: buildHoverContents(doc)
                    };
                }
                // Unknown stringcount — generic
                const varName = scMatch[1];
                return {
                    range: new monaco.Range(
                        position.lineNumber, 1,
                        position.lineNumber, lineContent.length + 1
                    ),
                    contents: [
                        { value: `### \`${varName}\`` },
                        { value: '' },
                        { value: `Variable de comptage OMSI HOF : **${varName}**` }
                    ]
                };
            }

            return null; // No hover for other content
        }
    });

    // Mark providers as registered — prevent duplicate registration
    _omsiProvidersRegistered = true;

    log('OMSI hover provider registered');
}

/**
 * ============================================
 * HOF NAVIGATOR — TREE SYSTEM
 * ============================================
 *
 * Data flow:
 *   content → parseHofNavigator() → {tree, flatItems}
 *             ↓ stored in state.hof
 *   tree + searchTerm → renderHofNavigatorTree()
 *   cursor change → syncNavigatorToEditorCursor() → highlights flatItem + auto-expands
 */

// Active item id for restore after re-render
let _navActiveItemId = null;

/**
 * 📐 Default navigator expanded state
 */
const NAV_DEFAULTS_EXPANDED = {
    'trips':         true,
    'busstop-lists': true,
    'sections':      false,
    'variables':     false
};

/**
 * 🌲 Parse HOF content into a structured tree model
 *
 * Supports two [infosystem_trip] formats:
 *   - Positional: line+1=tripId, line+2=direction, line+3=terminus, line+4=lineNum
 *   - Key=value: LineNumber=X / Direction=X anywhere in the block
 *
 * @returns {{ tree: Array, flatItems: Array }}
 */
function parseHofNavigator(content) {
    if (!content || typeof content !== 'string') {
        return { tree: [], flatItems: [] };
    }

    const lines = content.split('\n');
    const flatItems   = [];
    const tripsMap    = {};   // lineNumber → [tripItem, ...]
    const busstopLists = [];
    const sections    = [];
    const variables   = [];

    // Track last trip line for busstop_list context
    let lastTripDirection = '';
    let lastTripLineNumber = '';

    const SECTION_RE = /^\[([a-zA-Z0-9_]+)\]$/;
    const STRINGCOUNT_RE = /^(stringcount_[a-zA-Z0-9_]+)\s*(?:=.*)?$/;

    for (let i = 0; i < lines.length; i++) {
        const raw     = lines[i];
        const trimmed = raw.trim();
        if (trimmed === '') continue;

        const secMatch = trimmed.match(SECTION_RE);

        if (secMatch) {
            const sectionName = secMatch[1];
            const sectionLine = i + 1; // 1-based

            // ── [infosystem_trip] ─────────────────────────────────────────
            if (sectionName === 'infosystem_trip') {
                // Try positional format first (lines[i+1..i+4])
                const l1 = (lines[i+1] || '').trim();
                const l2 = (lines[i+2] || '').trim();
                const l3 = (lines[i+3] || '').trim();
                const l4 = (lines[i+4] || '').trim();

                let tripId       = '';
                let direction    = '';
                let terminusCode = '';
                let lineNumber   = '';

                // Heuristic: if l4 is a small integer and l2 looks like direction text
                const l4isNum = /^\d+$/.test(l4) && parseInt(l4, 10) < 1000;

                if (l4isNum) {
                    // Positional format
                    tripId       = l1;
                    direction    = l2;
                    terminusCode = l3;
                    lineNumber   = l4;
                } else {
                    // Key=value format — scan up to 12 lines ahead
                    for (let j = i + 1; j < Math.min(i + 13, lines.length); j++) {
                        const kv = lines[j].trim();
                        if (kv.match(SECTION_RE)) break; // next section
                        if (kv.startsWith('LineNumber='))
                            lineNumber = kv.split('=')[1].trim();
                        if (kv.startsWith('Direction='))
                            direction = kv.split('=')[1].trim();
                        if (!tripId && /^\d+$/.test(kv))
                            tripId = kv;
                    }
                }

                const lineKey  = lineNumber || 'unknown';
                const label    = direction || (tripId ? `Trip ${tripId}` : `[infosystem_trip]`);

                lastTripDirection   = label;
                lastTripLineNumber  = lineKey;

                const item = {
                    id:           `trip-${sectionLine}`,
                    label,
                    line:         sectionLine,
                    type:         'trip',
                    tripId,
                    direction,
                    terminusCode,
                    lineNumber:   lineKey
                };

                if (!tripsMap[lineKey]) tripsMap[lineKey] = [];
                tripsMap[lineKey].push(item);
                flatItems.push(item);

            // ── [infosystem_busstop_list] ─────────────────────────────────
            } else if (sectionName === 'infosystem_busstop_list') {
                const countStr  = (lines[i+1] || '').trim();
                const stopCount = parseInt(countStr, 10) || 0;

                const item = {
                    id:          `bsl-${sectionLine}`,
                    label:       stopCount ? `${stopCount} stop${stopCount !== 1 ? 's' : ''}` : 'Bus stop list',
                    line:        sectionLine,
                    type:        'busstop_list',
                    count:       stopCount,
                    tripContext: lastTripDirection,
                    lineContext: lastTripLineNumber
                };

                busstopLists.push(item);
                flatItems.push(item);

            // ── Generic section ──────────────────────────────────────────
            } else {
                // Reset trip context on other sections
                lastTripDirection  = '';
                lastTripLineNumber = '';

                const item = {
                    id:          `sec-${sectionLine}`,
                    label:       `[${sectionName}]`,
                    line:        sectionLine,
                    type:        'section',
                    sectionName
                };

                sections.push(item);
                flatItems.push(item);
            }

        } else {
            // ── stringcount_* variable ───────────────────────────────────
            const scMatch = trimmed.match(STRINGCOUNT_RE);
            if (scMatch) {
                const varName = scMatch[1];
                // Don't add duplicate
                const alreadyAdded = flatItems.some(it => it.type === 'stringcount' && it.varName === varName);
                if (!alreadyAdded) {
                    const item = {
                        id:      `var-${i+1}`,
                        label:   varName,
                        line:    i + 1,
                        type:    'stringcount',
                        varName
                    };
                    variables.push(item);
                    flatItems.push(item);
                }
            }
        }
    }

    // ── Build tree ────────────────────────────────────────────────────────
    const tree = [];

    // Group 1: Routes / Trips (sub-grouped by line number)
    const sortedLineKeys = Object.keys(tripsMap).sort((a, b) => {
        const na = parseInt(a, 10), nb = parseInt(b, 10);
        return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
    });

    if (sortedLineKeys.length > 0) {
        const totalTrips = flatItems.filter(f => f.type === 'trip').length;
        const tripsChildren = sortedLineKeys.map(lineKey => ({
            id:       `line-${lineKey}`,
            label:    lineKey === 'unknown' ? 'Unknown Line' : `Ligne ${lineKey}`,
            icon:     '🚏',
            type:     'line-group',
            badge:    `${tripsMap[lineKey].length} trip${tripsMap[lineKey].length !== 1 ? 's' : ''}`,
            children: tripsMap[lineKey]
        }));

        tree.push({
            id:       'trips',
            label:    'Routes / Trips',
            icon:     '🚌',
            type:     'group',
            badge:    String(totalTrips),
            children: tripsChildren
        });
    }

    // Group 2: Bus Stop Lists
    if (busstopLists.length > 0) {
        tree.push({
            id:       'busstop-lists',
            label:    'Bus Stop Lists',
            icon:     '🗂',
            type:     'group',
            badge:    String(busstopLists.length),
            children: busstopLists
        });
    }

    // Group 3: Sections
    if (sections.length > 0) {
        tree.push({
            id:       'sections',
            label:    'Sections',
            icon:     '⬡',
            type:     'group',
            badge:    String(sections.length),
            children: sections
        });
    }

    // Group 4: Variables
    if (variables.length > 0) {
        tree.push({
            id:       'variables',
            label:    'Variables',
            icon:     '🔤',
            type:     'group',
            badge:    String(variables.length),
            children: variables
        });
    }

    log('HOF Navigator parsed', { trips: flatItems.filter(f => f.type === 'trip').length, sections: sections.length });
    return { tree, flatItems };
}

/**
 * 🌲 Render HOF Navigator as collapsible tree (VSCode-style)
 * DOM-only toggles — no re-render on expand/collapse or search
 */
function renderHofNavigatorTree(tree) {
    const listEl = document.getElementById('hof-navigator-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (!tree || tree.length === 0) {
        listEl.innerHTML = '<div class="hof-nav-empty">📭 No sections found</div>';
        return;
    }

    if (!state.hof.navigatorExpandedGroups) {
        state.hof.navigatorExpandedGroups = { ...NAV_DEFAULTS_EXPANDED };
    }
    const expanded = state.hof.navigatorExpandedGroups;

    const frag = document.createDocumentFragment();
    tree.forEach(group => {
        frag.appendChild(_buildGroupEl(group, 0, expanded[group.id] !== false, expanded));
    });
    listEl.appendChild(frag);

    // Restore active highlight
    if (_navActiveItemId) {
        const activeEl = listEl.querySelector(`[data-item-id="${CSS.escape(_navActiveItemId)}"]`);
        if (activeEl) activeEl.classList.add('active');
    }
}

/**
 * 🏗 Build a group element (recursive — handles nested line-groups)
 * Body is ALWAYS created; visibility controlled via style.display.
 * Click handlers toggle DOM only — never call updateHofNavigator.
 */
function _buildGroupEl(group, depth, isExpanded, expanded) {
    const groupEl  = document.createElement('div');
    groupEl.className = 'nav-tree-group';
    groupEl.dataset.groupId = group.id;

    // ── Header ───────────────────────────────────────────────────────────
    const levelCls = depth === 0 ? 'nav-level-0' : 'nav-level-1';
    const headerEl = document.createElement('div');
    headerEl.className = `nav-tree-header ${levelCls}${isExpanded ? ' expanded' : ''}`;
    headerEl.setAttribute('role', 'button');
    headerEl.setAttribute('aria-expanded', String(isExpanded));
    headerEl.innerHTML =
        `<span class="nav-chevron">${isExpanded ? '▾' : '▸'}</span>` +
        `<span class="nav-icon">${group.icon || '⬡'}</span>` +
        `<span class="nav-label">${escapeHtml(group.label)}</span>` +
        (group.badge ? `<span class="nav-badge">${escapeHtml(group.badge)}</span>` : '');

    // ── Body — always created, never conditionally omitted ────────────────
    const bodyEl = document.createElement('div');
    bodyEl.className = 'nav-tree-body';
    bodyEl.style.display = isExpanded ? '' : 'none';

    // ── Toggle click — DOM only, zero re-render ───────────────────────────
    headerEl.addEventListener('click', () => {
        // Don't toggle during active search
        const searchEl = document.getElementById('hof-navigator-search');
        if (searchEl && searchEl.value.trim()) return;

        const nowExpanded = !expanded[group.id];
        expanded[group.id] = nowExpanded;

        const chevron = headerEl.querySelector('.nav-chevron');
        if (chevron) chevron.textContent = nowExpanded ? '▾' : '▸';
        headerEl.classList.toggle('expanded', nowExpanded);
        headerEl.setAttribute('aria-expanded', String(nowExpanded));
        bodyEl.style.display = nowExpanded ? '' : 'none';
    });

    // ── Children ─────────────────────────────────────────────────────────
    if (group.children && group.children.length > 0) {
        group.children.forEach(child => {
            if (child.type === 'line-group') {
                // Nested sub-group (Ligne X under Routes/Trips)
                if (expanded[child.id] === undefined) {
                    expanded[child.id] = true; // default expanded
                }
                bodyEl.appendChild(_buildGroupEl(child, depth + 1, expanded[child.id] !== false, expanded));
            } else {
                // Leaf item
                bodyEl.appendChild(buildNavLeaf(child, depth + 1));
            }
        });
    }

    groupEl.appendChild(headerEl);
    groupEl.appendChild(bodyEl);
    return groupEl;
}

/**
 * 🔍 Filter navigator tree — DOM-only, no re-render
 * @param {string} query
 */
function filterNavTree(query) {
    const listEl = document.getElementById('hof-navigator-list');
    if (!listEl) return;

    const q = query.trim().toLowerCase();

    if (!q) {
        // ── Clear search: restore state from navigatorExpandedGroups ──────
        listEl.querySelectorAll('.nav-leaf').forEach(el => {
            el.style.display = '';
            el.classList.remove('nav-search-match');
        });

        listEl.querySelectorAll('.nav-tree-group').forEach(groupEl => {
            const groupId = groupEl.dataset.groupId;
            if (!groupId) return;

            const header  = groupEl.querySelector(':scope > .nav-tree-header');
            const body    = groupEl.querySelector(':scope > .nav-tree-body');
            const isExp   = state.hof.navigatorExpandedGroups[groupId] !== false;

            if (header) {
                header.style.display = '';
                header.classList.toggle('expanded', isExp);
                header.setAttribute('aria-expanded', String(isExp));
                const ch = header.querySelector('.nav-chevron');
                if (ch) ch.textContent = isExp ? '▾' : '▸';
            }
            if (body) body.style.display = isExp ? '' : 'none';
        });
        return;
    }

    // ── Active search: expand all, show only matching leaves ──────────────

    // 1. Force-expand all group bodies
    listEl.querySelectorAll('.nav-tree-body').forEach(body => {
        body.style.display = '';
    });
    listEl.querySelectorAll('.nav-tree-header').forEach(header => {
        header.style.display = '';
        header.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
        const ch = header.querySelector('.nav-chevron');
        if (ch) ch.textContent = '▾';
    });

    // 2. Show/hide leaves based on match
    listEl.querySelectorAll('.nav-leaf').forEach(el => {
        const text    = (el.querySelector('.nl-text')?.textContent || '').toLowerCase();
        const ctx     = (el.querySelector('.nl-ctx')?.textContent  || '').toLowerCase();
        const lineNum = (el.dataset.line || '');
        const itemId  = (el.dataset.itemId || '').toLowerCase();

        const matches = text.includes(q) || ctx.includes(q) ||
                        lineNum.includes(q) || itemId.includes(q);

        el.style.display = matches ? '' : 'none';
        el.classList.toggle('nav-search-match', matches);
    });

    // 3. Hide group headers that have no visible leaves
    listEl.querySelectorAll('.nav-tree-group').forEach(groupEl => {
        const hasVisible = Array.from(groupEl.querySelectorAll('.nav-leaf'))
            .some(l => l.style.display !== 'none');

        const header = groupEl.querySelector(':scope > .nav-tree-header');
        const body   = groupEl.querySelector(':scope > .nav-tree-body');
        if (header) header.style.display = hasVisible ? '' : 'none';
        if (body)   body.style.display   = hasVisible ? '' : 'none';
    });
}

/**
 * 🔧 Expand a navigator group via DOM only — no re-render
 * @param {string}  groupId
 * @param {boolean} toExpanded
 */
function _domSetGroupExpanded(groupId, toExpanded) {
    const listEl = document.getElementById('hof-navigator-list');
    if (!listEl) return;

    try {
        const groupEl = listEl.querySelector(`.nav-tree-group[data-group-id="${CSS.escape(groupId)}"]`);
        if (!groupEl) return;

        const header = groupEl.querySelector(':scope > .nav-tree-header');
        const body   = groupEl.querySelector(':scope > .nav-tree-body');

        if (header) {
            header.classList.toggle('expanded', toExpanded);
            header.setAttribute('aria-expanded', String(toExpanded));
            const ch = header.querySelector('.nav-chevron');
            if (ch) ch.textContent = toExpanded ? '▾' : '▸';
        }
        if (body) body.style.display = toExpanded ? '' : 'none';
    } catch (e) {
        // CSS.escape may fail on unusual IDs
    }
}

/**
 * 🍃 Build a navigator leaf element
 * @param {object} item  — flat item from flatItems
 * @param {number} depth — nesting depth (1 or 2)
 */
function buildNavLeaf(item, depth) {
    const ICONS = {
        trip:         '↳',
        busstop_list: '📍',
        section:      '⬡',
        stringcount:  '═'
    };
    const COLORS = {
        trip:         'trip',
        busstop_list: 'busstop',
        section:      'section',
        stringcount:  'variable'
    };

    const el = document.createElement('button');
    el.className = `nav-leaf nav-leaf--${COLORS[item.type] || 'section'} nav-depth-${depth}`;
    el.type = 'button';
    el.dataset.line   = item.line;
    el.dataset.itemId = item.id;

    // Build inner HTML
    let labelHtml = `<span class="nl-text" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>`;

    // Annotate busstop_list with trip context
    if (item.type === 'busstop_list' && item.tripContext) {
        labelHtml += `<span class="nl-ctx">${escapeHtml(item.tripContext)}</span>`;
    }

    el.innerHTML =
        `<span class="nl-icon">${ICONS[item.type] || '◆'}</span>` +
        `<span class="nl-label">${labelHtml}</span>` +
        `<span class="nl-line">L${item.line}</span>`;

    // ── Click: navigate to line ───────────────────────────────────────────
    el.addEventListener('click', () => {
        const editor = state.hof.editorInstance;
        if (!editor) return;

        editor.revealLineInCenter(item.line);
        editor.setPosition({ lineNumber: item.line, column: 1 });
        editor.focus();

        // Highlight
        document.querySelectorAll('.nav-leaf.active').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        _navActiveItemId = item.id;

        // Update breadcrumb with line number for click-to-navigate
        updateBreadcrumb(item.label, item.line);
        log(`Navigator → L${item.line}: ${item.label}`);
    });

    return el;
}

/**
 * 📋 Schedule HOF Navigator refresh (debounced)
 */
let navigatorTimeout = null;

function scheduleHofNavigatorRefresh(content) {
    if (navigatorTimeout) clearTimeout(navigatorTimeout);
    navigatorTimeout = setTimeout(() => updateHofNavigator(content), 350);
}

/**
 * 📋 Update HOF Navigator — parse content, store tree, render
 */
function updateHofNavigator(content) {
    try {
        if (!content || typeof content !== 'string') return;

        const result = parseHofNavigator(content);

        // Store in global state (for cursor sync etc.)
        state.hof.navigatorTree      = result.tree;
        state.hof.navigatorFlatItems = result.flatItems;

        // Cache in active tab (survives tab switches)
        const tab = getActiveTab();
        if (tab) {
            tab.navigatorTree          = result.tree;
            tab.navigatorFlatItems     = result.flatItems;
            tab.navigatorExpandedGroups = state.hof.navigatorExpandedGroups;
        }

        // Render tree
        renderHofNavigatorTree(result.tree);

        // Re-apply active search
        const searchEl = document.getElementById('hof-navigator-search');
        if (searchEl && searchEl.value.trim()) filterNavTree(searchEl.value);

    } catch (err) {
        log('Error updating navigator:', err);
    }
}

/**
 * 📋 Create HOF editor (Monaco or textarea fallback) (CORRECTED)
 */
/** Small helper: wire a toolbar button via cloneNode (removes stale listeners) */
function _wireToolbarButton(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
}

/**
 * 🖊 Create or reuse the Monaco editor for a tab.
 *
 * If Monaco already exists: creates a model for the tab and activates it
 * (no DOM manipulation, no AMD re-load).
 *
 * If first time: bootstraps Monaco via AMD, creates model, stores instance.
 *
 * @param {string} content  — file content
 * @param {string} tabId    — ID of the tab that owns this content
 */
/** Guard: prevents a second AMD bootstrap if one is already in flight */
let _monacoBootstrapping = false;

function createHofEditor(content, tabId) {
    const container = document.getElementById('hof-editor-container');
    if (!container) { log('Editor container not found'); return; }

    if (typeof content !== 'string') {
        showEditHofError('Invalid content received from server');
        return;
    }

    // ── Fast path: Monaco already exists ──────────────────────────────────
    if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
        const tab = _getTabById(tabId);
        if (tab && !tab.model) {
            _createTabModel(tab, content);
        }
        activateTab(tabId);
        scheduleHofValidation(content);
        updateHofNavigator(content);
        return;
    }

    // ── Bootstrap already in flight — the AMD callback will handle all queued tabs ──
    if (_monacoBootstrapping) {
        log(`Monaco bootstrap in flight — tab ${tabId} will be activated on landing`);
        return;
    }

    // ── First time: full AMD bootstrap ────────────────────────────────────
    _monacoBootstrapping = true;
    container.innerHTML = '';
    log(`Bootstrapping Monaco editor (first tab)`);

    require(['vs/editor/editor.main'], function () {
        try {
            // Language / theme / providers (all guarded — registered only once)
            registerOmsiHofLanguage(monaco);
            setupOmsiLanguageFeatures(monaco);
            setupOmsiAutocomplete(monaco);
            setupOmsiCodeActions(monaco);
            setupOmsiHoverProvider(monaco);

            // Create model for the first tab
            const tab = _getTabById(tabId);
            if (tab) {
                _createTabModel(tab, content);
            }

            // Create Monaco editor (no inline value — model is attached)
            const editor = monaco.editor.create(container, {
                model:   tab ? tab.model : monaco.editor.createModel(content, 'omsi-hof'),
                theme:   'omsi-dark',
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace",
                fontLigatures: true,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                minimap: { enabled: true, renderCharacters: false, scale: 1, side: 'right', showSlider: 'mouseover' },
                scrollbar: { vertical: 'auto', horizontal: 'auto', verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: true },
                lineNumbers: 'on',
                glyphMargin: true,
                folding: true,
                foldingHighlight: true,
                foldingStrategy: 'indentation',
                lineDecorationsWidth: 10,
                bracketPairColorization: { enabled: true },
                guides: { indentation: true, bracketPairs: true, bracketPairsHorizontal: true, highlightActiveBracketPair: true },
                renderWhitespace: 'selection',
                stickyScroll: { enabled: true, maxLineCount: 5 },
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                renderLineHighlight: 'all',
                occurrencesHighlight: true,
                selectionHighlight: true,
                overviewRulerLanes: 3,              // show error/warning/info lanes in scrollbar
                overviewRulerBorder: false,         // clean look — no border around the ruler
                codeLens: false,
                quickSuggestions: { other: true, comments: false, strings: false },
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'smart',
                tabCompletion: 'on',
                wordBasedSuggestions: 'off',
                suggest: {
                    filterGraceful: true,
                    snippetsPreventQuickSuggestions: false,
                    showSnippets: true, showKeywords: true, showWords: false,
                    maxVisibleSuggestions: 12, selectionMode: 'always'
                },
                'bracketPairColorization.independentColorPoolPerBracketType': true
            });

            state.hof.editorInstance = editor;
            state.hof.editorType     = 'monaco';
            log('Monaco Editor bootstrapped');

            // Force layout once
            setTimeout(() => { try { editor.layout(); } catch (_) {} }, 100);

            // ── ONE-TIME editor-level listeners ───────────────────────────
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveHofFileContent(false));

            // Ctrl+Tab / Ctrl+Shift+Tab — switch tabs
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, () => _activateAdjacentTab(1));
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => _activateAdjacentTab(-1));

            // Ctrl+W — close active tab (standard IDE shortcut)
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
                const activeTabId = state.hof.activeTabId;
                if (activeTabId) closeTab(activeTabId);
            });

            // Fold / Unfold toolbar buttons
            _wireToolbarButton('hof-fold-all-btn',   () => { editor.trigger('toolbar', 'editor.foldAll', null); editor.focus(); });
            _wireToolbarButton('hof-unfold-all-btn', () => { editor.trigger('toolbar', 'editor.unfoldAll', null); editor.focus(); });
            _wireToolbarButton('hof-undo-btn',   () => { editor.trigger('toolbar', 'undo', null); editor.focus(); });
            _wireToolbarButton('hof-redo-btn',   () => { editor.trigger('toolbar', 'redo', null); editor.focus(); });
            _wireToolbarButton('hof-diff-btn',   () => {
                const t = getActiveTab();
                openHofDiffModal(t ? t.originalContent : '', editor.getValue(),
                    state.hof.currentEditFileName || 'Unknown.hof', 'diff');
            });
            _wireToolbarButton('hof-history-btn', () => {
                const hofId = state.hof.currentEditId;
                const name  = state.hof.currentEditFileName || 'Unknown.hof';
                if (hofId) showHofVersionPanel(hofId, name);
                else showHofToast('⚠ No file selected', 'warn');
            });
            _wireToolbarButton('hof-format-btn', () => handleHofFormat(editor));

            // Cursor / selection → status bar
            editor.onDidChangeCursorPosition(() => { updateEditorStatusBar(editor); scheduleNavigatorActiveSync(editor); });
            editor.onDidChangeCursorSelection(() => updateEditorStatusBarSelection(editor));

            // Content change → dirty + backup + validation + navigator
            editor.onDidChangeModelContent(() => {
                const activeTab = getActiveTab();
                const editorContent = editor.getValue();

                if (activeTab) {
                    state.hof.currentEditContent = editorContent;
                }

                markHofDirty();
                scheduleHofAutoBackup();
                scheduleHofValidation(editorContent);
                scheduleHofNavigatorRefresh(editorContent);
            });

            updateEditorStatusBar(editor);

            // Activate the first tab (sets model, breadcrumb, status bar, etc.)
            activateTab(tabId);

            // Initial analysis
            scheduleHofValidation(content);
            updateHofNavigator(content);

            // Wire validation panel collapse + drag-resize
            // (must run after Monaco is ready so editor.layout() works during resize)
            initializeValidationPanel();

            // Wire breadcrumb section click → navigate to line in editor
            const bcSection = document.getElementById('breadcrumb-section');
            if (bcSection) {
                bcSection.addEventListener('click', () => {
                    const line = parseInt(bcSection.dataset.line, 10);
                    if (!line || !state.hof.editorInstance) return;
                    state.hof.editorInstance.revealLineInCenter(line);
                    state.hof.editorInstance.setPosition({ lineNumber: line, column: 1 });
                    state.hof.editorInstance.focus();
                    log(`Breadcrumb click → L${line}`);
                });
            }

            editor.focus();
            _monacoBootstrapping = false;

            // Activate any tabs that were queued while bootstrap was in flight
            state.hof.openTabs.forEach(t => {
                if (!t.model) _createTabModel(t, t.originalContent || '');
            });
            if (state.hof.activeTabId) activateTab(state.hof.activeTabId);

        } catch (err) {
            log('Monaco bootstrap error:', err.message);
            _monacoBootstrapping = false;
            showEditHofError(`Failed to create editor: ${err.message}`);
            createTextareaEditorFallback(container, content);
        }
    });
}

/**
 * 📋 Get editor content (CORRECTED)
 */
function getHofEditorContent() {
    if (!state.hof.editorInstance) {
        log('No editor instance found');
        return null;
    }

    let content = null;

    try {
        if (state.hof.editorType === 'monaco' && state.hof.editorInstance.getValue) {
            content = state.hof.editorInstance.getValue();
            log('Content retrieved from Monaco editor', { length: content.length });
        } else if (state.hof.editorType === 'textarea') {
            content = state.hof.editorInstance.value;
            log('Content retrieved from textarea', { length: content.length });
        }
    } catch (error) {
        log('Error getting editor content:', error);
        return null;
    }

    // Validate we got a string
    if (typeof content !== 'string') {
        log('Editor content is not string:', typeof content);
        return String(content || '');
    }

    return content;
}

/**
 * 📋 Save HOF file content (CORRECTED)
 */
async function saveHofFileContent(parseAfterSave = false) {
    // ── Visual feedback: saving in flight ─────────────────────────────────
    const saveBtn      = document.getElementById('edit-hof-save-btn');
    const saveParseBtn = document.getElementById('edit-hof-save-parse-btn');
    const _setBusy = (busy) => {
        if (saveBtn)      saveBtn.disabled      = busy;
        if (saveParseBtn) saveParseBtn.disabled = busy;
        if (busy) updateSaveStateStatus('saving');
    };

    _setBusy(true);
    try {
        if (!state.hof.currentEditId) {
            showEditHofError('No file selected for editing');
            return;
        }

        const content = getHofEditorContent();
        if (!content) {
            showEditHofError('Failed to get editor content');
            return;
        }

        log(`Saving HOF file ${state.hof.currentEditId}...`, {
            contentLength: content.length,
            parseAfterSave,
            contentPreview: content.substring(0, 100)
        });

        // CORRECTED: Send ONLY content and parseAfterSave
        const noteInput = document.getElementById('hof-version-note');
        const note = noteInput?.value?.trim() || null;

        const payload = {
            content: content,
            parseAfterSave: parseAfterSave,
            ...(note && { notes: note })   // include only if non-empty
        };

        log('Sending payload:', { contentLength: payload.content.length, parseAfterSave: payload.parseAfterSave, hasNote: !!note });

        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/${state.hof.currentEditId}/content`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        log('HOF file saved successfully', {
            success: result.success,
            hasContent: !!result.content,
            hasParsed: !!result.parsed,
            message: result.message
        });

        // CORRECTED: Never update editor with response
        // Keep editor showing the content we just saved
        const action = parseAfterSave ? 'saved and parsed' : 'saved';
        showEditHofSuccess(`✓ File ${action} successfully!`);

        // Mark clean + delete local backup
        markHofSaved();
        discardHofAutoBackup(state.hof.currentEditId);

        // Clear version note field after successful save
        const noteInputEl = document.getElementById('hof-version-note');
        const noteToggleEl = document.getElementById('hof-note-toggle');
        if (noteInputEl) { noteInputEl.value = ''; noteInputEl.style.display = 'none'; }
        if (noteToggleEl) noteToggleEl.textContent = '🏷 Add note…';

        // If parsed, show result both as toast and in the persistent output strip
        if (parseAfterSave && result.parsed) {
            log('Parse result:', result.parsed);
            const parsed  = result.parsed;
            const summary = result.message ||
                `${parsed.routesCreated ?? parsed.routeCount ?? 0} routes · ${parsed.stopsCreated ?? parsed.stopCount ?? 0} stops`;
            showEditHofSuccess(`✓ File saved and parsed!\n${summary}`);
            _showParseOutput(summary);
        }

        // Refresh HOF files list and routes in background — do NOT await,
        // the user stays in the editor after save.
        // Invalidate cache only when parse ran (route/stop counts may have changed).
        if (parseAfterSave) {
            _hofCountsCache.delete(state.hof.currentEditId);
        }
        fetchHofFiles();
        fetchRoutes();

    } catch (error) {
        log('Error saving HOF file:', error);
        showEditHofError(`Failed to save HOF file: ${error.message}`);
        // Restore unsaved state on error so user knows save didn't succeed
        if (state.hof.isDirty) updateSaveStateStatus('unsaved');
    } finally {
        _setBusy(false);
    }
}

/**
 * 📋 Close Edit modal (CORRECTED)
 */
async function closeHofEditModal() {
    // Dirty check across ALL open tabs
    const dirtyTabs = state.hof.openTabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
        let title, body;
        if (dirtyTabs.length === 1) {
            title = `Close "${escapeHtml(dirtyTabs[0].fileName)}"?`;
            body  = 'This file has unsaved changes.<br><br>Auto-backups are preserved locally — you can restore them next time.';
        } else {
            const list = dirtyTabs.map(t => `• ${escapeHtml(t.fileName)}`).join('<br>');
            title = `Close ${dirtyTabs.length} unsaved files?`;
            body  = `The following files have unsaved changes:<br><br>${list}<br><br>Auto-backups are preserved locally.`;
        }
        const ok = await _confirm(title, body, 'Close without saving');
        if (!ok) return;
    }

    // Clear any pending validation timer
    if (validationTimeout) { clearTimeout(validationTimeout); validationTimeout = null; }

    _doCloseModal();
    log('HOF modal closed by user');
}

/**
 * 📋 Show edit modal error (CORRECTED)
 */
function showEditHofError(message) {
    log('Edit HOF Error:', message);
    showToast(message, 'error', 5000);
}

/**
 * 📋 Show edit modal success
 */
function showEditHofSuccess(message) {
    log('Edit HOF Success:', message);
    showToast(message, 'success');
}

/**
 * ============================================
 * IDE STATUS BAR & BREADCRUMB
 * ============================================
 */

/**
 * 📊 Update editor status bar — cursor position & line count
 */
function updateEditorStatusBar(editor) {
    if (!editor) return;

    try {
        const pos = editor.getPosition();
        const model = editor.getModel();

        const cursorEl = document.getElementById('statusbar-cursor');
        const linecountEl = document.getElementById('statusbar-linecount');

        if (cursorEl && pos) {
            cursorEl.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
        }
        if (linecountEl && model) {
            const count = model.getLineCount();
            linecountEl.textContent = `${count.toLocaleString()} line${count !== 1 ? 's' : ''}`;
        }
    } catch (e) {
        // Ignore errors during status bar updates
    }
}

/**
 * 📊 Update selection info in status bar
 */
function updateEditorStatusBarSelection(editor) {
    if (!editor) return;

    try {
        const selection = editor.getSelection();
        const selectionEl = document.getElementById('statusbar-selection');
        if (!selectionEl) return;

        if (selection && !selection.isEmpty()) {
            const model = editor.getModel();
            if (model) {
                const selectedText = model.getValueInRange(selection);
                const lines = selection.endLineNumber - selection.startLineNumber + 1;
                const chars = selectedText.length;
                if (lines > 1) {
                    selectionEl.textContent = `(${lines} lines, ${chars} chars selected)`;
                } else {
                    selectionEl.textContent = `(${chars} char${chars !== 1 ? 's' : ''} selected)`;
                }
            }
        } else {
            selectionEl.textContent = '';
        }
    } catch (e) {
        // Ignore errors
    }
}

/**
 * 🗺️ Update breadcrumb bar with filename and current section
 */
function updateBreadcrumb(sectionLabel, lineNumber = null) {
    const sectionEl = document.getElementById('breadcrumb-section');
    if (sectionEl) {
        sectionEl.textContent = sectionLabel || '—';
        // Store line for click-to-navigate (empty string = no target)
        sectionEl.dataset.line = lineNumber != null ? String(lineNumber) : '';
        sectionEl.title = lineNumber != null
            ? `Go to line ${lineNumber} — ${sectionLabel}`
            : '';
    }
}

/**
 * 🗺️ Set breadcrumb filename
 */
function updateBreadcrumbFilename(filename) {
    const fileEl = document.getElementById('breadcrumb-filename');
    if (fileEl) {
        fileEl.textContent = filename || 'Unknown.hof';
    }
}

/**
 * 🧭 Schedule navigator active item sync (debounced on cursor move)
 */
let navigatorSyncTimeout = null;

/**
 * ============================================
 * HOF SAFETY SYSTEM — AUTO-BACKUP & UNSAVED GUARD
 * ============================================
 */

const HOF_BACKUP_PREFIX   = 'omsi_hof_backup_';
const HOF_BACKUP_DEBOUNCE = 2000;       // ms before auto-backup fires
const HOF_EDITOR_VERSION  = '1.0.0';

/**
 * 🔢 Fast djb2 content hash for change detection
 */
function simpleHash(str) {
    if (!str) return '0';
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

/**
 * 🕐 Format a Date as HH:mm:ss
 */
function fmtTime(date) {
    try {
        return date.toLocaleTimeString('fr-BE', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    } catch (_) {
        return date.toTimeString().slice(0, 8);
    }
}

/**
 * 📊 Update the save-state item in the status bar
 * @param {'saved'|'unsaved'|'backup'} stateStr
 * @param {string=} timeStr — HH:mm:ss label for backup state
 */
function updateSaveStateStatus(stateStr, timeStr) {
    const el = document.getElementById('statusbar-save-state');
    if (!el) return;

    el.className = 'statusbar-item statusbar-save-state';

    switch (stateStr) {
        case 'saved':
            el.textContent = '✓ Saved';
            el.classList.add('state-saved');
            el.title = 'All changes saved to server';
            break;
        case 'saving':
            el.textContent = '↑ Saving…';
            el.classList.add('state-saving');
            el.title = 'Saving to server…';
            break;
        case 'unsaved':
            el.textContent = '● Unsaved';
            el.classList.add('state-unsaved');
            el.title = 'You have unsaved changes';
            break;
        case 'backup':
            el.textContent = `💾 ${timeStr || 'Backup saved'}`;
            el.classList.add('state-backup');
            el.title = `Auto-backup saved locally at ${timeStr || ''}`;
            break;
    }
}

/**
 * 🔴 Mark editor content as dirty (unsaved changes)
 */
function markHofDirty() {
    const tab = getActiveTab();

    // If this tab was already dirty, nothing visual changes in the tab bar —
    // skip the full DOM re-render. This avoids calling renderTabBar() on
    // every single keystroke after the first one.
    if (tab && tab.isDirty && state.hof.isDirty) return;

    if (tab) tab.isDirty = true;

    // Re-render tab bar so the dirty dot appears (first time this tab goes dirty,
    // or when a second tab becomes dirty while the first was already dirty).
    renderTabBar();

    // Update status bar and modified indicator once
    if (!state.hof.isDirty) {
        state.hof.isDirty = true;
        updateSaveStateStatus('unsaved');
        const modEl = document.getElementById('statusbar-modified');
        if (modEl) modEl.style.display = 'flex';
    }
}

/**
 * ✅ Mark editor content as saved / clean
 */
function markHofSaved() {
    // Update active tab state
    const tab = getActiveTab();
    if (tab) {
        tab.isDirty = false;
        if (tab.backupTimeout) {
            clearTimeout(tab.backupTimeout);
            tab.backupTimeout = null;
        }
        // Update pristine content for future diffs
        const editor = state.hof.editorInstance;
        if (editor) tab.originalContent = editor.getValue();
    } else {
        // No active tab (edge case: modal closed during async save).
        // Safe to continue — state.hof.isDirty is still cleared below.
        log('markHofSaved: no active tab — clearing global dirty state only');
    }

    state.hof.isDirty = false;
    state.hof.originalEditContent = tab ? tab.originalContent : null;

    updateSaveStateStatus('saved');

    const modEl = document.getElementById('statusbar-modified');
    if (modEl) modEl.style.display = 'none';

    renderTabBar(); // clear dirty dot
}

/**
 * ⏱ Schedule a debounced auto-backup on every content change
 */
function scheduleHofAutoBackup() {
    const tab = getActiveTab();
    if (!tab) return;

    // Cancel previous timer for THIS tab
    if (tab.backupTimeout) clearTimeout(tab.backupTimeout);

    tab.backupTimeout = setTimeout(() => {
        const editor   = state.hof.editorInstance;
        const hofId    = tab.hofId;
        const fileName = tab.fileName;
        if (!editor || !hofId) return;

        const content = tab.model ? tab.model.getValue() : editor.getValue();
        saveHofAutoBackup(hofId, fileName, content);
        tab.autoBackupSavedAt = new Date();
    }, HOF_BACKUP_DEBOUNCE);
}

/**
 * 💾 Write auto-backup to localStorage
 */
function saveHofAutoBackup(hofId, fileName, content) {
    if (!hofId || content == null) return;

    try {
        const backup = {
            hofId,
            fileName,
            content,
            savedAt:       new Date().toISOString(),
            originalHash:  simpleHash(state.hof.currentEditContent || ''),
            contentHash:   simpleHash(content),
            editorVersion: HOF_EDITOR_VERSION
        };

        localStorage.setItem(HOF_BACKUP_PREFIX + hofId, JSON.stringify(backup));

        const now = new Date();
        state.hof.autoBackupSavedAt = now;
        updateSaveStateStatus('backup', fmtTime(now));

        log(`Auto-backup saved for HOF ${hofId}`);
    } catch (e) {
        log('Auto-backup failed:', e.message);
    }
}

/**
 * 📖 Read backup from localStorage
 * @returns {object|null}
 */
function getHofAutoBackup(hofId) {
    if (!hofId) return null;
    try {
        const raw = localStorage.getItem(HOF_BACKUP_PREFIX + hofId);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

/**
 * 🗑 Remove backup from localStorage
 */
function discardHofAutoBackup(hofId) {
    if (!hofId) return;
    try {
        localStorage.removeItem(HOF_BACKUP_PREFIX + hofId);
        log(`Backup discarded for HOF ${hofId}`);
    } catch (_) { /* ignore */ }
}

/**
 * 🔍 Check for an existing backup when opening a HOF file.
 * Silently discards if matches server; otherwise shows restore prompt.
 */
function checkHofBackupOnOpen(hofId, serverContent) {
    const backup = getHofAutoBackup(hofId);
    if (!backup) return;

    // Same content → clean up leftover
    if (backup.contentHash === simpleHash(serverContent || '')) {
        discardHofAutoBackup(hofId);
        return;
    }

    // Different → offer restore
    showHofBackupRestorePrompt(backup, serverContent);
}

/**
 * 🔔 Show the backup restore banner inside the HOF editor modal
 */
function showHofBackupRestorePrompt(backup, serverContent) {
    const banner = document.getElementById('hof-backup-banner');
    const detail = document.getElementById('backup-banner-detail');
    if (!banner) return;

    let timeStr = '—';
    try {
        const d = new Date(backup.savedAt);
        timeStr = `${d.toLocaleDateString()} ${fmtTime(d)}`;
    } catch (_) { /* ignore */ }

    if (detail) {
        detail.textContent = `${timeStr} · differs from server version`;
    }
    banner.hidden = false; // show

    const restoreBtn = document.getElementById('backup-restore-btn');
    const keepBtn    = document.getElementById('backup-keep-btn');
    const discardBtn = document.getElementById('backup-discard-btn');

    const hideBanner = () => { banner.hidden = true; };

    if (restoreBtn) {
        restoreBtn.onclick = () => {
            const editor = state.hof.editorInstance;
            if (editor && editor.getModel) {
                // Use executeEdits so the restore is undo-able with Ctrl+Z
                editor.pushUndoStop();
                editor.executeEdits('backup-restore', [{
                    range: editor.getModel().getFullModelRange(),
                    text:  backup.content
                }]);
                editor.pushUndoStop();
                editor.setScrollPosition({ scrollTop: 0 });
            }
            markHofDirty();
            scheduleHofAutoBackup();
            hideBanner();
            log(`Backup restored for HOF ${backup.hofId}`);
        };
    }

    if (keepBtn) {
        keepBtn.onclick = () => {
            hideBanner();
            log(`Kept server version, backup preserved for HOF ${backup.hofId}`);
        };
    }

    if (discardBtn) {
        discardBtn.onclick = () => {
            discardHofAutoBackup(backup.hofId);
            hideBanner();
            log(`Backup discarded for HOF ${backup.hofId}`);
        };
    }
}

/**
 * 🚫 Guard modal close — returns true if safe to close.
 * Checks ALL open tabs (not just the active one).
 */
/**
 * ============================================
 * END OF HOF SAFETY SYSTEM
 * ============================================
 */

/**
 * ============================================
 * HOF SERVER VERSION HISTORY
 * ============================================
 *
 * Fetches persistent version history from the server.
 * Works alongside the existing local auto-backup system.
 *
 * Endpoints used:
 *   GET    /api/hof/{id}/versions
 *   GET    /api/hof/{id}/versions/{versionId}
 *   POST   /api/hof/{id}/versions/{versionId}/rollback
 *   DELETE /api/hof/{id}/versions/{versionId}
 * ============================================
 */

async function fetchHofVersions(hofId) {
    const r = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/versions`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function fetchHofVersionContent(hofId, versionId) {
    const r = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/versions/${versionId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

/** Strategy B: load version into editor — user must still click Save */
async function loadServerVersionIntoEditor(hofId, versionId, versionNumber) {
    try {
        const ok = await _confirm(
            `↩ Load version v${versionNumber} into editor`,
            'Current unsaved content will be replaced.<br>Click <strong>Save</strong> afterwards to commit it to the server.',
            'Load version'
        );
        if (!ok) return;

        showHofToast('⏳ Loading version…', 'info');
        const detail = await fetchHofVersionContent(hofId, versionId);

        const editor = state.hof.editorInstance;
        const model  = editor?.getModel?.();
        if (editor && model) {
            editor.pushUndoStop();
            editor.executeEdits('version-restore', [{ range: model.getFullModelRange(), text: detail.content }]);
            editor.pushUndoStop();
        }

        markHofDirty();
        scheduleHofValidation(detail.content);
        scheduleHofNavigatorRefresh(detail.content);
        closeHofVersionPanel();
        showHofToast(`↩ v${versionNumber} loaded — click Save to commit`, 'info');
        log(`Server version ${versionNumber} loaded for HOF ${hofId}`);

    } catch (err) {
        showHofToast(`⚠ Failed: ${err.message}`, 'warn');
    }
}

/**
 * Styled rollback confirmation modal.
 * Returns a Promise<boolean> — resolves true if user confirms, false if cancelled.
 * Replaces window.confirm() for a consistent, accessible UI.
 */
/**
 * Generic confirmation modal — replaces window.confirm() throughout.
 * Returns Promise<boolean>. Resolves true on confirm, false on cancel/escape.
 *
 * @param {string}  title        — Dialog title
 * @param {string}  body         — HTML allowed; use escapeHtml() for user data
 * @param {string}  confirmLabel — Text on the confirm button  (default 'Confirm')
 * @param {boolean} isDanger     — Red styling for destructive actions
 */
function _confirm(title, body, confirmLabel = 'Confirm', isDanger = false) {
    return new Promise((resolve) => {
        document.getElementById('_generic-confirm')?.remove();

        const overlay = document.createElement('div');
        overlay.id = '_generic-confirm';
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:100001;
            display:flex; align-items:center; justify-content:center;
            background:rgba(0,0,0,0.65); backdrop-filter:blur(3px);
        `;

        const borderColor = isDanger
            ? 'rgba(var(--color-error-rgb, 255,71,87), 0.4)'
            : 'rgba(var(--accent-rgb, 132,250,176), 0.25)';
        const btnColor = isDanger
            ? 'var(--color-error, #ff4757)'
            : 'var(--accent, #84fab0)';
        const btnBg = isDanger
            ? 'rgba(var(--color-error-rgb, 255,71,87), 0.15)'
            : 'rgba(var(--accent-rgb, 132,250,176), 0.12)';

        overlay.innerHTML = `
            <div style="
                background:#1e1e2e; border:1px solid ${borderColor};
                border-radius:10px; padding:24px 28px; max-width:380px; width:90%;
                box-shadow:0 12px 40px rgba(0,0,0,0.7);
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                color:var(--text-primary,#e0e0e0);
            ">
                <p style="font-weight:700;font-size:1rem;margin-bottom:12px;">${title}</p>
                <p style="font-size:0.85rem;line-height:1.6;color:var(--text-muted,#b0b0b0);margin-bottom:20px;">${body}</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="_c-cancel" style="
                        padding:7px 16px;border:1px solid rgba(255,255,255,0.15);
                        background:transparent;color:var(--text-muted,#b0b0b0);
                        border-radius:6px;cursor:pointer;font-size:0.85rem;font-weight:600;
                    ">Cancel</button>
                    <button id="_c-ok" style="
                        padding:7px 16px;border:1px solid ${borderColor};
                        background:${btnBg};color:${btnColor};
                        border-radius:6px;cursor:pointer;font-size:0.85rem;font-weight:700;
                    ">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.querySelector('#_c-ok').focus();

        const cleanup = (result) => { overlay.remove(); resolve(result); };

        overlay.querySelector('#_c-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('#_c-cancel').addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });

        const onKey = (e) => {
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); cleanup(true); }
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
        };
        document.addEventListener('keydown', onKey);
    });
}

function _confirmRollback(versionNumber) {
    return new Promise((resolve) => {
        // Remove any pre-existing confirm dialog
        document.getElementById('hof-rollback-confirm')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'hof-rollback-confirm';
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:100000;
            display:flex; align-items:center; justify-content:center;
            background:rgba(0,0,0,0.65); backdrop-filter:blur(3px);
        `;

        overlay.innerHTML = `
            <div style="
                background:#1e1e2e; border:1px solid rgba(255,71,87,0.4);
                border-radius:10px; padding:28px 32px; max-width:400px; width:90%;
                box-shadow:0 12px 40px rgba(0,0,0,0.7);
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                color:#e0e0e0;
            ">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                    <span style="font-size:1.4rem;">⚡</span>
                    <span style="font-size:1.05rem;font-weight:700;color:#ff4757;">
                        Immediate Rollback — v${escapeHtml(String(versionNumber))}
                    </span>
                </div>
                <p style="font-size:0.88rem;line-height:1.6;margin-bottom:8px;">
                    This will restore <strong>version ${escapeHtml(String(versionNumber))}</strong>
                    on the server <strong>right now</strong>.
                </p>
                <p style="font-size:0.82rem;color:#b0b0b0;margin-bottom:22px;">
                    A new <code style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:3px;">ROLLBACK</code>
                    entry will be added to the version history.
                    Your current editor content will be updated.
                </p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="hof-rollback-cancel" style="
                        padding:8px 18px;border:1px solid rgba(255,255,255,0.15);
                        background:transparent;color:#b0b0b0;border-radius:6px;
                        cursor:pointer;font-size:0.88rem;font-weight:600;
                        transition:all 0.2s ease;
                    ">Cancel</button>
                    <button id="hof-rollback-ok" style="
                        padding:8px 18px;border:1px solid rgba(255,71,87,0.5);
                        background:rgba(255,71,87,0.15);color:#ff4757;border-radius:6px;
                        cursor:pointer;font-size:0.88rem;font-weight:700;
                        transition:all 0.2s ease;
                    ">⚡ Confirm Rollback</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('#hof-rollback-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('#hof-rollback-cancel').addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });

        // Keyboard: Enter = confirm, Escape = cancel
        const onKey = (e) => {
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); cleanup(true); }
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
        };
        document.addEventListener('keydown', onKey);

        // Focus the cancel button by default (safer)
        overlay.querySelector('#hof-rollback-cancel').focus();
    });
}

/** Strategy A: immediate server rollback (creates ROLLBACK version record) */
async function rollbackServerNow(hofId, versionId, versionNumber) {
    try {
        // Styled confirmation instead of window.confirm
        const ok = await _confirmRollback(versionNumber);
        if (!ok) return;

        showHofToast('⏳ Rolling back…', 'info');

        const r = await fetch(
            `${CONFIG.API_BASE_URL}/hof/${hofId}/versions/${versionId}/rollback`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parseAfterRollback: false }) }
        );

        const result = await r.json().catch(() => ({}));
        if (!r.ok) { showHofToast(`⚠ ${result.message || 'Rollback failed'}`, 'warn'); return; }

        if (result.restoredContent) {
            const editor = state.hof.editorInstance;
            const model  = editor?.getModel?.();
            if (editor && model) {
                editor.pushUndoStop();
                editor.executeEdits('rollback', [{ range: model.getFullModelRange(), text: result.restoredContent }]);
                editor.pushUndoStop();
            }
            const t = getActiveTab();
            if (t) { t.originalContent = result.restoredContent; }
            state.hof.originalEditContent = result.restoredContent;
            markHofSaved();
            discardHofAutoBackup(hofId);
            scheduleHofValidation(result.restoredContent);
            scheduleHofNavigatorRefresh(result.restoredContent);
        }

        closeHofVersionPanel();
        showHofToast(`✓ Rolled back to v${versionNumber}`, 'success');
        // Invalidate cached counts — rolled-back content may have different route/stop counts
        _hofCountsCache.delete(hofId);
        fetchHofFiles().catch(() => {});
        log(`Rollback to v${versionNumber} done for HOF ${hofId}`);

    } catch (err) {
        showHofToast(`⚠ Rollback failed: ${err.message}`, 'warn');
    }
}

/** Open diff viewer comparing a server version vs current editor content */
async function compareServerVersion(hofId, versionId, versionNumber, fileName) {
    try {
        showHofToast('⏳ Loading version…', 'info');
        const detail  = await fetchHofVersionContent(hofId, versionId);
        const current = state.hof.editorInstance?.getValue() || '';
        openHofDiffModal(detail.content, current,
            `${fileName} — v${versionNumber} vs current`, 'diff');
    } catch (err) {
        showHofToast(`⚠ ${err.message}`, 'warn');
    }
}

/** Delete a server version */
async function deleteServerVersion(hofId, versionId, versionNumber) {
    const ok = await _confirm(
        `🗑 Delete version v${versionNumber}`,
        'This version will be permanently removed from the server history.',
        'Delete',
        true
    );
    if (!ok) return;
    try {
        const r = await fetch(`${CONFIG.API_BASE_URL}/hof/${hofId}/versions/${versionId}`, { method: 'DELETE' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { showHofToast(`⚠ ${d.message || 'Delete failed'}`, 'warn'); return; }
        showHofToast(`🗑 v${versionNumber} deleted`, 'info');
        showHofVersionPanel(hofId, state.hof.currentEditFileName || 'Unknown.hof');
    } catch (err) {
        showHofToast(`⚠ ${err.message}`, 'warn');
    }
}

/** Open the version history slide-in panel */
async function showHofVersionPanel(hofId, fileName) {
    let panel = document.getElementById('hof-version-panel');
    if (!panel) {
        panel = _buildVersionPanelDOM();
        document.querySelector('.hof-edit-modal-content')?.appendChild(panel);
    }

    const titleEl = panel.querySelector('.hvp-filename');
    if (titleEl) titleEl.textContent = fileName;

    const listEl = panel.querySelector('.hvp-list');
    if (listEl) listEl.innerHTML = '<div class="hvp-loading">⏳ Loading history…</div>';

    panel.classList.remove('hidden');

    try {
        const versions = await fetchHofVersions(hofId);
        _renderVersionList(panel, hofId, fileName, versions);
    } catch (err) {
        if (listEl) listEl.innerHTML = `<div class="hvp-error">⚠ ${escapeHtml(err.message)}</div>`;
    }
}

function closeHofVersionPanel() {
    document.getElementById('hof-version-panel')?.classList.add('hidden');
}

function _buildVersionPanelDOM() {
    const panel = document.createElement('div');
    panel.id = 'hof-version-panel';
    panel.className = 'hof-version-panel hidden';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Server version history');
    panel.innerHTML = `
        <div class="hvp-header">
            <div class="hvp-header-left">
                <span class="hvp-icon" aria-hidden="true">🕑</span>
                <div>
                    <div class="hvp-title">Server History</div>
                    <div class="hvp-filename">—</div>
                </div>
            </div>
            <button class="hvp-close hof-ide-header__close" title="Close" type="button">✕</button>
        </div>
        <div class="hvp-list"></div>`;
    panel.querySelector('.hvp-close')?.addEventListener('click', closeHofVersionPanel);
    return panel;
}

function _renderVersionList(panel, hofId, fileName, versions) {
    const listEl = panel.querySelector('.hvp-list');
    if (!listEl) return;

    if (!versions?.length) {
        listEl.innerHTML = '<div class="hvp-empty">No versions yet.<br>Save the file to create the first snapshot.</div>';
        return;
    }

    const ICONS = { SAVE:'💾', SAVE_AND_PARSE:'💾⚙', REPLACE:'♻', ROLLBACK:'↩', UPLOAD:'📤', INITIAL:'🆕' };
    listEl.innerHTML = '';

    versions.forEach((v, idx) => {
        const isLatest = idx === 0;
        const d = new Date(v.createdAt);
        const dateStr = d.toLocaleDateString('fr-BE') + ' ' + d.toLocaleTimeString('fr-BE');
        const sizeKb = (v.sizeBytes / 1024).toFixed(1);
        const icon = ICONS[v.actionType] || '📄';

        const el = document.createElement('div');
        el.className = `hvp-item${isLatest ? ' hvp-item--latest' : ''}`;
        el.innerHTML = `
            <div class="hvp-item-top">
                <span class="hvp-action-icon">${icon}</span>
                <div class="hvp-item-meta">
                    <span class="hvp-vnum">v${v.versionNumber}${isLatest ? ' <span class="hvp-badge">latest</span>' : ''}</span>
                    <span class="hvp-date">${escapeHtml(dateStr)}</span>
                </div>
                <span class="hvp-size">${sizeKb} KB</span>
            </div>
            ${v.notes ? `<div class="hvp-notes">${escapeHtml(v.notes)}</div>` : ''}
            <div class="hvp-actions">
                <button class="hvp-btn hvp-btn--compare"  title="Compare with current">≠ Compare</button>
                <button class="hvp-btn hvp-btn--load"     title="Load into editor (review, then Save)">↩ Load</button>
                <button class="hvp-btn hvp-btn--rollback" title="Immediately restore on server">⚡ Rollback</button>
                ${!isLatest ? `<button class="hvp-btn hvp-btn--delete" title="Delete version">🗑</button>` : ''}
            </div>`;

        el.querySelector('.hvp-btn--compare') ?.addEventListener('click', () => compareServerVersion(hofId, v.id, v.versionNumber, fileName));
        el.querySelector('.hvp-btn--load')    ?.addEventListener('click', () => loadServerVersionIntoEditor(hofId, v.id, v.versionNumber));
        el.querySelector('.hvp-btn--rollback')?.addEventListener('click', () => rollbackServerNow(hofId, v.id, v.versionNumber));
        el.querySelector('.hvp-btn--delete')  ?.addEventListener('click', () => deleteServerVersion(hofId, v.id, v.versionNumber));

        listEl.appendChild(el);
    });
}

/**
 * ============================================
 * END OF HOF SERVER VERSION HISTORY
 * ============================================
 */

/**
 * ============================================
 * HOF DIFF VIEWER
 * Opens a Monaco DiffEditor in a dedicated modal.
 * Original  = state.hof.originalEditContent (pristine server version)
 * Modified  = current editor value (live edits)
 * ============================================
 */

/**
 * 🔍 Open the Diff Viewer modal
 * @param {string} original — server (pristine) content
 * @param {string} modified — current editor content
 * @param {string} fileName — displayed in header
 */
function openHofDiffModal(original, modified, fileName, mode = 'diff') {
    const modal = document.getElementById('hof-diff-modal');
    if (!modal) { log('Diff modal not found in DOM'); return; }

    // Filename
    const filenameEl = document.getElementById('diff-modal-filename');
    if (filenameEl) filenameEl.textContent = fileName || 'Unknown.hof';

    // Mode-specific UI adjustments
    _applyDiffModalMode(mode);

    // Reset stats
    const statsEl  = document.getElementById('hof-diff-stats');
    const noChgBtn = document.getElementById('hof-diff-no-changes');
    if (statsEl)  statsEl.textContent = '';
    if (noChgBtn) noChgBtn.hidden = true;

    // Loading state
    const loadingEl = document.getElementById('hof-diff-loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    _disposeDiffEditor();

    const isSideBySide = state.hof.diffSideBySide && window.innerWidth >= 768;

    requestAnimationFrame(() => {
        _createDiffEditor(original, modified, isSideBySide);
        _updateDiffLabels(isSideBySide, mode);
    });

    log(`Diff modal opened — mode: ${mode}`);
}

/**
 * 🏗 Create Monaco DiffEditor inside the mount point
 */
function _createDiffEditor(original, modified, sideBySide) {
    const mountEl   = document.getElementById('hof-diff-editor-mount');
    const loadingEl = document.getElementById('hof-diff-loading');

    if (!mountEl || typeof monaco === 'undefined') {
        log('Diff: mount element or Monaco not available');
        return;
    }

    try {
        // Create original model (read-only left pane)
        const originalModel = monaco.editor.createModel(
            original,
            'omsi-hof'
        );

        // Create modified model (read-only right pane — editing happens in the main editor)
        const modifiedModel = monaco.editor.createModel(
            modified,
            'omsi-hof'
        );

        // Create the DiffEditor
        const diffEditor = monaco.editor.createDiffEditor(mountEl, {
            theme:                'omsi-dark',
            readOnly:             true,
            originalEditable:     false,
            renderSideBySide:     sideBySide,
            automaticLayout:      true,
            fontSize:             12,
            fontFamily:           "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontLigatures:        true,
            scrollBeyondLastLine: false,
            minimap:              { enabled: sideBySide, renderCharacters: false },
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8
            },
            diffWordWrap:         'on',
            ignoreTrimWhitespace: false,
            renderIndicators:     true,
            enableSplitViewResizing: true,
            lineNumbers:          'on',
            smoothScrolling:      true,
            cursorBlinking:       'smooth',
            renderLineHighlight:  'all'
        });

        diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel
        });

        // Store instances for cleanup
        state.hof.diffEditorInstance = {
            editor:         diffEditor,
            originalModel,
            modifiedModel
        };

        // Hide loading once editor is ready
        if (loadingEl) loadingEl.style.display = 'none';

        // Compute and display change stats
        diffEditor.onDidUpdateDiff(() => {
            _updateDiffStats(diffEditor);
        });

        // Force initial layout
        setTimeout(() => {
            try { diffEditor.layout(); } catch (_) {}
        }, 50);

        log('DiffEditor created');

    } catch (err) {
        log('Error creating DiffEditor:', err.message);
        if (loadingEl) {
            loadingEl.textContent = `⚠ Error: ${err.message}`;
        }
    }
}

/**
 * 📊 Update diff stats bar (additions / deletions)
 */
function _updateDiffStats(diffEditor) {
    try {
        const statsEl  = document.getElementById('hof-diff-stats');
        const noChgBtn = document.getElementById('hof-diff-no-changes');

        const changes = diffEditor.getLineChanges();

        if (!changes || changes.length === 0) {
            if (statsEl)  statsEl.innerHTML = '';
            if (noChgBtn) noChgBtn.hidden = false;
            return;
        }

        if (noChgBtn) noChgBtn.hidden = true;

        // Count approximate lines added / removed
        let added = 0, removed = 0;
        changes.forEach(change => {
            // Lines in modified that are insertions
            const modLines = change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
            const origLines = change.originalEndLineNumber - change.originalStartLineNumber + 1;
            if (change.originalEndLineNumber === 0) {
                added += modLines;          // pure insertion
            } else if (change.modifiedEndLineNumber === 0) {
                removed += origLines;       // pure deletion
            } else {
                // modification — count both sides
                added   += modLines;
                removed += origLines;
            }
        });

        if (statsEl) {
            statsEl.innerHTML =
                `<span class="diff-stat diff-stat--changes">${changes.length} change${changes.length !== 1 ? 's' : ''}</span>` +
                (added   ? `<span class="diff-stat diff-stat--added">+${added} line${added   !== 1 ? 's' : ''}</span>` : '') +
                (removed ? `<span class="diff-stat diff-stat--removed">−${removed} line${removed !== 1 ? 's' : ''}</span>` : '');
        }
    } catch (_) {
        // Stats are cosmetic — ignore errors
    }
}

/**
 * 🏷 Show/hide column labels, update text based on mode
 * @param {boolean} sideBySide
 * @param {'diff'|'format'} mode
 */
function _updateDiffLabels(sideBySide, mode = 'diff') {
    const labelsEl = document.getElementById('hof-diff-labels');
    if (!labelsEl) return;

    labelsEl.style.display = sideBySide ? 'grid' : 'none';

    const leftEl  = labelsEl.querySelector('.hof-diff-label--original');
    const rightEl = labelsEl.querySelector('.hof-diff-label--modified');

    if (mode === 'format') {
        if (leftEl)  leftEl.innerHTML  = '<span class="diff-label-icon" aria-hidden="true">✏️</span> Current content <span class="diff-label-tag">(before format)</span>';
        if (rightEl) rightEl.innerHTML = '<span class="diff-label-icon" aria-hidden="true">⫶</span> Formatted content <span class="diff-label-tag">(after format)</span>';
    } else {
        if (leftEl)  leftEl.innerHTML  = '<span class="diff-label-icon" aria-hidden="true">📥</span> Server version <span class="diff-label-tag">(original)</span>';
        if (rightEl) rightEl.innerHTML = '<span class="diff-label-icon" aria-hidden="true">✏️</span> Current edit <span class="diff-label-tag">(modified)</span>';
    }
}

/**
 * 🔄 Toggle between side-by-side and inline diff
 */
function toggleDiffSideBySide() {
    state.hof.diffSideBySide = !state.hof.diffSideBySide;

    const inst = state.hof.diffEditorInstance;
    if (!inst) return;

    const newMode = state.hof.diffSideBySide && window.innerWidth >= 768;
    inst.editor.updateOptions({ renderSideBySide: newMode });
    inst.editor.updateOptions({ minimap: { enabled: newMode } });
    _updateDiffLabels(newMode);

    // Update toggle button label
    const toggleBtn = document.getElementById('hof-diff-inline-toggle');
    if (toggleBtn) {
        const label = toggleBtn.querySelector('.hof-toolbar-btn__label');
        if (label) label.textContent = newMode ? 'Side-by-side' : 'Inline';
        const icon = toggleBtn.querySelector('.hof-toolbar-btn__icon');
        if (icon) icon.textContent = newMode ? '⇔' : '≡';
    }

    log(`Diff view: ${newMode ? 'side-by-side' : 'inline'}`);
}

/**
 * 🚪 Close the Diff Viewer modal and clean up
 */
function closeHofDiffModal() {
    const modal = document.getElementById('hof-diff-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';

    _disposeDiffEditor();
    log('Diff modal closed');
}

/**
 * 🗑 Dispose DiffEditor + models — does NOT touch the main editor
 */
function _disposeDiffEditor() {
    const inst = state.hof.diffEditorInstance;
    if (!inst) return;

    try {
        inst.editor.dispose();
    } catch (_) {}
    try {
        inst.originalModel.dispose();
    } catch (_) {}
    try {
        inst.modifiedModel.dispose();
    } catch (_) {}

    state.hof.diffEditorInstance = null;
}

/** Guard: ensures the global Escape listener for the diff modal is added only once */
let _diffEscapeWired = false;

/**
 * 🔌 Wire Diff modal controls (called once from setupHofModule)
 */
function setupDiffModal() {
    // Header close button
    const closeBtn = document.getElementById('hof-diff-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeHofDiffModal);
    }

    // Footer close button
    const footerCloseBtn = document.getElementById('hof-diff-close-footer-btn');
    if (footerCloseBtn) {
        footerCloseBtn.addEventListener('click', closeHofDiffModal);
    }

    // Apply Format button (shown only in format-preview mode)
    _wireApplyFormatButton();

    // Overlay click to close
    const overlay = document.getElementById('hof-diff-overlay');
    if (overlay) {
        overlay.addEventListener('click', closeHofDiffModal);
    }

    // Toggle side-by-side / inline
    const toggleBtn = document.getElementById('hof-diff-inline-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleDiffSideBySide);
    }

    // Keyboard: Escape closes diff modal.
    // Guard ensures this global listener is added only once,
    // even if setupDiffModal() is called again in a future refactor.
    if (!_diffEscapeWired) {
        _diffEscapeWired = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('hof-diff-modal');
                if (modal && !modal.classList.contains('hidden')) {
                    e.stopPropagation();
                    closeHofDiffModal();
                }
            }
        });
    }

    log('Diff modal wired');
}

/**
 * ============================================
 * END OF HOF DIFF VIEWER
 * ============================================
 */

/**
 * ============================================
 * HOF AUTO-FORMAT SYSTEM
 * ============================================
 */

/**
 * 🧹 formatHofContent — conservative formatter (whitespace-only changes)
 *
 * Rules applied (in order):
 *   1. Normalize line endings (detect CRLF/LF, process as LF, re-apply)
 *   2. Convert leading tabs → 4 spaces
 *   3. Remove trailing whitespace from every line
 *   4. Collapse more than 2 consecutive blank lines → 2
 *   5. Trim leading blank lines at top of file
 *   6. Ensure exactly one trailing newline at end of file
 *
 * NEVER changes: section names, stop names, identifiers, numeric values.
 *
 * @param  {string} content — raw HOF file content
 * @returns {string}         — cleaned content
 */
function formatHofContent(content) {
    if (!content) return content;

    // Detect line ending style (preserve for output)
    const hasCRLF = content.includes('\r\n');

    // Normalise to LF for processing
    const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const out = [];
    let consecutiveBlanks = 0;

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];

        // Rule 2: leading tabs → spaces
        line = line.replace(/^\t+/, t => '    '.repeat(t.length));

        // Rule 3: trailing whitespace
        line = line.trimEnd();

        const isBlank = line.length === 0;

        if (isBlank) {
            consecutiveBlanks++;
            // Rule 4: max 2 consecutive blank lines
            if (consecutiveBlanks > 2) continue;
        } else {
            consecutiveBlanks = 0;
        }

        out.push(line);
    }

    // Rule 5: strip leading blank lines
    while (out.length > 0 && out[0].length === 0) {
        out.shift();
    }

    // Rule 6: exactly one trailing newline — remove excess trailing blanks, keep one
    while (out.length > 1 && out[out.length - 1].length === 0 &&
           out[out.length - 2].length === 0) {
        out.pop();
    }
    // Ensure file ends with newline
    if (out.length > 0 && out[out.length - 1].length !== 0) {
        out.push('');
    }

    const eol = hasCRLF ? '\r\n' : '\n';
    return out.join(eol);
}

/**
 * ⫶ handleHofFormat — calculate formatted content, show diff preview or toast
 */
function handleHofFormat(editor) {
    if (!editor) {
        editor = state.hof.editorInstance;
    }
    if (!editor) return;

    const currentContent  = editor.getValue();
    const formattedContent = formatHofContent(currentContent);

    if (formattedContent === currentContent) {
        showHofToast('✓ No formatting changes needed', 'success');
        log('Format: no changes needed');
        return;
    }

    // Store for Apply button
    state.hof.pendingFormattedContent = formattedContent;

    // Count approximate diff stats for the toast
    const originalLines  = currentContent.split('\n').length;
    const formattedLines = formattedContent.split('\n').length;
    const delta = formattedLines - originalLines;
    const hint  = delta === 0 ? 'whitespace only' : `${Math.abs(delta)} line${Math.abs(delta) !== 1 ? 's' : ''} ${delta > 0 ? 'added' : 'removed'}`;

    log(`Format preview: ${hint}`);

    // Open diff viewer in format-preview mode
    openHofDiffModal(
        currentContent,
        formattedContent,
        state.hof.currentEditFileName || 'Unknown.hof',
        'format'
    );
}

/**
 * ✓ applyHofFormat — apply the pending formatted content to Monaco editor
 */
function applyHofFormat() {
    const editor    = state.hof.editorInstance;
    const formatted = state.hof.pendingFormattedContent;

    if (!editor || !formatted) {
        log('applyHofFormat: editor or pending content not available');
        return;
    }

    const model = editor.getModel();
    if (!model) return;

    // Apply as a single undoable edit (Ctrl+Z can revert it)
    editor.pushUndoStop();
    editor.executeEdits('auto-format', [{
        range: model.getFullModelRange(),
        text:  formatted
    }]);
    editor.pushUndoStop();

    // Update state
    state.hof.pendingFormattedContent = null;

    markHofDirty();
    scheduleHofAutoBackup();
    scheduleHofValidation(formatted);
    scheduleHofNavigatorRefresh(formatted);

    closeHofDiffModal();
    showHofToast('⫶ Format applied', 'success');
    log('Format applied successfully');
}

/**
 * 🔔 Set diff modal UI into the correct mode (diff vs format-preview)
 * @param {'diff'|'format'} mode
 */
function _applyDiffModalMode(mode) {
    const applyBtn = document.getElementById('hof-format-apply-btn');
    const titleEl  = document.querySelector('#hof-diff-modal .hof-diff-header__title');
    const iconEl   = document.querySelector('#hof-diff-modal .hof-diff-header__icon');

    if (mode === 'format') {
        if (applyBtn) applyBtn.hidden = false;
        if (titleEl)  titleEl.textContent = 'Format Preview';
        if (iconEl)   iconEl.textContent  = '⫶';
    } else {
        if (applyBtn) applyBtn.hidden = true;
        if (titleEl)  titleEl.textContent = 'Diff Viewer';
        if (iconEl)   iconEl.textContent  = '≠';
        // Clear pending format content
        state.hof.pendingFormattedContent = null;
    }
}

/**
 * 🍞 Show a brief toast notification in the HOF editor area
 * @param {string}           message
 * @param {'success'|'info'|'warn'} type
 */
/**
 * ============================================
 * GLOBAL TOAST NOTIFICATION SYSTEM
 * ============================================
 *
 * showToast(message, type, duration)
 *   type    : 'success' | 'error' | 'warn' | 'info'  (default 'info')
 *   duration: ms before auto-dismiss                  (default 3000)
 *
 * Toasts stack in the bottom-right corner via #toast-container.
 * Each toast is independent — multiple can coexist.
 * Works both inside and outside modals.
 *
 * showHofToast() is kept as an alias for backward-compatibility
 * with all existing call sites inside the HOF/Diff modals.
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) {
        // Graceful fallback if container not in DOM yet
        log(`[Toast/${type}] ${message}`);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');

    // Icon prefix per type
    const icons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
    const icon = document.createElement('span');
    icon.textContent = icons[type] || 'ℹ';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(text);
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('toast--visible'));
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 250);
    }, duration);

    log(`[Toast/${type}] ${message}`);
}

/**
 * Alias kept for all existing showHofToast() call sites.
 * Maps type 'warn' → 'warn' (already compatible).
 */
function showHofToast(message, type = 'info') {
    showToast(message, type);
}

/**
 * ============================================
 * END OF HOF AUTO-FORMAT SYSTEM
 * ============================================
 */

/**
 * ============================================
 * HOF QUICK FIX — CODE ACTION PROVIDER
 * ============================================
 */

/**
 * ⚡ setupOmsiCodeActions — register Monaco CodeActionProvider for omsi-hof
 * Called once (guarded by _omsiProvidersRegistered flag).
 */
function setupOmsiCodeActions(monaco) {
    // Guard is checked by caller order — this runs before flag is set in setupOmsiHoverProvider

    monaco.languages.registerCodeActionProvider('omsi-hof', {
        provideCodeActions: function (model, range, context) {
            const actions = [];

            if (!context.markers || context.markers.length === 0) {
                return { actions, dispose: () => {} };
            }

            context.markers.forEach(marker => {
                // Normalize code — Monaco sometimes wraps it in an object
                const rawCode = marker.code;
                const code    = typeof rawCode === 'object' && rawCode !== null
                    ? (rawCode.value || '')
                    : (rawCode || '');

                const msg = (marker.message || '').toLowerCase();

                // ── STOP_COUNT_MISMATCH ──────────────────────────────────────
                const isStopCountIssue =
                    code === 'STOP_COUNT_MISMATCH' ||
                    code === 'STOP_COUNT' ||
                    msg.includes('stop count') ||
                    msg.includes('stopcount') ||
                    msg.includes('count mismatch');

                if (isStopCountIssue) {
                    const fix = _computeStopCountFix(model, marker);
                    if (fix) {
                        actions.push({
                            title: '🔧 Update stop count to detected value',
                            kind:  'quickfix',
                            edit:  fix,
                            isPreferred: true,
                            diagnostics: [marker]
                        });
                    }
                }

                // ── UNKNOWN_SECTION — intentionally no auto-fix ──────────────
                // (leave lightbulb empty; suppress by doing nothing)
            });

            return { actions, dispose: () => {} };
        }
    });

    log('OMSI Code Action provider registered');
}

/**
 * 🔧 Compute the WorkspaceEdit for fixing a STOP_COUNT_MISMATCH
 * Finds the [infosystem_busstop_list] section near the marker,
 * counts actual stop names, and replaces the declared count line.
 *
 * @param  {monaco.editor.ITextModel} model
 * @param  {monaco.editor.IMarkerData} marker
 * @returns {monaco.languages.WorkspaceEdit | null}
 */
function _computeStopCountFix(model, marker) {
    try {
        const lines      = model.getLinesContent();
        const markerIdx  = marker.startLineNumber - 1; // 0-based
        const SEC_RE     = /^\s*\[[a-zA-Z0-9_]+\]\s*$/;
        const BSL_RE     = /^\[infosystem_busstop_list\]$/i;

        // Search for [infosystem_busstop_list] near the marker (±10 lines)
        let sectionIdx = -1;
        for (let i = Math.max(0, markerIdx - 2); i <= Math.min(lines.length - 1, markerIdx + 10); i++) {
            if (BSL_RE.test(lines[i].trim())) {
                sectionIdx = i;
                break;
            }
        }
        // Also search backward
        if (sectionIdx === -1) {
            for (let i = markerIdx; i >= Math.max(0, markerIdx - 15); i--) {
                if (BSL_RE.test(lines[i].trim())) {
                    sectionIdx = i;
                    break;
                }
            }
        }
        if (sectionIdx === -1) return null;

        // First non-blank line after section header = the count line
        let countIdx = -1;
        for (let i = sectionIdx + 1; i < Math.min(lines.length, sectionIdx + 6); i++) {
            if (lines[i].trim() !== '') { countIdx = i; break; }
        }
        if (countIdx === -1) return null;

        // Count actual stop names: non-blank lines after countIdx until next section or EOF
        let actualCount = 0;
        for (let i = countIdx + 1; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t === '') continue;
            if (SEC_RE.test(t)) break;
            actualCount++;
        }

        // If count already matches, nothing to fix
        const declaredCount = parseInt(lines[countIdx].trim(), 10);
        if (!isNaN(declaredCount) && declaredCount === actualCount) return null;

        // Build the workspace edit
        return {
            edits: [{
                resource:  model.uri,
                versionId: model.getVersionId(),
                textEdit: {
                    range: {
                        startLineNumber: countIdx + 1,
                        endLineNumber:   countIdx + 1,
                        startColumn:     1,
                        endColumn:       lines[countIdx].length + 1
                    },
                    text: String(actualCount)
                }
            }]
        };
    } catch (err) {
        log('_computeStopCountFix error:', err.message);
        return null;
    }
}

/**
 * 🔌 Wire the Apply Format button in the diff modal footer
 * Called once from setupDiffModal.
 */
function _wireApplyFormatButton() {
    const applyBtn = document.getElementById('hof-format-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyHofFormat);
    }
}

/**
 * ============================================
 * END OF HOF QUICK FIX
 * ============================================
 */

function scheduleNavigatorActiveSync(editor) {
    if (navigatorSyncTimeout) {
        clearTimeout(navigatorSyncTimeout);
    }
    navigatorSyncTimeout = setTimeout(() => {
        syncNavigatorToEditorCursor(editor);
    }, 150);
}

/**
 * 🧭 Highlight the navigator leaf matching the editor cursor position
 *    Auto-expands parent groups so the item is visible.
 *    Debounced — call scheduleNavigatorActiveSync(editor) instead.
 */
function syncNavigatorToEditorCursor(editor) {
    if (!editor) return;

    try {
        const pos = editor.getPosition();
        if (!pos) return;

        const currentLine   = pos.lineNumber;
        const flatItems     = state.hof.navigatorFlatItems || [];
        if (flatItems.length === 0) return;

        // Find the flat item whose line is the closest but ≤ cursor line
        let bestItem = null;
        let bestLine = -1;

        flatItems.forEach(item => {
            if (item.line <= currentLine && item.line > bestLine) {
                bestLine = item.line;
                bestItem = item;
            }
        });

        if (!bestItem) {
            updateBreadcrumb('—');
            return;
        }

        // ── DOM-only: expand parent groups so item is visible ─────────────
        if (!state.hof.navigatorExpandedGroups) {
            state.hof.navigatorExpandedGroups = { ...NAV_DEFAULTS_EXPANDED };
        }
        const exp = state.hof.navigatorExpandedGroups;

        // Determine which groups need to be opened
        const groupsToOpen = [];
        if (bestItem.type === 'trip') {
            if (!exp['trips'])                        groupsToOpen.push('trips');
            if (!exp[`line-${bestItem.lineNumber}`])  groupsToOpen.push(`line-${bestItem.lineNumber}`);
        } else if (bestItem.type === 'busstop_list') {
            if (!exp['busstop-lists'])                groupsToOpen.push('busstop-lists');
        } else if (bestItem.type === 'section') {
            if (!exp['sections'])                     groupsToOpen.push('sections');
        } else if (bestItem.type === 'stringcount') {
            if (!exp['variables'])                    groupsToOpen.push('variables');
        }

        // Open them via DOM (no re-render)
        groupsToOpen.forEach(groupId => {
            exp[groupId] = true;
            _domSetGroupExpanded(groupId, true);
        });

        // ── Highlight the leaf ────────────────────────────────────────────
        _navActiveItemId = bestItem.id;
        document.querySelectorAll('.nav-leaf.active').forEach(el => el.classList.remove('active'));

        const leafEl = document.querySelector(`.nav-leaf[data-item-id="${CSS.escape(bestItem.id)}"]`);
        if (leafEl) {
            leafEl.classList.add('active');
            leafEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        // Update breadcrumb
        updateBreadcrumb(bestItem.label, bestItem.line);

    } catch (e) {
        // Ignore errors during sync
    }
}

/**
 * ============================================
 * HOF EDITOR INITIALIZATION
 * ============================================
 */

/**
 * 📋 Initialize Monaco Editor globally
 */
function initializeMonacoLoader() {
    if (typeof require === 'undefined') {
        return;
    }

    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    log('Monaco loader configured');
}

/**
 * 📋 Textarea fallback editor
 */
function createTextareaEditorFallback(container, content) {
    log('Creating textarea fallback editor');

    // Validate content is string
    if (typeof content !== 'string') {
        log('Content is not string for textarea:', typeof content);
        content = String(content || '');
    }

    const textarea = document.createElement('textarea');
    textarea.id = 'hof-editor-fallback';
    textarea.className = 'hof-textarea-editor';
    textarea.value = content;
    textarea.spellcheck = false;
    textarea.style.cssText = `
        width: 100%;
        height: 100%;
        padding: 15px;
        font-family: 'Courier New', 'Monaco', 'Consolas', monospace;
        font-size: 14px;
        background: #1e1e1e;
        color: #d4d4d4;
        border: none;
        outline: none;
        resize: none;
        line-height: 1.5;
        box-sizing: border-box;
    `;

    container.appendChild(textarea);

    // Store editor instance
    state.hof.editorInstance = textarea;
    state.hof.editorType = 'textarea';

    log('Textarea editor created (fallback)');

    // Handle Ctrl+S for save in textarea
    textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            log('Ctrl+S pressed in textarea');
            saveHofFileContent(false);
        }
    });

    // Focus textarea
    textarea.focus();
}

/**
 * 📋 Create Textarea Editor (deprecated - use fallback instead)
 */
function createTextareaEditor(container, content) {
    log('Creating textarea editor (deprecated)');
    createTextareaEditorFallback(container, content);
}

/**
 * 📋 Schedule HOF validation with debounce
 */
let validationTimeout = null;

/** Content string currently scheduled for validation (set at schedule time, cleared on dispatch) */
let _pendingValidationContent = null;

function scheduleHofValidation(content) {
    // Only skip if we've already scheduled validation for this exact content
    if (_pendingValidationContent === content && validationTimeout) {
        return;
    }

    if (validationTimeout) {
        clearTimeout(validationTimeout);
    }

    _pendingValidationContent = content;
    updateValidationStatus('Validating...');

    validationTimeout = setTimeout(() => {
        _pendingValidationContent = null;
        validateHofContent(content);
    }, 1000);

    log('HOF validation scheduled (1s debounce)');
}

/**
 * 📋 Validate HOF content via API
 */
/**
 * ────────────────────────────────────────────────────────────────────
 * CLIENT-SIDE SUPPLEMENT VALIDATOR
 * ────────────────────────────────────────────────────────────────────
 *
 * Runs after the server validation response and adds any warnings the
 * backend may not implement.  Results are MERGED into `result` in-place
 * so all downstream consumers (Monaco markers, panel, counters) see them.
 *
 * Currently checks:
 *   • [infosystem_busstop_list] — declared stopCount vs actual stop names
 */
function _mergeClientSideWarnings(content, result) {
    if (!content || typeof content !== 'string') return;

    // Ensure warnings array exists
    if (!Array.isArray(result.warnings)) result.warnings = [];

    const lines   = content.split('\n');
    const SEC_RE  = /^\s*\[[a-zA-Z0-9_]+\]\s*$/;
    const BSL_RE  = /^\[infosystem_busstop_list\]$/i;

    for (let i = 0; i < lines.length; i++) {
        if (!BSL_RE.test(lines[i].trim())) continue;

        const sectionLine = i + 1;   // 1-based for Monaco / panel

        // First non-blank line after section header = stopCount declaration
        let countIdx = -1;
        for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
            if (lines[j].trim() !== '') { countIdx = j; break; }
        }
        if (countIdx === -1) continue;   // malformed — no count line

        const declared = parseInt(lines[countIdx].trim(), 10);
        if (isNaN(declared)) continue;   // count line isn't a number

        // Count actual stop name lines until next section or EOF
        let actual = 0;
        for (let j = countIdx + 1; j < lines.length; j++) {
            const t = lines[j].trim();
            if (t === '') continue;
            if (SEC_RE.test(t)) break;
            actual++;
        }

        if (declared === actual) continue;   // counts match — nothing to report

        // Check if the server already reported this mismatch on this line
        const alreadyReported = result.warnings.some(
            w => w.line === countIdx + 1 && (
                (w.code || '').toUpperCase().includes('STOP_COUNT') ||
                (w.message || '').toLowerCase().includes('stop count') ||
                (w.message || '').toLowerCase().includes('stopcount')
            )
        ) || result.errors?.some(
            e => e.line === countIdx + 1 && (
                (e.code || '').toUpperCase().includes('STOP_COUNT') ||
                (e.message || '').toLowerCase().includes('stop count')
            )
        );

        if (alreadyReported) continue;

        // Build the warning — same structure as backend warnings
        result.warnings.push({
            line:    countIdx + 1,          // line of the count declaration
            column:  1,
            code:    'STOP_COUNT_MISMATCH',
            message: `[infosystem_busstop_list] at line ${sectionLine}: ` +
                     `declared ${declared} stop${declared !== 1 ? 's' : ''} ` +
                     `but found ${actual}.`,
            severity: 'warning',
            source:  'HOF Validator (client)'
        });

        log(`[infosystem_busstop_list] L${sectionLine}: ` +
            `declared=${declared}, actual=${actual} → STOP_COUNT_MISMATCH added`);
    }
}

async function validateHofContent(content) {
    try {
        if (!content || typeof content !== 'string') {
            log('Invalid content for validation');
            applyValidationDiagnostics({ errors: [], warnings: [] });
            updateValidationPanelContent({ errors: [], warnings: [] });
            updateValidationStatus('Ready');
            return;
        }

        log('Validating HOF content...', { length: content.length });

        const payload = { content: content };
        const response = await fetch(`${CONFIG.API_BASE_URL}/hof/validate-content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || `HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        log('HOF validation result', {
            isValid: result.isValid,
            errors: result.errors?.length || 0,
            warnings: result.warnings?.length || 0
        });

        // ── Client-side supplement: [infosystem_busstop_list] count check ──
        // The backend may not implement this check.  We scan the content locally
        // and merge any missing STOP_COUNT_MISMATCH warnings into the result
        // so the Quick Fix light-bulb also fires for them.
        _mergeClientSideWarnings(content, result);

        applyMonacoMarkers(result);          // Monaco squiggles + gutter icons (model-bound)
        updateValidationPanelContent(result); // Validation panel list
        updateValidationSummary(result);      // Error/warning counters

        // Cache in active tab (restored when switching back to this tab)
        const activeTab = getActiveTab();
        if (activeTab) activeTab.validationResult = result;

        // Update status text (single authoritative call)
        const errorCount = result.errors?.length || 0;
        const warningCount = result.warnings?.length || 0;

        if (errorCount === 0 && warningCount === 0) {
            updateValidationStatus('Ready');
        } else if (errorCount > 0) {
            updateValidationStatus(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
        } else {
            updateValidationStatus(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
        }

    } catch (error) {
        log('Error validating HOF content:', error);

        updateValidationStatus('Validation failed');
        updateValidationCounters(0, 0);

        const errorList = document.getElementById('hof-validation-list');
        if (errorList) {
            errorList.innerHTML = `<div class="validation-error">Validation error: ${escapeHtml(error.message)}</div>`;
        }
    }
}

/**
 * 📋 Show validation error in panel
 */
function showValidationError(message) {
    const validationList = document.getElementById('hof-validation-list');
    if (!validationList) return;

    validationList.innerHTML = `<div class="validation-error">${escapeHtml(message)}</div>`;
    log('Validation error displayed:', message);
}

/**
 * 📋 Apply markers to Monaco editor
 */
function applyMonacoMarkers(validationResult) {
    if (!state.hof.editorInstance || state.hof.editorType !== 'monaco') {
        log('Monaco editor not available for markers');
        return;
    }

    const markers = [];

    // Process errors
    if (Array.isArray(validationResult.errors) && validationResult.errors.length > 0) {
        validationResult.errors.forEach(error => {
            if (error.line) {
                markers.push({
                    startLineNumber: error.line,
                    endLineNumber: error.line,
                    startColumn: 1,
                    endColumn: 999,
                    message: `[${error.code}] ${error.message}`,
                    severity: monaco.MarkerSeverity.Error,
                    code: error.code,
                    source: 'HOF Validator',
                    // Red lane in the scrollbar overview ruler
                    overviewRuler: { color: '#ff4757cc', position: monaco.editor.OverviewRulerLane.Right }
                });
            }
        });
    }

    // Process warnings
    if (Array.isArray(validationResult.warnings) && validationResult.warnings.length > 0) {
        validationResult.warnings.forEach(warning => {
            if (warning.line) {
                markers.push({
                    startLineNumber: warning.line,
                    endLineNumber: warning.line,
                    startColumn: 1,
                    endColumn: 999,
                    message: `[${warning.code}] ${warning.message}`,
                    severity: monaco.MarkerSeverity.Warning,
                    code: warning.code,
                    source: 'HOF Validator',
                    // Orange lane in the scrollbar overview ruler
                    overviewRuler: { color: '#ffa502cc', position: monaco.editor.OverviewRulerLane.Right }
                });
            }
        });
    }

    // Get model and set markers
    const model = state.hof.editorInstance.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'hof-validator', markers);
        log(`Applied ${markers.length} markers to editor`);
    }
}

/**
 * 📋 Update validation summary panel
 */
function updateValidationSummary(validationResult) {
    const errorsList = document.getElementById('hof-validation-list');
    if (!errorsList) return;

    const errors = validationResult.errors || [];
    const warnings = validationResult.warnings || [];
    const allIssues = [...errors, ...warnings];

    // Update counters
    updateValidationCounters(errors.length, warnings.length);

    // Update list
    errorsList.innerHTML = '';

    if (allIssues.length === 0) {
        errorsList.innerHTML = '<div class="validation-empty">✅ No issues found!</div>';
        return;
    }

    // Sort by line number
    allIssues.sort((a, b) => (a.line || 0) - (b.line || 0));

    allIssues.forEach(issue => {
        const isError = errors.includes(issue);
        const itemDiv = document.createElement('div');
        itemDiv.className = `validation-item ${isError ? 'error' : 'warning'}`;
        itemDiv.innerHTML = `
            <span class="validation-icon">${isError ? '❌' : '⚠️'}</span>
            <div class="validation-content">
                <span class="validation-line">Line ${issue.line || '?'}</span>
                <span class="validation-message">${escapeHtml(issue.message || 'Unknown issue')}</span>
                <span class="validation-code">${escapeHtml(issue.code || '')}</span>
            </div>
        `;

        // Click to jump to line
        itemDiv.addEventListener('click', () => {
            if (state.hof.editorInstance && issue.line) {
                state.hof.editorInstance.revealLineInCenter(issue.line);
                state.hof.editorInstance.setPosition({ lineNumber: issue.line, column: 1 });
                state.hof.editorInstance.focus();
                log(`Jumped to line ${issue.line}`);
            }
        });

        errorsList.appendChild(itemDiv);
    });
}

/**
 * 📋 Update validation counters
 */
function updateValidationCounters(errorCount, warningCount) {
    // Update error counter
    const errorCounter = document.getElementById('validation-errors-count');
    if (errorCounter) {
        const countValue = errorCounter.querySelector('.count-value');
        if (countValue) {
            countValue.textContent = errorCount;
            countValue.dataset.value = errorCount;
        }

        // Update class
        if (errorCount > 0) {
            errorCounter.classList.add('active');
        } else {
            errorCounter.classList.remove('active');
        }
    }

    // Update warning counter
    const warningCounter = document.getElementById('validation-warnings-count');
    if (warningCounter) {
        const countValue = warningCounter.querySelector('.count-value');
        if (countValue) {
            countValue.textContent = warningCount;
            countValue.dataset.value = warningCount;
        }

        // Update class
        if (warningCount > 0) {
            warningCounter.classList.add('active');
        } else {
            warningCounter.classList.remove('active');
        }
    }

    log(`Validation counters updated: ${errorCount} errors, ${warningCount} warnings`);
}

/**
 * 📋 Clear validation markers
 */
function clearHofValidationMarkers() {
    if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
        const model = state.hof.editorInstance.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, 'hof-validator', []);
            log('Cleared validation markers');
        }
    }

    // Clear validation panel
    const validationList = document.getElementById('hof-validation-list');
    if (validationList) {
        validationList.innerHTML = '<div class="validation-empty">✅ Ready</div>';
    }

    // Reset counters
    updateValidationCounters(0, 0);
}

/**
 * 📋 Initialize validation panel with collapse/resize
 */
function initializeValidationPanel() {
    const panel = document.getElementById('hof-validation-panel');
    const collapseBtn = document.querySelector('.validation-collapse-btn');
    const resizeHandle = document.querySelector('.validation-resize-handle');

    if (!panel) {
        log('Validation panel not found');
        return;
    }

    // ── Restore persisted height from previous session ────────────────────
    try {
        const saved = localStorage.getItem('hof_validation_height');
        if (saved) {
            const h = parseInt(saved, 10);
            if (h >= state.hof.validationState.minHeight &&
                h <= state.hof.validationState.maxHeight) {
                panel.style.height = `${h}px`;
                state.hof.validationState.panelHeight = h;
            }
        }
    } catch (_) { /* ignore — localStorage may be unavailable */ }

    // ── Restore persisted collapse state ──────────────────────────────────
    try {
        const wasCollapsed = localStorage.getItem('hof_validation_collapsed') === 'true';
        if (wasCollapsed) {
            panel.classList.add('collapsed');
            panel.style.height = '40px';
            state.hof.validationState.isCollapsed = true;
            const collapseBtn = document.querySelector('.validation-collapse-btn');
            if (collapseBtn) collapseBtn.classList.add('collapsed');
        }
    } catch (_) {}

    // Collapse/Expand button
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleValidationPanelCollapse();
        });
    }

    // Resize handle - drag to resize
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            state.hof.validationState.isDragging = true;
            state.hof.validationState.dragStartY = e.clientY;
            state.hof.validationState.dragStartHeight = panel.offsetHeight;

            resizeHandle.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'ns-resize';

            log('Validation panel resize started');

            const onMouseMove = (moveEvent) => {
                if (!state.hof.validationState.isDragging) return;

                const deltaY = moveEvent.clientY - state.hof.validationState.dragStartY;
                const newHeight = Math.max(
                    state.hof.validationState.minHeight,
                    Math.min(
                        state.hof.validationState.maxHeight,
                        state.hof.validationState.dragStartHeight - deltaY
                    )
                );

                panel.style.height = `${newHeight}px`;
                state.hof.validationState.panelHeight = newHeight;

                if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
                    try { state.hof.editorInstance.layout(); } catch (_) {}
                }
            };

            const onMouseUp = () => {
                state.hof.validationState.isDragging = false;
                resizeHandle.classList.remove('dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';

                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // ── Persist the new height ───────────────────────────────
                try {
                    localStorage.setItem(
                        'hof_validation_height',
                        String(state.hof.validationState.panelHeight)
                    );
                } catch (_) {}

                if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
                    setTimeout(() => {
                        try { state.hof.editorInstance.layout(); } catch (_) {}
                    }, 50);
                }

                log('Validation panel resize ended - height: ' + panel.offsetHeight);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    log('Validation panel initialized with collapse/resize');
}

/**
 * 📋 Toggle validation panel collapse/expand
 */
function toggleValidationPanelCollapse() {
    const panel = document.getElementById('hof-validation-panel');
    const collapseBtn = document.querySelector('.validation-collapse-btn');

    if (!panel) return;

    const isCollapsed = panel.classList.contains('collapsed');

    if (isCollapsed) {
        // Expand
        panel.classList.remove('collapsed');
        panel.style.height = `${state.hof.validationState.panelHeight}px`;
        if (collapseBtn) {
            collapseBtn.classList.remove('collapsed');
        }
        log('Validation panel expanded');
    } else {
        // Collapse
        panel.classList.add('collapsed');
        panel.style.height = '40px';
        if (collapseBtn) {
            collapseBtn.classList.add('collapsed');
        }
        log('Validation panel collapsed');
    }

    state.hof.validationState.isCollapsed = !isCollapsed;

    // Persist preference
    try {
        localStorage.setItem('hof_validation_collapsed', String(!isCollapsed));
    } catch (_) {}

    // Force editor layout recalculation
    if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
        setTimeout(() => {
            try {
                state.hof.editorInstance.layout();
                log('Monaco layout recalculated after panel toggle');
            } catch (e) {
                log('Layout recalculation error after panel toggle');
            }
        }, 250);  // Match CSS transition
    }
}

/**
 * ============================================
 * VALIDATION DIAGNOSTICS
 * ============================================
 */

/**
 * 📋 Apply validation diagnostics as Monaco markers
 */
function applyValidationDiagnostics(validationResult) {
    if (!state.hof.editorInstance || state.hof.editorType !== 'monaco') {
        log('Monaco editor not available for diagnostics');
        return;
    }

    const markers = [];

    // Process errors
    if (Array.isArray(validationResult.errors) && validationResult.errors.length > 0) {
        validationResult.errors.forEach((error, idx) => {
            if (typeof error.line === 'number' && error.line > 0) {
                // Get line length for column range
                const model = state.hof.editorInstance.getModel();
                const lineContent = model?.getLineContent(error.line) || '';
                const endColumn = lineContent.length + 1;

                markers.push({
                    startLineNumber: error.line,
                    endLineNumber: error.line,
                    startColumn: 1,
                    endColumn: Math.max(2, endColumn),
                    message: `[${error.code || 'ERROR'}] ${error.message || 'Unknown error'}`,
                    severity: monaco.MarkerSeverity.Error,
                    code: error.code || 'ERR',
                    source: 'HOF Validator',
                    relatedInformation: error.relatedInformation || []
                });
            }
        });
    }

    // Process warnings
    if (Array.isArray(validationResult.warnings) && validationResult.warnings.length > 0) {
        validationResult.warnings.forEach((warning, idx) => {
            if (typeof warning.line === 'number' && warning.line > 0) {
                // Get line length for column range
                const model = state.hof.editorInstance.getModel();
                const lineContent = model?.getLineContent(warning.line) || '';
                const endColumn = lineContent.length + 1;

                markers.push({
                    startLineNumber: warning.line,
                    endLineNumber: warning.line,
                    startColumn: 1,
                    endColumn: Math.max(2, endColumn),
                    message: `[${warning.code || 'WARN'}] ${warning.message || 'Unknown warning'}`,
                    severity: monaco.MarkerSeverity.Warning,
                    code: warning.code || 'WARN',
                    source: 'HOF Validator',
                    relatedInformation: warning.relatedInformation || []
                });
            }
        });
    }

    // Apply markers to model
    const model = state.hof.editorInstance.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'hof-validator', markers);
        log(`Applied ${markers.length} diagnostic markers`);
    }
}

/**
 * 📋 Update validation panel with errors/warnings
 */
function updateValidationPanelContent(validationResult) {
    const validationList = document.getElementById('hof-validation-list');
    if (!validationList) return;

    const errors = validationResult.errors || [];
    const warnings = validationResult.warnings || [];
    const allIssues = [...errors, ...warnings];

    // Update counters
    updateValidationCounters(errors.length, warnings.length);

    // Clear list
    validationList.innerHTML = '';

    // Show success if no issues
    if (allIssues.length === 0) {
        validationList.innerHTML = '<div class="validation-empty">✅ No issues found</div>';
        updateValidationStatus('Ready');
        return;
    }

    // Sort by line number
    allIssues.sort((a, b) => (a.line || 0) - (b.line || 0));

    allIssues.slice(0, 50).forEach(issue => {
        const isError = errors.includes(issue);
        const itemDiv = document.createElement('div');
        itemDiv.className = `validation-item ${isError ? 'error' : 'warning'}`;

        itemDiv.innerHTML = `
            <span class="validation-icon">${isError ? '❌' : '⚠️'}</span>
            <div class="validation-content">
                <span class="validation-line">Line ${issue.line || '?'}</span>
                <span class="validation-message">${escapeHtml(issue.message || 'Unknown issue')}</span>
                ${issue.code ? `<span class="validation-code">[${escapeHtml(issue.code)}]</span>` : ''}
            </div>
        `;

        // Click to navigate
        itemDiv.addEventListener('click', () => {
            if (state.hof.editorInstance && typeof issue.line === 'number') {
                state.hof.editorInstance.revealLineInCenter(issue.line);
                state.hof.editorInstance.setPosition({
                    lineNumber: issue.line,
                    column: 1
                });
                state.hof.editorInstance.focus();
                log(`Navigated to validation issue at line ${issue.line}`);
            }
        });

        validationList.appendChild(itemDiv);
    });

    // Show if there are more
    if (allIssues.length > 50) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'validation-item';
        moreDiv.style.textAlign = 'center';
        moreDiv.style.color = '#999';
        moreDiv.textContent = `... and ${allIssues.length - 50} more issues`;
        validationList.appendChild(moreDiv);
    }
}

/**
 * 📋 Update validation status text
 */
function updateValidationStatus(status) {
    const statusEl = document.getElementById('validation-status');
    if (statusEl) {
        statusEl.textContent = status;
    }
}

/**
 * 📋 Clear all validation
 */
function clearHofValidation() {
    if (validationTimeout) {
        clearTimeout(validationTimeout);
        validationTimeout = null;
    }

    // Clear Monaco markers
    if (state.hof.editorInstance && state.hof.editorType === 'monaco') {
        const model = state.hof.editorInstance.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, 'hof-validator', []);
            log('Cleared validation markers');
        }
    }

    // Clear panel
    const validationList = document.getElementById('hof-validation-list');
    if (validationList) {
        validationList.innerHTML = '<div class="validation-empty">✅ Ready</div>';
    }

    // Reset counters
    updateValidationCounters(0, 0);
    updateValidationStatus('Ready');

    log('Validation cleared');
}

/**
 * 🟢 Show parse result summary in the persistent output strip
 * above the validation list. Stays visible until dismissed or
 * overwritten by the next Save & Parse.
 */
function _showParseOutput(summary) {
    const strip = document.getElementById('hof-parse-output');
    if (!strip) return;

    strip.innerHTML =
        `<span class="hof-parse-output__icon" aria-hidden="true">⚙</span>` +
        `<span class="hof-parse-output__text" title="${escapeHtml(summary)}">` +
            `Parse: ${escapeHtml(summary)}` +
        `</span>` +
        `<button class="hof-parse-output__dismiss" title="Dismiss" type="button" aria-label="Dismiss parse output">✕</button>`;

    strip.hidden = false;

    strip.querySelector('.hof-parse-output__dismiss').addEventListener('click', () => {
        strip.hidden = true;
        strip.innerHTML = '';
    });
}


/* ============================================
 * ⚙ INSTANCE MANAGER
 * ============================================
 *
 * Displays a real-time view of all OMSI instances managed
 * by the backend (GET /api/instances).
 *
 * Fields per instance:
 *   name, map, region, status, port, pid,
 *   players, maxPlayers, cpuPercent, ramMb,
 *   uptime, lastHeartbeat
 *
 * Status colour coding:
 *   running  → green
 *   starting → orange
 *   stopped  → grey
 *   crashed  → red
 *
 * Completely isolated from all other modules.
 * All selectors are prefixed .instance-* or #instance*.
 * ============================================ */

/* ─── Constants ──────────────────────────────────────────────── */
const INSTANCE_REFRESH_MS = 5000;

const INSTANCE_STATUS_META = {
    running:  { label: '● Running',  cssClass: 'running',  icon: '🟢' },
    starting: { label: '● Starting', cssClass: 'starting', icon: '🟡' },
    stopped:  { label: '● Stopped',  cssClass: 'stopped',  icon: '⚫' },
    crashed:  { label: '● Crashed',  cssClass: 'crashed',  icon: '🔴' }
};

/* ─── Data fetching ──────────────────────────────────────────── */

/**
 * Fetch the list of OMSI instances from the backend.
 * Endpoint: GET /api/instances
 * Gracefully handles missing endpoint (404 / network error).
 */
async function fetchInstances() {
    if (state.instances.isLoading) return;
    state.instances.isLoading = true;

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/servers/instances`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} — ${response.statusText}`);
        }

        const data = await response.json();

        const prevList = state.instances.list;
        const newList  = Array.isArray(data) ? data : (data.instances || []);

        // ── Detect status transitions → emit events ───────────────
        newList.forEach(inst => {
            const prev = prevList.find(p => p.id === inst.id);
            const prevStatus = (prev?.status || '').toLowerCase();
            const newStatus  = (inst.status   || '').toLowerCase();

            if (prev && prevStatus !== newStatus) {
                const typeMap = {
                    running:  'Start',
                    stopped:  'Stop',
                    crashed:  'Crash',
                    starting: 'Starting'
                };
                _addInstanceEvent(
                    typeMap[newStatus] || newStatus,
                    inst.id,
                    inst.name || inst.id,
                    newStatus === 'crashed'
                        ? `Crashed — last heartbeat: ${inst.lastHeartbeat ? _formatHeartbeat(inst.lastHeartbeat) : 'unknown'}`
                        : `Status changed: ${prevStatus} → ${newStatus}`
                );
            }
        });

        state.instances.list      = newList;
        state.instances.lastError = null;
        state.instances.lastFetchAt = new Date();

        log(`Instance Manager: fetched ${state.instances.list.length} instance(s)`);
    } catch (err) {
        state.instances.lastError = err.message;
        log('Instance Manager: fetch error —', err.message);
    } finally {
        state.instances.isLoading = false;
        renderInstances();
    }
}

/* ─── Rendering ──────────────────────────────────────────────── */

/**
 * Filter state.instances.list by current search query and status filter,
 * then render cards into #instances-container.
 */
function renderInstances() {
    const container = document.getElementById('instances-container');
    if (!container) return;

    /* Status bar update */
    _updateInstanceStatusBar();

    const { list, lastError, isLoading, searchQuery, statusFilter } = state.instances;

    /* Loading state */
    if (isLoading && list.length === 0) {
        container.innerHTML = `
            <div class="instance-loading">
                <span class="instance-loading-icon spinning">⚙</span>
                Loading instances…
            </div>`;
        return;
    }

    /* Network / API error */
    if (lastError && list.length === 0) {
        container.innerHTML = `
            <div class="instance-empty">
                <div class="instance-empty-icon">⚠</div>
                <div class="instance-empty-title">Unable to reach Instance Manager</div>
                <div class="instance-empty-sub">${escapeHtml(lastError)}</div>
            </div>`;
        return;
    }

    /* Apply search + status filter */
    const q   = (searchQuery || '').toLowerCase().trim();
    const sf  = (statusFilter || '').toLowerCase().trim();

    const filtered = list.filter(inst => {
        const statusKey = (inst.status || 'stopped').toLowerCase();
        if (sf && statusKey !== sf) return false;
        if (q) {
            const haystack = [
                inst.name      || '',
                inst.mapName   || '',
                inst.region    || '',
                String(inst.port        || ''),
                String(inst.processId   || '')
            ].join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    /* Empty state */
    if (filtered.length === 0) {
        const reason = q || sf ? 'No instances match your filter.' : 'No instances registered.';
        container.innerHTML = `
            <div class="instance-empty">
                <div class="instance-empty-icon">⚙</div>
                <div class="instance-empty-title">${reason}</div>
            </div>`;
        return;
    }

    /* Build cards */
    container.innerHTML = '';
    filtered.forEach(inst => {
        container.appendChild(_buildInstanceCard(inst));
    });
}

/**
 * Build a single instance card DOM element.
 * Uses only escapeHtml() for user-facing data — no XSS risk.
 */
function _buildInstanceCard(inst) {
    const statusKey  = (inst.status || 'stopped').toLowerCase();
    const statusMeta = INSTANCE_STATUS_META[statusKey] || INSTANCE_STATUS_META.stopped;
    const isCrashed  = statusKey === 'crashed';
    const isStopped  = statusKey === 'stopped';
    const isRunning  = statusKey === 'running';

    /* CPU */
    const cpu    = inst.cpuUsage ?? null;
    const cpuStr = cpu != null ? `${Number(cpu).toFixed(1)} %` : 'N/A';
    const cpuCls = cpu == null ? '' : cpu >= 80 ? 'instance-metric--danger' : cpu >= 50 ? 'instance-metric--warn' : 'instance-metric--ok';

    /* Players */
    const players    = inst.connectedPlayers ?? 0;
    const maxPlayers = inst.maxPlayers ?? 0;
    const playersCls = maxPlayers > 0 && players >= maxPlayers ? 'instance-metric--danger' : '';

    /* Uptime (current session) */
    const uptimeStr = inst.startedAt ? _formatUptimeFromStart(inst.startedAt) : 'N/A';

    /* Advanced uptime fields (backend may or may not supply these) */
    const totalUptimeStr   = inst.totalUptime  != null ? _formatUptime(inst.totalUptime)  : '—';
    const restartCount     = inst.restartCount ?? inst.restartCount ?? '—';

    /* Heartbeat */
    const hbStr = inst.lastHeartbeat ? _formatHeartbeat(inst.lastHeartbeat) : 'N/A';

    /* Crash info */
    const crashedAtStr = isCrashed && inst.lastHeartbeat
        ? new Date(inst.lastHeartbeat).toLocaleTimeString()
        : null;

    /* Auto-restart state (local optimistic) */
    const autoRestart = state.instances.autoRestartMap[inst.id] ?? (inst.autoRestart ?? false);

    const card = document.createElement('div');
    card.className = `instance-card instance-card--${statusMeta.cssClass}`;
    card.dataset.instanceId = String(inst.id || '');

    card.innerHTML = `
        <!-- ── Header ── -->
        <div class="instance-card-header">
            <div class="instance-card-identity">
                <span class="instance-name">${escapeHtml(inst.name || 'Unnamed')}</span>
                ${inst.region ? `<span class="instance-region">${escapeHtml(inst.region)}</span>` : ''}
            </div>
            <span class="instance-status-badge instance-status-badge--${statusMeta.cssClass}">
                ${statusMeta.label}
            </span>
        </div>

        <!-- ── Crash alert ── -->
        ${isCrashed ? `
        <div class="instance-crash-alert">
            ⚠ Instance crashed${crashedAtStr ? ` at ${escapeHtml(crashedAtStr)}` : ''}.
            Use Restart to recover.
        </div>` : ''}

        <!-- ── Core metrics (4-col grid) ── -->
        <div class="instance-card-grid">
            <div class="instance-metric">
                <span class="instance-metric-label">Map</span>
                <span class="instance-metric-value">${escapeHtml(inst.mapName || 'N/A')}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">Port</span>
                <span class="instance-metric-value">${escapeHtml(String(inst.port || 'N/A'))}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">PID</span>
                <span class="instance-metric-value">${escapeHtml(String(inst.processId || 'N/A'))}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">Players</span>
                <span class="instance-metric-value ${playersCls}">
                    ${escapeHtml(String(players))} / ${escapeHtml(String(maxPlayers || '?'))}
                </span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">CPU</span>
                <span class="instance-metric-value ${cpuCls}">${cpuStr}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">RAM</span>
                <span class="instance-metric-value">${inst.memoryUsageMb != null ? `${inst.memoryUsageMb} MB` : 'N/A'}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">Uptime</span>
                <span class="instance-metric-value">${uptimeStr}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">Heartbeat</span>
                <span class="instance-metric-value">${hbStr}</span>
            </div>
        </div>

        <!-- ── Advanced uptime (separator) ── -->
        <div class="instance-advanced-metrics">
            <div class="instance-metric">
                <span class="instance-metric-label">Total Uptime</span>
                <span class="instance-metric-value">${totalUptimeStr}</span>
            </div>
            <div class="instance-metric">
                <span class="instance-metric-label">Restarts</span>
                <span class="instance-metric-value">${escapeHtml(String(restartCount))}</span>
            </div>
        </div>

        <!-- ── Card footer: actions ── -->
        <div class="instance-card-footer">
            <button class="instance-restart-btn${isCrashed ? ' instance-restart-btn--urgent' : ''}"
                    data-id="${escapeHtml(String(inst.id || ''))}"
                    data-name="${escapeHtml(inst.name || '')}"
                    type="button"
                    ${isStopped ? '' : ''}>
                🔄 Restart
            </button>

            <label class="instance-auto-restart-switch" title="Auto-restart on crash">
                <input type="checkbox"
                       class="instance-auto-restart-cb"
                       data-id="${escapeHtml(String(inst.id || ''))}"
                       ${autoRestart ? 'checked' : ''} />
                <span class="instance-auto-restart-track"></span>
                <span class="instance-auto-restart-label">Auto-restart</span>
            </label>
        </div>
    `;

    /* Wire restart button */
    card.querySelector('.instance-restart-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await _restartInstance(inst.id, inst.name || inst.id);
    });

    /* Wire auto-restart toggle */
    card.querySelector('.instance-auto-restart-cb').addEventListener('change', async (e) => {
        await _toggleAutoRestart(inst.id, inst.name || inst.id, e.target.checked);
    });

    return card;
}

/* ─── Instance actions ───────────────────────────────────────── */

/**
 * Restart an instance via POST /api/servers/{id}/restart.
 * Shows _confirm() dialog first, then calls the API.
 */
async function _restartInstance(instanceId, instanceName) {
    const ok = await _confirm(
        `🔄 Restart "${escapeHtml(instanceName)}"?`,
        'The instance will be stopped and restarted immediately.<br>Connected players will be disconnected.',
        'Restart',
        true
    );
    if (!ok) return;

    _addInstanceEvent('Restart', instanceId, instanceName, 'Restart requested by user');

    try {
        const response = await fetch(
            `${CONFIG.API_BASE_URL}/servers/${encodeURIComponent(instanceId)}/restart`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        );

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${response.status}`);
        }

        showToast(`✓ Instance "${instanceName}" restarting…`, 'success');
        _addInstanceEvent('Restart', instanceId, instanceName, 'Restart command accepted');
        log(`Instance Manager: restart OK — ${instanceName}`);

        // Refresh after short delay to let the backend process the restart
        setTimeout(() => fetchInstances(), 1500);

    } catch (err) {
        showToast(`⚠ Restart failed: ${err.message}`, 'error');
        _addInstanceEvent('Restart', instanceId, instanceName, `Failed: ${err.message}`);
        log('Instance Manager: restart error —', err.message);
    }
}

/**
 * Toggle auto-restart flag for an instance.
 * API: POST /api/servers/{id}/auto-restart  { enabled: bool }
 * Falls back gracefully if endpoint doesn't exist.
 */
async function _toggleAutoRestart(instanceId, instanceName, enabled) {
    // Optimistic update — reflect immediately in UI
    state.instances.autoRestartMap[instanceId] = enabled;

    _addInstanceEvent(
        'Config',
        instanceId,
        instanceName,
        `Auto-restart ${enabled ? 'enabled' : 'disabled'}`
    );

    try {
        const response = await fetch(
            `${CONFIG.API_BASE_URL}/servers/${encodeURIComponent(instanceId)}/auto-restart`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ enabled })
            }
        );

        if (!response.ok) {
            // Revert optimistic update if API fails
            state.instances.autoRestartMap[instanceId] = !enabled;
            renderInstances();
            const err = await response.json().catch(() => ({}));
            showToast(`⚠ Auto-restart toggle failed: ${err.message || `HTTP ${response.status}`}`, 'warn');
        } else {
            showToast(`Auto-restart ${enabled ? 'ON' : 'OFF'} for "${instanceName}"`, 'info');
        }
    } catch (err) {
        // Network error — revert
        state.instances.autoRestartMap[instanceId] = !enabled;
        renderInstances();
        showToast(`⚠ Auto-restart toggle failed: ${err.message}`, 'warn');
        log('Instance Manager: auto-restart toggle error —', err.message);
    }
}

/* ─── Event log ──────────────────────────────────────────────── */

/**
 * Add an event to the instance event log and refresh the panel.
 * Events are kept in memory (state.instances.events), newest first.
 * Max 200 events retained.
 */
function _addInstanceEvent(type, instanceId, instanceName, detail = '') {
    const EVENT_ICONS = {
        Start:    '🟢',
        Stop:     '⚫',
        Restart:  '🔄',
        Crash:    '🔴',
        Starting: '🟡',
        Config:   '⚙'
    };

    state.instances.events.unshift({
        type,
        instanceId,
        name:   instanceName,
        detail,
        ts:     new Date(),
        icon:   EVENT_ICONS[type] || '•'
    });

    // Cap at 200 events
    if (state.instances.events.length > 200) {
        state.instances.events.length = 200;
    }

    renderEventPanel();
}

/**
 * Re-render the events panel with current state.instances.events.
 */
function renderEventPanel() {
    const list = document.getElementById('instance-events-list');
    if (!list) return;

    if (state.instances.events.length === 0) {
        list.innerHTML = '<div class="instance-events-empty">No events yet.</div>';
        return;
    }

    list.innerHTML = state.instances.events.map(ev => {
        const timeStr = ev.ts.toLocaleTimeString();
        const isCrash = ev.type === 'Crash';
        return `
            <div class="instance-event-item${isCrash ? ' instance-event-item--crash' : ''}">
                <span class="instance-event-icon">${ev.icon}</span>
                <div class="instance-event-body">
                    <div class="instance-event-header">
                        <span class="instance-event-type">${escapeHtml(ev.type)}</span>
                        <span class="instance-event-name">${escapeHtml(ev.name)}</span>
                        <span class="instance-event-time">${timeStr}</span>
                    </div>
                    ${ev.detail ? `<div class="instance-event-detail">${escapeHtml(ev.detail)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/* ─── Status bar ─────────────────────────────────────────────── */

function _updateInstanceStatusBar() {
    const summaryEl   = document.getElementById('instance-count-summary');
    const lastUpdEl   = document.getElementById('instance-last-update');

    if (!summaryEl) return;

    const list = state.instances.list;
    if (list.length === 0) {
        summaryEl.textContent = '—';
    } else {
        const counts = { running: 0, starting: 0, stopped: 0, crashed: 0 };
        list.forEach(i => {
            const k = (i.status || 'stopped').toLowerCase();
            if (k in counts) counts[k]++;
        });

        const parts = [];
        if (counts.running)  parts.push(`🟢 ${counts.running} running`);
        if (counts.starting) parts.push(`🟡 ${counts.starting} starting`);
        if (counts.crashed)  parts.push(`🔴 ${counts.crashed} crashed`);
        if (counts.stopped)  parts.push(`⚫ ${counts.stopped} stopped`);
        summaryEl.textContent = parts.join('  ·  ') || '—';
    }

    if (lastUpdEl && state.instances.lastFetchAt) {
        lastUpdEl.textContent = `Updated ${state.instances.lastFetchAt.toLocaleTimeString()}`;
    }
}

/* ─── Utilities ──────────────────────────────────────────────── */

/**
 * Compute uptime from a startedAt ISO timestamp string.
 * e.g. "2026-06-02T21:53:13.518123" → "8m 54s"
 */
function _formatUptimeFromStart(startedAt) {
    try {
        const start   = Date.parse(startedAt);
        if (isNaN(start)) return 'N/A';
        const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0)  return `${h}h ${m}m`;
        if (m > 0)  return `${m}m ${s}s`;
        return `${s}s`;
    } catch {
        return 'N/A';
    }
}

/**
 * Format an uptime value (seconds integer or ISO duration string)
 * into a human-readable string like "2h 14m" or "45s".
 */
function _formatUptime(uptime) {
    if (uptime == null) return 'N/A';

    let seconds;
    if (typeof uptime === 'number') {
        seconds = Math.floor(uptime);
    } else if (typeof uptime === 'string') {
        // Try parsing ISO 8601 duration or plain seconds string
        const match = uptime.match(/^PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
        if (match) {
            seconds = (parseInt(match[1] || 0) * 3600) +
                      (parseInt(match[2] || 0) * 60)   +
                      Math.floor(parseFloat(match[3] || 0));
        } else {
            const parsed = parseInt(uptime, 10);
            seconds = isNaN(parsed) ? null : parsed;
        }
    }

    if (seconds == null || isNaN(seconds)) return String(uptime);

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0)  return `${h}h ${m}m`;
    if (m > 0)  return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Format a heartbeat timestamp (ISO string or epoch ms) as a relative time.
 * e.g. "3s ago", "2m ago", "just now"
 */
function _formatHeartbeat(hb) {
    try {
        const ts   = typeof hb === 'number' ? hb : Date.parse(hb);
        if (isNaN(ts)) return String(hb);
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 5)   return 'just now';
        if (diff < 60)  return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    } catch {
        return String(hb);
    }
}

/* ─── Auto-refresh ───────────────────────────────────────────── */

function startInstanceAutoRefresh() {
    // Initial fetch
    fetchInstances();

    state.instances.refreshInterval = setInterval(() => {
        if (document.hidden) return;   // Page Visibility API — pause when tab not visible
        fetchInstances();
    }, INSTANCE_REFRESH_MS);

    log(`Instance Manager: auto-refresh every ${INSTANCE_REFRESH_MS}ms`);
}

function stopInstanceAutoRefresh() {
    if (state.instances.refreshInterval) {
        clearInterval(state.instances.refreshInterval);
        state.instances.refreshInterval = null;
        log('Instance Manager: auto-refresh stopped');
    }
}

/* ─── Module setup ───────────────────────────────────────────── */

function setupInstanceModule() {
    // Refresh button
    const refreshBtn = document.getElementById('instance-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳ Refreshing…';
            fetchInstances().finally(() => {
                refreshBtn.disabled   = false;
                refreshBtn.textContent = '🔄 Refresh';
            });
        });
    }

    // Search input — DOM-only filter (no re-fetch)
    const searchInput = document.getElementById('instance-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.instances.searchQuery = e.target.value;
            renderInstances();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                state.instances.searchQuery = '';
                renderInstances();
                searchInput.blur();
            }
        });
    }

    // Status filter dropdown
    const statusFilter = document.getElementById('instance-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            state.instances.statusFilter = e.target.value;
            renderInstances();
        });
    }

    // Events panel clear button
    const clearEventsBtn = document.getElementById('instance-events-clear');
    if (clearEventsBtn) {
        clearEventsBtn.addEventListener('click', () => {
            state.instances.events = [];
            renderEventPanel();
        });
    }

    log('Instance Manager: module initialized');
}

/* ============================================
 * END OF INSTANCE MANAGER
 * ============================================ */
