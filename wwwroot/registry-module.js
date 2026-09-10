/**
 * ═══════════════════════════════════════════════════════════════════
 * REGISTRY MODULE — Serveurs enregistrés (heartbeat)
 * ═══════════════════════════════════════════════════════════════════
 * Affiche l'état de TOUS les serveurs de map connus du registre
 * (GET /api/registry), qu'ils tournent sur le Pi, sur un PC distant
 * ou n'importe où sur le tailnet — contrairement à "Running Servers"
 * qui ne voit que les process pilotés localement par le Pi.
 *
 * INSTALLATION (2 gestes) :
 * 1. Dans index.html, à l'intérieur de <div id="tab-servers">, sous la
 *    section "Running Servers", ajouter :  <div id="registry-root"></div>
 * 2. Charger ce fichier APRÈS script.js :
 *    <script src="registry-module.js"></script>
 *
 * Réutilise les classes CSS existantes du dashboard (server-card,
 * detail-item, ...) pour hériter du style automatiquement.
 * Dépend de CONFIG.API_BASE_URL et escapeHtml() définis dans script.js.
 */

(function () {
    'use strict';

    const POLL_INTERVAL_MS = 10000;

    const registryState = {
        servers: [],
        lastError: null,
        timer: null
    };

    /* ─── Fetch ──────────────────────────────────────────────────── */

    async function fetchRegistry() {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/registry`);

            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            registryState.servers = Array.isArray(data) ? data : [];
            window.__registryServers = registryState.servers;
            registryState.lastError = null;
        } catch (err) {
            registryState.lastError = err.message;
        }

        renderRegistry();
    }

    /* ─── IP override ────────────────────────────────────────────── */

    async function applyIpOverride(name, ip) {
        try {
            const response = await fetch(
                `${CONFIG.API_BASE_URL}/registry/${encodeURIComponent(name)}/ip-override`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip: ip || null })
                });

            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);

            await fetchRegistry();
        } catch (err) {
            alert(`Échec de l'override IP : ${err.message}`);
        }
    }

    /* ─── Rendering ──────────────────────────────────────────────── */

    function formatAge(seconds) {
        if (seconds < 0) return '—';
        if (seconds < 60) return `il y a ${seconds}s`;
        if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
        if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`;
        return `il y a ${Math.floor(seconds / 86400)} j`;
    }

    function renderRegistry() {
        const root = document.getElementById('registry-root');
        if (!root) return;

        let html = `
            <div class="section-header" style="margin-top: 24px;">
                <h2>🌐 Registered Servers <span style="font-size:0.6em;opacity:0.6;">(heartbeat)</span></h2>
            </div>
        `;

        if (registryState.lastError && registryState.servers.length === 0) {
            html += `<div class="error-message">Registre injoignable : ${escapeHtml(registryState.lastError)}</div>`;
            root.innerHTML = html;
            return;
        }

        if (registryState.servers.length === 0) {
            html += `
                <div class="empty-state">
                    <div class="empty-state-icon">🌐</div>
                    <div class="empty-state-text">Aucun serveur enregistré</div>
                    <div class="empty-state-subtext">Un serveur de map apparaît ici dès son premier heartbeat</div>
                </div>
            `;
            root.innerHTML = html;
            return;
        }

        html += '<div class="servers-container">';

        registryState.servers.forEach(s => {
            const online = !!s.online;
            const statusClass = online ? '' : 'stopped';
            const statusText = online ? '● Online' : '● Offline';
            const overridden = !!s.manualIpOverride;

            html += `
                <div class="server-card ${online ? 'running' : 'stopped'}">
                    <div class="server-card-header">
                        <span class="server-name">${escapeHtml(s.name)}</span>
                        <span class="server-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="server-details">
                        <div class="detail-item">
                            <span class="detail-label">Adresse</span>
                            <span class="detail-value">${escapeHtml(s.ip || '—')}:${s.port || '—'}${overridden ? ' ✏️' : ''}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Machine</span>
                            <span class="detail-value">${escapeHtml(s.hostMachine || '—')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Joueurs</span>
                            <span class="detail-value">${s.playersOnline ?? 0}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Heartbeat</span>
                            <span class="detail-value">${formatAge(s.secondsSinceHeartbeat)}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
                        <input type="text"
                               id="override-${escapeHtml(s.name)}"
                               placeholder="${overridden ? escapeHtml(s.manualIpOverride) : 'Override IP (vide = auto)'}"
                               style="flex:1; padding:6px 10px; border-radius:6px;
                                      border:1px solid rgba(255,255,255,0.15);
                                      background:rgba(255,255,255,0.05); color:inherit;" />
                        <button class="btn-registry-override" data-name="${escapeHtml(s.name)}"
                                style="padding:6px 14px; border-radius:6px; cursor:pointer;
                                       border:1px solid rgba(255,255,255,0.2);
                                       background:rgba(255,255,255,0.08); color:inherit;">
                            Appliquer
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        root.innerHTML = html;

        // Bind override buttons (délégation simple après re-render)
        root.querySelectorAll('.btn-registry-override').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.name;
                const input = document.getElementById(`override-${name}`);
                applyIpOverride(name, input ? input.value.trim() : '');
            });
        });
    }

    /* ─── Boot ───────────────────────────────────────────────────── */

    function start() {
        if (!document.getElementById('registry-root')) {
            console.warn('[registry-module] #registry-root introuvable — ajoute <div id="registry-root"></div> dans #tab-servers.');
            return;
        }
        fetchRegistry();
        if (typeof updateStats === 'function') updateStats();
        registryState.timer = setInterval(fetchRegistry, POLL_INTERVAL_MS);
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start);
    else
        start();
})();
