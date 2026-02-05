from flask import Flask, jsonify, request, send_from_directory
from ipaddress import IPv4Address
import math
import os

app = Flask(__name__, static_folder=".", static_url_path="")


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
  resp = send_from_directory(app.static_folder, "index.html")
  resp.headers.add("Access-Control-Allow-Origin", "*")
  return resp


@app.after_request
def after_request(response):
  response.headers.add("Access-Control-Allow-Origin", "*")
  response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  response.headers.add("Access-Control-Allow-Headers", "Content-Type")
  return response


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
    }

    resp = jsonify(response)
    resp.headers.add("Access-Control-Allow-Origin", "*")
    resp.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
    resp.headers.add("Access-Control-Allow-Headers", "Content-Type")
    return resp
  except ValueError as ve:
    resp = jsonify({"error": str(ve)})
    resp.headers.add("Access-Control-Allow-Origin", "*")
    return resp, 400
  except Exception as exc:
    resp = jsonify({"error": f"Internal server error: {exc}"})
    resp.headers.add("Access-Control-Allow-Origin", "*")
    return resp, 500


# if __name__ == "__main__":
#   port = int(os.environ.get("PORT", 5000))
#   app.run(host="127.0.0.1", port=port, debug=True)

if __name__ == "__main__":
  port = int(os.environ.get("PORT", 5000))
  app.run(host="0.0.0.0", port=port, debug=False)