class TechnitiumDnsLivePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._entries = [];
    this._timer = null;
    this._visible = true;
    this._loading = false;
    this._filter = "";
    this._limit = 50;
    this._status = "";
    this._manualDomain = "";

    this._onVisibilityChange = () => {
      this._visible = document.visibilityState === "visible";
      this._updatePolling();
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
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
    this._render();
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisibilityChange);

    if (this._observer) {
      this._observer.disconnect();
    }

    this._stopPolling();
  }

  _updatePolling() {
    if (this.isConnected && this._visible && this._hass) {
      this._startPolling();
    } else {
      this._stopPolling();
    }
  }

  _startPolling() {
    if (this._timer) {
      return;
    }

    this._refresh();

    this._timer = window.setInterval(() => {
      this._refresh();
    }, 2000);
  }

  _stopPolling() {
    if (!this._timer) {
      return;
    }

    window.clearInterval(this._timer);
    this._timer = null;
  }

  async _refresh() {
    if (!this._hass || this._loading) {
      return;
    }

    this._loading = true;

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
      this._loading = false;
      this._render();
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
      await this._refresh();
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
      this._render();
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
      await this._refresh();
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
      this._render();
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
    } catch (error) {
      this._status = `Error: ${error?.message || error}`;
    }

    this._render();
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

  _isBlocked(entry) {
    return ["Blocked", "UpstreamBlocked", "CacheBlocked"].includes(
      entry.responseType,
    );
  }

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    const entries = this._entries || [];

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

        .card {
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow);
          overflow: hidden;
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
          color: white;
          border-color: var(--error-color);
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
        }
      </style>

      <div class="page">
        <div class="card">
          <div class="toolbar">
            <div class="title">DNS Live</div>

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
            <button id="pause5">Pause 5 min</button>
            <button id="pause15">Pause 15 min</button>
          </div>

          <div class="manual">
            <input
              id="manual-domain"
              type="text"
              placeholder="domain.example"
              value="${this._escape(this._manualDomain)}"
            />
            <button id="manual-allow" class="primary">ALLOW</button>
            <button id="manual-block" class="danger">BLOCK</button>
          </div>

          <div class="status">
            ${this._escape(
              this._status ||
                `${entries.length} latest queries · polling only while this panel is visible`,
            )}
          </div>

          ${
            entries.length
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

                        <div class="response ${
                          blocked ? "blocked" : "ok"
                        }">
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
              : `<div class="empty">No query data available.</div>`
          }
        </div>
      </div>
    `;

    const filter = this.shadowRoot.querySelector("#filter");

    if (filter) {
      filter.value = this._filter;

      filter.addEventListener("change", async (event) => {
        this._filter = event.target.value;
        await this._refresh();
      });
    }

    this.shadowRoot
      .querySelector("#refresh")
      ?.addEventListener("click", () => this._refresh());

    this.shadowRoot
      .querySelector("#pause5")
      ?.addEventListener("click", () => this._pause(5));

    this.shadowRoot
      .querySelector("#pause15")
      ?.addEventListener("click", () => this._pause(15));

    const manualDomain = this.shadowRoot.querySelector("#manual-domain");

    manualDomain?.addEventListener("input", (event) => {
      this._manualDomain = event.target.value.trim();
    });

    this.shadowRoot
      .querySelector("#manual-allow")
      ?.addEventListener("click", () => this._allow(this._manualDomain));

    this.shadowRoot
      .querySelector("#manual-block")
      ?.addEventListener("click", () => this._block(this._manualDomain));

    this.shadowRoot.querySelectorAll("[data-copy-domain]").forEach((element) => {
      element.addEventListener("click", () => {
        this._manualDomain = element.dataset.copyDomain || "";
        this._render();
        this.shadowRoot.querySelector("#manual-domain")?.focus();
      });
    });

    this.shadowRoot.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const domain = button.dataset.domain;

        if (button.dataset.action === "allow") {
          this._allow(domain);
        } else {
          this._block(domain);
        }
      });
    });
  }
}

if (!customElements.get("technitium-dns-live-panel")) {
  customElements.define(
    "technitium-dns-live-panel",
    TechnitiumDnsLivePanel,
  );
}
