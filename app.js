// IPv4 validation and integration with backend API
// Front-end does basic checks, backend performs full calculation.

// API base URL - auto-detect if running on Render or local
// For deployed version, use relative URLs (same domain)
// For local, use localhost
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:5000'
  : ''; // Empty string = relative URLs (same domain as frontend)

const form = document.getElementById("ip-form");
const ipInput = document.getElementById("ip-input");
const prefixSelect = document.getElementById("prefix-select");
const toastContainer = document.getElementById("toast-container");
const toastBackdrop = document.getElementById("toast-backdrop");

// Current page state
let currentPage = 'dashboard';

/**
 * Show toast notification
 * @param {"error" | "success"} type
 * @param {string} title
 * @param {string} message
 */
function showToast(type, title, message) {
  if (!toastContainer) return;

  // Show backdrop
  if (toastBackdrop) {
    toastBackdrop.classList.add("show");
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const icon = document.createElement("div");
  icon.className = "toast__icon";
  icon.textContent = type === "error" ? "⚠" : "✅";

  const body = document.createElement("div");
  body.className = "toast__body";

  const titleEl = document.createElement("div");
  titleEl.className = "toast__title";
  titleEl.textContent = title;

  const messageEl = document.createElement("div");
  messageEl.className = "toast__message";
  messageEl.textContent = message;

  body.appendChild(titleEl);
  body.appendChild(messageEl);

  const close = document.createElement("button");
  close.className = "toast__close";
  close.type = "button";
  close.innerHTML = "×";
  
  const removeToast = () => {
    if (toast.parentElement === toastContainer) {
      toastContainer.removeChild(toast);
    }
    // Hide backdrop if no more toasts
    if (toastContainer.children.length === 0 && toastBackdrop) {
      toastBackdrop.classList.remove("show");
    }
  };
  
  close.addEventListener("click", removeToast);
  
  // Click backdrop to close
  if (toastBackdrop) {
    toastBackdrop.addEventListener("click", removeToast);
  }

  toast.appendChild(icon);
  toast.appendChild(body);
  toast.appendChild(close);

  toastContainer.appendChild(toast);

  // Auto dismiss after 5 seconds
  setTimeout(() => {
    removeToast();
  }, 5000);
}

/**
 * Validate IPv4 string
 * @param {string} value
 * @returns {{valid: boolean, octets?: number[], error?: string}}
 */
function validateIPv4(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: "Please enter an IPv4 address." };
  }

  // Basic character check
  const validChars = /^[0-9.]+$/;
  if (!validChars.test(trimmed)) {
    return {
      valid: false,
      error: "IPv4 can contain only digits (0‑9) and dots (.).",
    };
  }

  const parts = trimmed.split(".");
  if (parts.length !== 4) {
    return {
      valid: false,
      error: "IPv4 address must have exactly 4 octets separated by dots.",
    };
  }

  const octets = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") {
      return {
        valid: false,
        error: `Octet ${i + 1} is empty. Use numbers between 0 and 255.`,
      };
    }

    // No leading zeros like 01, 001 (except single 0)
    if (part.length > 1 && part[0] === "0") {
      return {
        valid: false,
        error: `Octet ${i + 1} has leading zeros (\"${part}\"). Use plain decimal format.`,
      };
    }

    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return {
        valid: false,
        error: `Octet ${i + 1} must be a number between 0 and 255.`,
      };
    }
    octets.push(num);
  }

  return { valid: true, octets };
}

/**
 * Update only the parts of UI that are allowed on front‑end:
 * - Fill binary placeholders with binary representation
 * - Keep all network / host range values as placeholders
 * @param {number[]} octets
 */
function updateUiForValidIp(octets) {
  // Binary representation (from backend response or local calculation)
  const binaryEls = [
    document.getElementById("octet-1"),
    document.getElementById("octet-2"),
    document.getElementById("octet-3"),
    document.getElementById("octet-4"),
  ];

  octets.forEach((val, index) => {
    const el = binaryEls[index];
    if (!el) return;
    const binary = val.toString(2).padStart(8, "0");
    el.textContent = binary;
  });

}

/**
 * Fill all calculated fields from backend response.
 */
function applyBackendResult(data) {
  if (!data) return;

  // Binary
  if (Array.isArray(data.octets)) {
    updateUiForValidIp(data.octets);
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el && typeof value === "string") {
      el.textContent = value || "—";
    }
  };

  setText("ip-class-value", data.ip_class);
  setText("network-type-value", data.network_type);
  setText("network-id-value", data.network_id);
  setText("broadcast-value", data.broadcast);
  setText("subnet-mask-value", data.subnet_mask);
  setText("wildcard-mask-value", data.wildcard_mask);

  if (data.host_min && data.host_max) {
    setText("usable-range-value", `${data.host_min} – ${data.host_max}`);
  } else {
    setText("usable-range-value", "Not applicable");
  }

  const formatNumber = (n) =>
    typeof n === "number" ? n.toLocaleString("en-IN") : "—";

  setText("total-hosts-value", formatNumber(data.total_hosts));
  setText("usable-hosts-value", formatNumber(data.usable_hosts));
}

if (form && ipInput && prefixSelect) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    try {
      const value = ipInput.value;
      const prefix = parseInt(prefixSelect.value, 10);
      const result = validateIPv4(value);

      if (!result.valid) {
        showToast(
          "error",
          "Invalid IPv4 Address",
          result.error || "Invalid IP."
        );
        return;
      }

      fetch(`${API_BASE}/api/ip-info`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ip: value.trim(),
          prefix,
        }),
      })
        .then(async (res) => {
          const payload = await res.json().catch(() => null);
          if (!res.ok) {
            const msg =
              (payload && payload.error) ||
              "Backend rejected the IP address.";
            throw new Error(msg);
          }
          applyBackendResult(payload);
          updateSidebarHistory();
          showToast(
            "success",
            "Valid IPv4 Address",
            "The address and network information were calculated successfully."
          );
        })
        .catch((error) => {
          console.error(error);
          showToast(
            "error",
            "Backend Error",
            error.message ||
              "Could not reach the server. Make sure the Python backend is running."
          );
        });
    } catch (err) {
      console.error(err);
      showToast(
        "error",
        "Unexpected Error",
        "Something went wrong while validating. Please try again."
      );
    }
  });
}

// ========== Routing System ==========
function navigateToPage(page) {
  // Hide all pages
  document.querySelectorAll('.page-content').forEach(el => {
    el.style.display = 'none';
  });
  
  // Show selected page
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.style.display = 'flex';
  }
  
  // Update nav items
  document.querySelectorAll('.sidebar__nav-item').forEach(item => {
    item.classList.remove('sidebar__nav-item--active');
    if (item.dataset.page === page) {
      item.classList.add('sidebar__nav-item--active');
    }
  });
  
  // Update page title
  const titles = {
    dashboard: { title: 'IP Address Validator', subtitle: 'Network analysis tool for IPv4.' },
    history: { title: 'Validation History', subtitle: 'All IP addresses validated in this session.' },
    subnetting: { title: 'Subnet Calculator', subtitle: 'Calculate subnet details for any network.' },
    admin: { title: 'Admin Profile', subtitle: 'Manage your account and session information.' },
  };
  
  const pageInfo = titles[page] || titles.dashboard;
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = pageInfo.title;
  if (subtitleEl) subtitleEl.textContent = pageInfo.subtitle;
  
  currentPage = page;
  
  // Load page-specific data
  if (page === 'history') {
    loadHistory();
  } else if (page === 'admin') {
    loadAdminInfo();
  }
}

// ========== History Functions ==========
function loadHistory() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;
  
  historyList.innerHTML = '<div class="history-empty">Loading history...</div>';
  
  fetch(`${API_BASE}/api/history`)
    .then(async res => {
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned non-JSON response");
      }
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      if (data.history && data.history.length > 0) {
        historyList.innerHTML = '';
        data.history.forEach((item, index) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'history-item';
          const date = new Date(item.timestamp);
          itemEl.innerHTML = `
            <div class="history-item__left">
              <div class="history-item__ip">${item.ip}/${item.prefix}</div>
              <div class="history-item__details">${item.ip_class} • ${item.network_type}</div>
            </div>
            <div class="history-item__time">${date.toLocaleTimeString()}</div>
          `;
          historyList.appendChild(itemEl);
        });
      } else {
        historyList.innerHTML = '<div class="history-empty">No validation history yet.</div>';
      }
    })
    .catch(err => {
      historyList.innerHTML = '<div class="history-empty">Error loading history. Make sure backend is running.</div>';
      console.error('History error:', err);
    });
}

function updateSidebarHistory() {
  const sidebarHistory = document.getElementById('sidebar-history');
  if (!sidebarHistory) return;
  
  fetch(`${API_BASE}/api/history`)
    .then(async res => {
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        return { history: [], count: 0 };
      }
      if (!res.ok) {
        return { history: [], count: 0 };
      }
      return res.json();
    })
    .then(data => {
      if (data.history && data.history.length > 0) {
        sidebarHistory.innerHTML = '';
        data.history.slice(0, 3).forEach(item => {
          const itemEl = document.createElement('div');
          itemEl.className = 'sidebar__history-item';
          itemEl.innerHTML = `
            <div class="sidebar__history-item__ip">${item.ip}/${item.prefix}</div>
            <div class="sidebar__history-item__class">${item.ip_class} • ${item.network_type}</div>
          `;
          itemEl.addEventListener('click', () => {
            navigateToPage('dashboard');
            ipInput.value = item.ip;
            prefixSelect.value = item.prefix;
          });
          sidebarHistory.appendChild(itemEl);
        });
      } else {
        sidebarHistory.innerHTML = '<div class="sidebar__history-empty">No records yet – validate an IP to see it here.</div>';
      }
    })
    .catch(err => {
      console.error('Sidebar history error:', err);
      sidebarHistory.innerHTML = '<div class="sidebar__history-empty">No records yet – validate an IP to see it here.</div>';
    });
}

// ========== Subnetting Functions ==========
const subnetForm = document.getElementById('subnet-form');
if (subnetForm) {
  subnetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const networkInput = document.getElementById('subnet-network-input');
    const subnetsInput = document.getElementById('subnets-needed-input');
    const resultsEl = document.getElementById('subnet-results');
    const contentEl = document.getElementById('subnet-results-content');
    
    if (!networkInput || !subnetsInput) return;
    
    const network = networkInput.value.trim();
    const subnets = parseInt(subnetsInput.value, 10);
    
    if (!network) {
      showToast('error', 'Invalid Input', 'Please enter a network address.');
      return;
    }
    
    if (!subnets || subnets < 1) {
      showToast('error', 'Invalid Input', 'Number of subnets must be at least 1.');
      return;
    }
    
    fetch(`${API_BASE}/api/subnetting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, subnets }),
    })
      .then(async res => {
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Server returned non-JSON response. Make sure backend is running.");
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
      })
      .then(data => {
        if (data.error) {
          showToast('error', 'Subnetting Error', data.error);
          return;
        }
        
        if (resultsEl) resultsEl.style.display = 'block';
        if (contentEl) {
          contentEl.innerHTML = `
            <div style="margin-bottom: 16px;">
              <div class="meta-label">Original Network</div>
              <div class="meta-value" style="margin-top: 4px; font-size: 15px;">${data.original_network}</div>
            </div>
            <div style="margin-bottom: 16px;">
              <div class="meta-label">Bits Borrowed</div>
              <div class="meta-value" style="margin-top: 4px;">${data.bits_borrowed}</div>
            </div>
            <div style="margin-bottom: 16px;">
              <div class="meta-label">New Prefix</div>
              <div class="meta-value" style="margin-top: 4px;">/${data.new_prefix}</div>
            </div>
            <div class="subnet-grid">
              ${data.subnets.map(subnet => `
                <div class="subnet-item">
                  <div class="subnet-item__header">Subnet ${subnet.subnet_number}: ${subnet.network}</div>
                  <div class="subnet-item__details">
                    <strong>Broadcast:</strong> ${subnet.broadcast}<br>
                    ${subnet.host_min ? `<strong>Host Range:</strong> ${subnet.host_min} - ${subnet.host_max}<br>` : ''}
                    <strong>Total Hosts:</strong> ${subnet.total_hosts.toLocaleString()}<br>
                    <strong>Usable Hosts:</strong> ${subnet.usable_hosts.toLocaleString()}
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        }
        showToast('success', 'Subnets Calculated', `Successfully created ${data.total_subnets_created} subnet(s).`);
      })
      .catch(err => {
        showToast('error', 'Subnetting Error', err.message || 'Failed to calculate subnets.');
        console.error(err);
      });
  });
}

// ========== Admin Functions ==========
function loadAdminInfo() {
  fetch(`${API_BASE}/api/user`)
    .then(res => res.json())
    .then(data => {
      const usernameEl = document.getElementById('admin-username');
      const sessionEl = document.getElementById('admin-session-time');
      const validationsEl = document.getElementById('admin-total-validations');
      
      if (usernameEl) usernameEl.textContent = data.user || 'Admin User';
      if (sessionEl && data.login_time) {
        const date = new Date(data.login_time);
        sessionEl.textContent = date.toLocaleString();
      }
      
      // Get validation count from history
      fetch(`${API_BASE}/api/history`)
        .then(res => res.json())
        .then(historyData => {
          if (validationsEl) {
            validationsEl.textContent = historyData.count || 0;
          }
        })
        .catch(() => {
          if (validationsEl) validationsEl.textContent = '—';
        });
    })
    .catch(err => {
      console.error(err);
    });
}

// ========== Export Function ==========
const exportBtn = document.getElementById('export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    fetch(`${API_BASE}/api/export`)
      .then(res => res.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ip-validator-session-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('success', 'Export Successful', 'Session data downloaded successfully.');
      })
      .catch(err => {
        showToast('error', 'Export Failed', err.message || 'Failed to export session data.');
        console.error(err);
      });
  });
}

// ========== Logout Function ==========
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    fetch(`${API_BASE}/api/logout`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        showToast('success', 'Logged Out', 'You have been logged out successfully.');
        navigateToPage('dashboard');
        updateSidebarHistory();
      })
      .catch(err => {
        showToast('error', 'Logout Failed', err.message || 'Failed to logout.');
        console.error(err);
      });
  });
}

// ========== Navigation Setup ==========
document.querySelectorAll('.sidebar__nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    if (page) {
      navigateToPage(page);
    }
  });
});

const userMenuBtn = document.getElementById('user-menu-btn');
if (userMenuBtn) {
  userMenuBtn.addEventListener('click', () => {
    navigateToPage('admin');
  });
}

// Initialize
updateSidebarHistory();
navigateToPage('dashboard');
