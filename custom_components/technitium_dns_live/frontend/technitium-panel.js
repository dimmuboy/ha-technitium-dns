class TechnitiumDnsLivePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._entries = [];
    this._filter = "";
    this._limit = 50;
    this._manualDomain = "";
    this._status = "";
    this._activeTab = "live";
    this._autoRefresh = true;
    this._visible = true;
    this._liveLoading = false;
    this._stateLoading = false;
    this._statsLoading = false;
    this._liveTimer = null;
    this._stateTimer = null;
    this._statsTimer = null;
    this._blockingState = {
      enabled: null,
      temporary_disable_until: null,
    };
    this._statsType = "LastDay";
    this._stats = null;
    this._statsStatus = "";

    this._onVisibilityChange = () => {
      this._visible = document.visibilityState === "visible";
      this._updatePolling();
    };
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._initialized) {
      this._renderShell();
    }

    this._updatePolling();
  }

  set panel(panel) {
    this._panel = panel;
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    this._observer = new IntersectionObserver((entries) => {
      this._visible =
        document.visibilityState === "visible" &&
        entries.some((entry) => entry.isIntersecting);
      this._updatePolling();
    });

    this._observer.observe(this);

    if (!this._initialized) {
      this._renderShell();
    }
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisibilityChange);

    if (this._observer) {
      this._observer.disconnect();
    }

    this._stopAllPolling();
  }

  _updatePolling() {
    if (!this.isConnected || !this._visible || !this._hass) {
      this._stopAllPolling();
      return;
    }

    this._startStatePolling();

    if (this._activeTab === "live") {
      this._stopStatsPolling();

      if (this._autoRefresh) {
        this._startLivePolling();
      } else {
        this._stopLivePolling();
      }
    } else {
      this._stopLivePolling();
      this._startStatsPolling();
    }
  }

  _startLivePolling() {
    if (this._liveTimer) {
      return;
    }

    this._refreshLive();
    this._liveTimer = window.setInterval(() => this._refreshLive(), 2000);
  }

  _stopLivePolling() {
    if (this._liveTimer) {
      window.clearInterval(this._liveTimer);
      this._liveTimer = null;
    }
  }

  _startStatePolling() {
    if (this._stateTimer) {
      return;
    }

    this._refreshBlockingState();
    this._stateTimer = window.setInterval(
      () => this._refreshBlockingState(),
      2000,
    );
  }

  _stopStatePolling() {
    if (this._stateTimer) {
      window.clearInterval(this._stateTimer);
      this._stateTimer = null;
    }
  }

  _startStatsPolling() {
    if (this._statsTimer) {
      return;
    }

    this._refreshStats();
    this._statsTimer = window.setInterval(() => this._refreshStats(), 30000);
  }

  _stopStatsPolling() {
    if (this._statsTimer) {
      window.clearInterval(this._statsTimer);
      this._statsTimer = null;
    }
  }

  _stopAllPolling() {
    this._stopLivePolling();
    this._stopStatePolling();
    this._stopStatsPolling();
  }

  async _refreshLive() {
    if (!this._hass || this._liveLoading) {
      return;
    }

    this._liveLoading = true;

    try {
      const request = {
        type: "technitium_dns_live/query",
        limit: this._limit,
      };

      if (this._filter) {
        request.response_type = this._filter;
      }

      const result = await this._hass.callWS(request);
      this._entries = result.entries || [];
      this._status = "";
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
    } finally {
      this._liveLoading = false;
      this._renderLiveData();
    }
  }

  async _refreshBlockingState() {
    if (!this._hass || this._stateLoading) {
      return;
    }

    this._stateLoading = true;

    try {
      this._blockingState = await this._hass.callWS({
        type: "technitium_dns_live/blocking_state",
      });
    } catch (error) {
      this._status = `Blocking state error: ${error?.message || error}`;
    } finally {
      this._stateLoading = false;
      this._renderBlockingState();
    }
  }

  async _setBlocking(enabled) {
    const checkbox = this.shadowRoot.querySelector("#blocking-enabled");
    if (checkbox) {
      checkbox.disabled = true;
    }

    try {
      this._blockingState = await this._hass.callWS({
        type: "technitium_dns_live/set_blocking",
        enabled,
      });
      this._status = enabled ? "Blocking enabled" : "Blocking disabled";
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
    } finally {
      if (checkbox) {
        checkbox.disabled = false;
      }
      this._renderBlockingState();
      this._renderLiveData();
    }
  }

  async _pause(minutes) {
    try {
      const result = await this._hass.callWS({
        type: "technitium_dns_live/pause",
        minutes,
      });

      this._status = result.until
        ? `Blocking paused until ${new Date(result.until).toLocaleTimeString()}`
        : `Blocking paused for ${minutes} minutes`;

      await this._refreshBlockingState();
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
    }

    this._renderLiveData();
  }

  async _refreshStats() {
    if (!this._hass || this._statsLoading || this._activeTab !== "stats") {
      return;
    }

    this._statsLoading = true;
    this._statsStatus = "Loading statistics…";
    this._renderStats();

    try {
      this._stats = await this._hass.callWS({
        type: "technitium_dns_live/stats",
        stats_type: this._statsType,
      });
      this._statsStatus = "";
    } catch (error) {
      this._statsStatus = `Error: ${error?.message || error}`;
    } finally {
      this._statsLoading = false;
      this._renderStats();
    }
  }

  async _allow(domain) {
    if (!domain) {
      return;
    }

    try {
      await this._hass.callWS({
        type: "technitium_dns_live/allow",
        domain,
      });
      this._status = `Allowed: ${domain}`;
      await this._refreshLive();
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
      this._renderLiveData();
    }
  }

  async _block(domain) {
    if (!domain) {
      return;
    }

    try {
      await this._hass.callWS({
        type: "technitium_dns_live/block",
        domain,
      });
      this._status = `Blocked: ${domain}`;
      await this._refreshLive();
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
      this._renderLiveData();
    }
  }

  _setTab(tab) {
    this._activeTab = tab;

    this.shadowRoot.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });

    this.shadowRoot.querySelector("#live-view")?.classList.toggle(
      "hidden",
      tab !== "live",
    );
    this.shadowRoot.querySelector("#stats-view")?.classList.toggle(
      "hidden",
      tab !== "stats",
    );

    this._updatePolling();
  }

  _toggleAutoRefresh() {
    this._autoRefresh = !this._autoRefresh;

    const button = this.shadowRoot.querySelector("#toggle-refresh");
    if (button) {
      button.textContent = this._autoRefresh ? "Stop refresh" : "Resume refresh";
      button.classList.toggle("paused", !this._autoRefresh);
    }

    this._status = this._autoRefresh
      ? "Automatic refresh resumed"
      : "Automatic refresh stopped";

    this._renderLiveData();
    this._updatePolling();
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString();
    } catch {
      return value || "";
    }
  }

  _formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  _isBlocked(entry) {
    return ["Blocked", "UpstreamBlocked", "CacheBlocked"].includes(
      entry.responseType,
    );
  }

  _renderShell() {
    if (!this.shadowRoot) {
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100%;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
        }

        .page {
          max-width: 1180px;
          margin: 0 auto;
          padding: 16px;
          box-sizing: border-box;
        }

        .card,
        .stat-card,
        .panel-card {
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow);
        }

        .card {
          overflow: hidden;
        }

        .tabs {
          display: flex;
          gap: 4px;
          padding: 8px;
          border-bottom: 1px solid var(--divider-color);
        }

        .tabs button {
          border: 0;
          background: transparent;
          color: var(--secondary-text-color);
          font-weight: 600;
        }

        .tabs button.active {
          color: var(--primary-color);
          background: var(--secondary-background-color);
        }

        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          padding: 14px;
          border-bottom: 1px solid var(--divider-color);
        }

        .title {
          font-size: 20px;
          font-weight: 600;
          margin-right: auto;
        }

        select,
        input,
        button {
          min-height: 38px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          padding: 7px 10px;
          font: inherit;
          box-sizing: border-box;
        }

        button {
          cursor: pointer;
        }

        button.primary {
          background: var(--primary-color);
          color: var(--text-primary-color);
          border-color: var(--primary-color);
        }

        button.danger {
          background: var(--error-color);
          color: #111;
          border-color: var(--error-color);
        }

        button.paused {
          border-color: var(--warning-color, #f9a825);
        }

        .blocking-control {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 38px;
          padding: 0 10px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--secondary-background-color);
          white-space: nowrap;
        }

        .blocking-control input {
          min-height: auto;
          width: 18px;
          height: 18px;
          margin: 0;
        }

        .pause-info {
          color: var(--warning-color, #f9a825);
          font-size: 12px;
        }

        .manual {
          display: grid;
          grid-template-columns: minmax(160px, 1fr) auto auto;
          gap: 8px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--divider-color);
        }

        .status {
          min-height: 20px;
          padding: 8px 14px;
          color: var(--secondary-text-color);
          font-size: 13px;
          border-bottom: 1px solid var(--divider-color);
        }

        .row {
          display: grid;
          grid-template-columns: 92px minmax(250px, 1fr) 130px 110px 90px;
          gap: 10px;
          align-items: center;
          padding: 10px 14px;
          border-bottom: 1px solid var(--divider-color);
        }

        .domain {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow-wrap: anywhere;
          cursor: pointer;
        }

        .meta {
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .blocked {
          color: var(--error-color);
          font-weight: 600;
        }

        .ok {
          color: var(--success-color, #43a047);
          font-weight: 600;
        }

        .empty {
          padding: 30px;
          text-align: center;
          color: var(--secondary-text-color);
        }

        .hidden {
          display: none !important;
        }

        .stats-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 14px;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          padding: 0 14px 14px;
        }

        .stat-card {
          padding: 14px;
          border: 1px solid var(--divider-color);
          box-shadow: none;
        }

        .stat-label {
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        .stat-value {
          margin-top: 6px;
          font-size: 26px;
          font-weight: 700;
        }

        .stat-sub {
          margin-top: 4px;
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        .stats-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          padding: 0 14px 14px;
        }

        .panel-card {
          padding: 14px;
          border: 1px solid var(--divider-color);
          box-shadow: none;
          overflow: hidden;
        }

        .panel-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
        }

        .chart {
          height: 180px;
          display: flex;
          align-items: end;
          gap: 3px;
          border-bottom: 1px solid var(--divider-color);
          padding-top: 8px;
        }

        .bar {
          flex: 1 1 0;
          min-width: 2px;
          background: var(--primary-color);
          border-radius: 3px 3px 0 0;
          opacity: 0.8;
        }

        .chart-caption {
          display: flex;
          justify-content: space-between;
          margin-top: 6px;
          color: var(--secondary-text-color);
          font-size: 11px;
        }

        .top-list {
          display: grid;
          gap: 7px;
        }

        .top-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .top-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
        }

        .top-hits {
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        @media (max-width: 760px) {
          .page {
            padding: 8px;
          }

          .title {
            width: 100%;
          }

          .manual {
            grid-template-columns: 1fr 1fr;
          }

          .manual input {
            grid-column: 1 / -1;
          }

          .row {
            grid-template-columns: 1fr auto;
            gap: 6px 10px;
          }

          .time {
            display: none;
          }

          .domain,
          .response,
          .client {
            grid-column: 1;
          }

          .action {
            grid-column: 2;
            grid-row: 1 / span 3;
          }

          .stats-grid {
            grid-template-columns: 1fr 1fr;
          }

          .stats-content {
            grid-template-columns: 1fr;
          }

          .blocking-control {
            width: 100%;
          }
        }
      </style>

      <div class="page">
        <div class="card">
          <div class="tabs">
            <button data-tab="live" class="active">Live</button>
            <button data-tab="stats">Statistics</button>
          </div>

          <div id="live-view">
            <div class="toolbar">
              <div class="title">DNS Live</div>

              <label class="blocking-control">
                <input id="blocking-enabled" type="checkbox" />
                <span>Blocking enabled</span>
                <span id="pause-info" class="pause-info"></span>
              </label>

              <select id="filter">
                <option value="">All</option>
                <option value="Blocked">Blocked</option>
                <option value="CacheBlocked">Cache blocked</option>
                <option value="UpstreamBlocked">Upstream blocked</option>
                <option value="Recursive">Recursive</option>
                <option value="Cached">Cached</option>
                <option value="Authoritative">Authoritative</option>
              </select>

              <button id="refresh">Refresh</button>
              <button id="toggle-refresh">Stop refresh</button>
              <button id="pause5">Pause 5 min</button>
              <button id="pause15">Pause 15 min</button>
            </div>

            <div class="manual">
              <input
                id="manual-domain"
                type="text"
                placeholder="domain.example"
              />
              <button id="manual-allow" class="primary">ALLOW</button>
              <button id="manual-block" class="danger">BLOCK</button>
            </div>

            <div class="status" id="status"></div>
            <div id="entries"></div>
          </div>

          <div id="stats-view" class="hidden">
            <div class="stats-toolbar">
              <div class="title">DNS Statistics</div>
              <select id="stats-period">
                <option value="LastHour">1 hour</option>
                <option value="LastDay" selected>24 hours</option>
                <option value="LastWeek">7 days</option>
                <option value="LastMonth">30 days</option>
                <option value="LastYear">1 year</option>
              </select>
              <button id="stats-refresh">Refresh</button>
            </div>

            <div class="status" id="stats-status"></div>
            <div id="stats-data"></div>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => this._setTab(button.dataset.tab));
    });

    const filter = this.shadowRoot.querySelector("#filter");
    filter.value = this._filter;
    filter.addEventListener("change", async (event) => {
      this._filter = event.target.value;
      await this._refreshLive();
    });

    this.shadowRoot
      .querySelector("#refresh")
      .addEventListener("click", () => this._refreshLive());

    this.shadowRoot
      .querySelector("#toggle-refresh")
      .addEventListener("click", () => this._toggleAutoRefresh());

    this.shadowRoot
      .querySelector("#pause5")
      .addEventListener("click", () => this._pause(5));

    this.shadowRoot
      .querySelector("#pause15")
      .addEventListener("click", () => this._pause(15));

    this.shadowRoot
      .querySelector("#blocking-enabled")
      .addEventListener("change", (event) => this._setBlocking(event.target.checked));

    const manualDomain = this.shadowRoot.querySelector("#manual-domain");
    manualDomain.addEventListener("input", (event) => {
      this._manualDomain = event.target.value.trim();
    });

    this.shadowRoot
      .querySelector("#manual-allow")
      .addEventListener("click", () => this._allow(this._manualDomain));

    this.shadowRoot
      .querySelector("#manual-block")
      .addEventListener("click", () => this._block(this._manualDomain));

    this.shadowRoot.querySelector("#entries").addEventListener("click", (event) => {
      const copyTarget = event.target.closest("[data-copy-domain]");

      if (copyTarget) {
        this._manualDomain = copyTarget.dataset.copyDomain || "";
        manualDomain.value = this._manualDomain;
        manualDomain.focus();
        return;
      }

      const button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }

      const domain = button.dataset.domain;
      if (button.dataset.action === "allow") {
        this._allow(domain);
      } else {
        this._block(domain);
      }
    });

    const statsPeriod = this.shadowRoot.querySelector("#stats-period");
    statsPeriod.value = this._statsType;
    statsPeriod.addEventListener("change", async (event) => {
      this._statsType = event.target.value;
      await this._refreshStats();
    });

    this.shadowRoot
      .querySelector("#stats-refresh")
      .addEventListener("click", () => this._refreshStats());

    this._initialized = true;
    this._renderBlockingState();
    this._renderLiveData();
    this._renderStats();
  }

  _renderBlockingState() {
    if (!this._initialized) {
      return;
    }

    const checkbox = this.shadowRoot.querySelector("#blocking-enabled");
    const pauseInfo = this.shadowRoot.querySelector("#pause-info");

    if (checkbox && this._blockingState.enabled !== null) {
      checkbox.checked = Boolean(this._blockingState.enabled);
    }

    if (!pauseInfo) {
      return;
    }

    const until = this._blockingState.temporary_disable_until;
    if (!until) {
      pauseInfo.textContent = "";
      return;
    }

    const untilDate = new Date(until);
    if (Number.isNaN(untilDate.getTime()) || untilDate <= new Date()) {
      pauseInfo.textContent = "";
      return;
    }

    pauseInfo.textContent = `paused until ${untilDate.toLocaleTimeString()}`;
  }

  _renderLiveData() {
    if (!this._initialized) {
      return;
    }

    const entries = this._entries || [];
    const status = this.shadowRoot.querySelector("#status");
    const entriesContainer = this.shadowRoot.querySelector("#entries");

    if (status) {
      const mode = this._autoRefresh ? "auto refresh on" : "auto refresh off";
      status.textContent =
        this._status ||
        `${entries.length} latest queries · ${mode} · blocking state remains live-synced`;
    }

    if (!entriesContainer) {
      return;
    }

    entriesContainer.innerHTML = entries.length
      ? entries
          .map((entry) => {
            const blocked = this._isBlocked(entry);
            const domain = this._escape(entry.qname);

            return `
              <div class="row">
                <div class="time meta">${this._escape(
                  this._formatTime(entry.timestamp),
                )}</div>

                <div
                  class="domain"
                  data-copy-domain="${domain}"
                  title="Tap to copy into the manual domain field"
                >
                  ${domain}
                  <div class="meta">
                    ${this._escape(entry.qtype)} ·
                    ${this._escape(entry.protocol)}
                  </div>
                </div>

                <div class="response ${blocked ? "blocked" : "ok"}">
                  ${this._escape(entry.responseType)}
                </div>

                <div class="client meta">
                  ${this._escape(entry.clientIpAddress)}
                </div>

                <div class="action">
                  <button
                    data-action="${blocked ? "allow" : "block"}"
                    data-domain="${domain}"
                    class="${blocked ? "primary" : "danger"}"
                  >
                    ${blocked ? "ALLOW" : "BLOCK"}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="empty">No query data available.</div>`;
  }

  _renderStats() {
    if (!this._initialized) {
      return;
    }

    const status = this.shadowRoot.querySelector("#stats-status");
    const container = this.shadowRoot.querySelector("#stats-data");

    if (status) {
      status.textContent =
        this._statsStatus ||
        "Statistics refresh every 30 seconds while this tab is open.";
    }

    if (!container) {
      return;
    }

    if (!this._stats) {
      container.innerHTML = `<div class="empty">No statistics loaded yet.</div>`;
      return;
    }

    const stats = this._stats.stats || {};
    const queries = Number(stats.totalQueries || 0);
    const blocked = Number(stats.totalBlocked || 0);
    const cached = Number(stats.totalCached || 0);
    const clients = Number(stats.totalClients || 0);
    const blockedPct = queries ? ((blocked / queries) * 100).toFixed(1) : "0.0";
    const cachedPct = queries ? ((cached / queries) * 100).toFixed(1) : "0.0";

    const chart = this._stats.mainChartData || {};
    const labels = chart.labels || [];
    const dataset = chart.datasets?.[0] || {};
    const values = dataset.data || [];
    const max = Math.max(...values.map(Number), 1);

    const bars = values.length
      ? values
          .map((value, index) => {
            const height = Math.max(2, Math.round((Number(value) / max) * 100));
            const label = labels[index] || "";
            return `<div
              class="bar"
              style="height: ${height}%"
              title="${this._escape(label)}: ${this._formatNumber(value)}"
            ></div>`;
          })
          .join("")
      : "";

    const renderTop = (items) => {
      const rows = (items || []).slice(0, 10);
      if (!rows.length) {
        return `<div class="empty">No data.</div>`;
      }

      return `<div class="top-list">${rows
        .map((item) => {
          const name = item.domain
            ? `${item.domain} (${item.name})`
            : item.name;
          return `
            <div class="top-row">
              <div class="top-name" title="${this._escape(name)}">
                ${this._escape(name)}
              </div>
              <div class="top-hits">${this._formatNumber(item.hits)}</div>
            </div>
          `;
        })
        .join("")}</div>`;
    };

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total queries</div>
          <div class="stat-value">${this._formatNumber(queries)}</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Blocked</div>
          <div class="stat-value">${this._formatNumber(blocked)}</div>
          <div class="stat-sub">${blockedPct}% of queries</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Cached</div>
          <div class="stat-value">${this._formatNumber(cached)}</div>
          <div class="stat-sub">${cachedPct}% of queries</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Clients</div>
          <div class="stat-value">${this._formatNumber(clients)}</div>
        </div>
      </div>

      <div class="stats-content">
        <div class="panel-card" style="grid-column: 1 / -1;">
          <div class="panel-title">Queries over time</div>
          ${bars
            ? `
              <div class="chart">${bars}</div>
              <div class="chart-caption">
                <span>${this._escape(labels[0] || "")}</span>
                <span>${this._escape(labels[labels.length - 1] || "")}</span>
              </div>
            `
            : `<div class="empty">No chart data.</div>`
          }
        </div>

        <div class="panel-card">
          <div class="panel-title">Top domains</div>
          ${renderTop(this._stats.topDomains)}
        </div>

        <div class="panel-card">
          <div class="panel-title">Top blocked domains</div>
          ${renderTop(this._stats.topBlockedDomains)}
        </div>

        <div class="panel-card" style="grid-column: 1 / -1;">
          <div class="panel-title">Top clients</div>
          ${renderTop(this._stats.topClients)}
        </div>
      </div>
    `;
  }
}

if (!customElements.get("technitium-dns-live-panel")) {
  customElements.define(
    "technitium-dns-live-panel",
    TechnitiumDnsLivePanel,
  );
}
