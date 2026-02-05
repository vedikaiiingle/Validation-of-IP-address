from flask import Flask, jsonify, request, send_from_directory
from ipaddress import IPv4Address
import math
import os
import json
from datetime import datetime
from collections import deque

app = Flask(__name__, static_folder=".", static_url_path="")
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

# In-memory storage (for demo - in production use database)
history_storage = deque(maxlen=100)  # Store last 100 validations
session_data = {"user": "Admin User", "login_time": datetime.now().isoformat()}


def parse_ipv4(ip_str: str):
  try:
    octets = [int(p) for p in ip_str.split(".")]
  except ValueError:
    raise ValueError("IPv4 address must contain only digits and dots.")

  if len(octets) != 4:
    raise ValueError("IPv4 address must have exactly 4 octets.")

  for i, o in enumerate(octets, start=1):
    if o < 0 or o > 255:
      raise ValueError(f"Octet {i} must be between 0 and 255.")

  return octets


def octets_to_int(octets):
  value = 0
  for o in octets:
    value = (value << 8) | o
  return value


def int_to_octets(value):
  return [
    (value >> 24) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF,
  ]


def int_to_ip(value):
  return ".".join(str(o) for o in int_to_octets(value))


def detect_class(first_octet: int) -> str:
  if 1 <= first_octet <= 126:
    return "Class A"
  if 128 <= first_octet <= 191:
    return "Class B"
  if 192 <= first_octet <= 223:
    return "Class C"
  if 224 <= first_octet <= 239:
    return "Class D (Multicast)"
  if 240 <= first_octet <= 254:
    return "Class E (Experimental)"
  if first_octet == 127:
    return "Loopback"
  return "Unknown"


def detect_network_type(octets):
  a, b, *_ = octets

  if a == 10:
    return "Private (10.0.0.0/8)"
  if a == 172 and 16 <= b <= 31:
    return "Private (172.16.0.0/12)"
  if a == 192 and b == 168:
    return "Private (192.168.0.0/16)"
  if a == 127:
    return "Loopback"
  if a == 169 and b == 254:
    return "Link-local (APIPA)"
  if a == 0:
    return "Software / Current network"
  if 224 <= a <= 239:
    return "Multicast"
  if 240 <= a <= 255:
    return "Reserved / Experimental"
  return "Public"


def mask_from_prefix(prefix: int) -> int:
  if prefix == 0:
    return 0
  return (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF


@app.route("/")
def index():
  return send_from_directory(app.static_folder, "index.html")


@app.after_request
def after_request(response):
  response.headers.add("Access-Control-Allow-Origin", "*")
  response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  response.headers.add("Access-Control-Allow-Headers", "Content-Type")
  return response

@app.route("/api/history", methods=["OPTIONS"])
@app.route("/api/subnetting", methods=["OPTIONS"])
@app.route("/api/export", methods=["OPTIONS"])
@app.route("/api/logout", methods=["OPTIONS"])
@app.route("/api/user", methods=["OPTIONS"])
def options_handler():
  return jsonify({})


@app.post("/api/ip-info")
def ip_info():
  try:
    data = request.get_json(force=True) or {}
    ip_str = str(data.get("ip", "")).strip()
    prefix = int(data.get("prefix", 24))

    if not ip_str:
      return jsonify({"error": "IP address is required."}), 400
    if prefix < 0 or prefix > 32:
      return jsonify({"error": "Prefix must be between 0 and 32."}), 400

    octets = parse_ipv4(ip_str)
    ip_int = octets_to_int(octets)

    ip_class = detect_class(octets[0])
    network_type = detect_network_type(octets)

    mask_int = mask_from_prefix(prefix)
    wildcard_int = (~mask_int) & 0xFFFFFFFF
    network_int = ip_int & mask_int
    broadcast_int = network_int | wildcard_int

    # Host range and counts
    host_min_int = None
    host_max_int = None
    total_hosts = 1 if prefix == 32 else int(math.pow(2, 32 - prefix))

    if prefix <= 30:
      usable_hosts = max(total_hosts - 2, 0)
      if usable_hosts > 0:
        host_min_int = network_int + 1
        host_max_int = broadcast_int - 1
    else:
      # /31 and /32 have no traditional usable host range
      usable_hosts = 0

    response = {
      "ip": ip_str,
      "prefix": prefix,
      "octets": octets,
      "ip_class": ip_class,
      "network_type": network_type,
      "subnet_mask": int_to_ip(mask_int),
      "wildcard_mask": int_to_ip(wildcard_int),
      "network_id": f"{int_to_ip(network_int)}/{prefix}",
      "broadcast": int_to_ip(broadcast_int),
      "host_min": int_to_ip(host_min_int) if host_min_int is not None else None,
      "host_max": int_to_ip(host_max_int) if host_max_int is not None else None,
      "total_hosts": total_hosts,
      "usable_hosts": usable_hosts,
      "timestamp": datetime.now().isoformat(),
    }

    # Save to history
    history_entry = {
      "ip": ip_str,
      "prefix": prefix,
      "ip_class": ip_class,
      "network_type": network_type,
      "network_id": response["network_id"],
      "timestamp": response["timestamp"],
    }
    history_storage.append(history_entry)

    return jsonify(response)
  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


@app.get("/api/history")
def get_history():
  """Get validation history"""
  try:
    history_list = list(history_storage)
    history_list.reverse()  # Most recent first
    return jsonify({"history": history_list, "count": len(history_list)})
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


@app.post("/api/subnetting")
def subnetting():
  """Calculate subnetting information"""
  try:
    data = request.get_json(force=True) or {}
    network_str = str(data.get("network", "")).strip()  # e.g., "192.168.1.0/24"
    subnets_needed = int(data.get("subnets", 1))
    
    if not network_str or "/" not in network_str:
      return jsonify({"error": "Network must be in CIDR format (e.g., 192.168.1.0/24)"}), 400
    
    ip_part, prefix_str = network_str.split("/")
    prefix = int(prefix_str)
    
    if prefix < 0 or prefix > 32:
      return jsonify({"error": "Prefix must be between 0 and 32."}), 400
    
    if subnets_needed < 1:
      return jsonify({"error": "Number of subnets must be at least 1."}), 400
    
    octets = parse_ipv4(ip_part)
    network_int = octets_to_int(octets)
    mask_int = mask_from_prefix(prefix)
    network_int = network_int & mask_int
    
    # Calculate bits needed for subnets
    bits_needed = math.ceil(math.log2(subnets_needed))
    new_prefix = prefix + bits_needed
    
    if new_prefix > 32:
      return jsonify({"error": f"Cannot create {subnets_needed} subnets with /{prefix} network."}), 400
    
    subnet_mask = mask_from_prefix(new_prefix)
    hosts_per_subnet = int(math.pow(2, 32 - new_prefix))
    usable_per_subnet = max(hosts_per_subnet - 2, 0) if new_prefix <= 30 else 0
    
    subnets = []
    subnet_size = int(math.pow(2, 32 - new_prefix))
    
    for i in range(min(subnets_needed, int(math.pow(2, bits_needed)))):
      subnet_network = network_int + (i * subnet_size)
      subnet_broadcast = subnet_network + subnet_size - 1
      
      host_min = subnet_network + 1 if new_prefix <= 30 else None
      host_max = subnet_broadcast - 1 if new_prefix <= 30 else None
      
      subnets.append({
        "subnet_number": i + 1,
        "network": f"{int_to_ip(subnet_network)}/{new_prefix}",
        "broadcast": int_to_ip(subnet_broadcast),
        "host_min": int_to_ip(host_min) if host_min else None,
        "host_max": int_to_ip(host_max) if host_max else None,
        "total_hosts": hosts_per_subnet,
        "usable_hosts": usable_per_subnet,
      })
    
    response = {
      "original_network": f"{int_to_ip(network_int)}/{prefix}",
      "subnets_needed": subnets_needed,
      "bits_borrowed": bits_needed,
      "new_prefix": new_prefix,
      "subnets": subnets,
      "total_subnets_created": len(subnets),
    }
    
    return jsonify(response)
  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


@app.get("/api/export")
def export_session():
  """Export session data (history + user info)"""
  try:
    history_list = list(history_storage)
    export_data = {
      "user": session_data.get("user", "Admin User"),
      "session_start": session_data.get("login_time"),
      "export_time": datetime.now().isoformat(),
      "total_validations": len(history_list),
      "history": list(history_list),
    }
    return jsonify(export_data)
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


@app.post("/api/logout")
def logout():
  """Logout - clear session"""
  try:
    session_data.clear()
    session_data["user"] = "Admin User"
    session_data["login_time"] = datetime.now().isoformat()
    return jsonify({"message": "Logged out successfully"})
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


@app.get("/api/user")
def get_user():
  """Get current user info"""
  try:
    return jsonify(session_data)
  except Exception as exc:
    return jsonify({"error": f"Internal server error: {exc}"}), 500


# if __name__ == "__main__":
#   port = int(os.environ.get("PORT", 5000))
#   app.run(host="127.0.0.1", port=port, debug=True)

@app.errorhandler(404)
def not_found(error):
  return jsonify({"error": "Route not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
  return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
  return jsonify({"error": "Internal server error"}), 500

# Ensure all errors return JSON
@app.errorhandler(Exception)
def handle_exception(e):
  return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
  port = int(os.environ.get("PORT", 5000))
  app.run(host="0.0.0.0", port=port, debug=True)