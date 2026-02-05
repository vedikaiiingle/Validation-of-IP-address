// IPv4 validation and integration with backend API
// Front-end does basic checks, backend performs full calculation.

const form = document.getElementById("ip-form");
const ipInput = document.getElementById("ip-input");
const prefixSelect = document.getElementById("prefix-select");
const toastContainer = document.getElementById("toast-container");
const toastBackdrop = document.getElementById("toast-backdrop");

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

      fetch("http://127.0.0.1:5000/api/ip-info", {
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

