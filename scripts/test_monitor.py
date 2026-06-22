import socket
import json
import time
import sys
import uuid

HOST = '127.0.0.1'
PORT = 52525


def test_market_monitor():
    print("=== Market Data Monitor Test")
    print()
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    
    try:
        sock.connect((HOST, PORT))
        print("Connected to Python engine")
    except ConnectionRefusedError:
        print("ERROR: Cannot connect to Python engine on port 52525")
        print("Hint: Start the engine first with: python3 python/engine_server.py")
        return False
    
    def send_request(action, params=None):
        req_id = str(uuid.uuid4())
        req = {"id": req_id, "action": action}
        if params:
            req["params"] = params
        msg = json.dumps(req) + '\n'
        sock.sendall(msg.encode())
        return req_id
    
    def recv_response(timeout=5):
        buf = b''
        start = time.time()
        while time.time() - start < timeout:
            try:
                data = sock.recv(65536)
                if not data:
                    break
                buf += data
            except socket.timeout:
                break
            while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    if line.strip():
                        return json.loads(line.strip())
        return None
    
    # 1. Get exchange configs
    print("1. Get exchange configs...")
    send_request("get_exchange_configs")
    resp = recv_response()
    if resp and resp.get("success"):
        configs = resp.get("result", {}).get("exchanges", [])
        print("   Got %d exchanges:" % len(configs))
        for cfg in configs:
            exch = cfg["exchange"]
            name = cfg["name"]
            sym_count = len(cfg["symbols"])
            print("     - %s (%s): %d symbols" % (exch, name, sym_count))
        print("   Exchange configs OK")
    else:
        print(f"   FAILED: {resp}")
        return False
    
    # 2. Start monitor with low threshold
    print("\n2. Start monitor (threshold=5bp, cooldown=2s)...")
    send_request("start_monitor", {
        "threshold_type": "bp",
        "threshold": 5,
        "cooldown_ms": 2000,
    })
    resp = recv_response()
    if resp and resp.get("success"):
        result = resp.get("result", {})
        print(f"   Monitor started: {result.get('gateway_count')} gateways")
        print(f"   Threshold: {result.get('threshold')} {result.get('threshold_type')}")
        print("   Start monitor OK")
    else:
        print(f"   FAILED: {resp}")
        return False
    
    # 3. Receive tick data for 3 seconds
    print("\n3. Receiving tick data for 3 seconds...")
    sock.settimeout(1)
    tick_count = 0
    alert_count = 0
    start_time = time.time()
    first_batch_count = 0
    while time.time() - start_time < 3:
        try:
            data = sock.recv(65536)
            if not data:
                break
            lines = data.decode().strip().split('\n')
            for line in lines:
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.strip())
                except:
                    continue
                if msg.get("type") == "stream":
                    if msg.get("stream") == "md_tick_batch":
                        ticks = msg.get("data", [])
                        tick_count += len(ticks)
                        first_batch_count += 1
                        if first_batch_count <= 2:
                            print(f"   Batch #{first_batch_count}: {len(ticks)} ticks")
                            for t in ticks[:2]:
                                print(f"     {t['exchange']}:{t['symbol']} bid={t['bid1_price']} ask={t['ask1_price']} spread={t['spread_pct']}bp")
                    elif msg.get("stream") == "md_alert":
                        alert_count += 1
                        alert = msg.get("data", {})
                        print(f"   ALERT #{alert_count}: {alert['exchange']}:{alert['symbol']} spread={alert['spread_pct']}bp threshold={alert['threshold']} {alert['threshold_type']}")
        except socket.timeout:
            continue
        except Exception as e:
            print(f"   Error: {e}")
            break
    
    print(f"   Total: {tick_count} ticks, {alert_count} alerts in 3 seconds")
    if tick_count > 0:
        print("   Tick stream OK")
    else:
        print("   WARNING: No ticks received")
    
    # 4. Stop monitor
    print("\n4. Stop monitor...")
    sock.settimeout(5)
    send_request("stop_monitor")
    resp = recv_response()
    if resp and resp.get("success"):
        print("   Stop monitor OK")
    else:
        print(f"   FAILED: {resp}")
        return False
    
    sock.close()
    print()
    print("=== All tests passed! ===")
    return True


if __name__ == "__main__":
    success = test_market_monitor()
    sys.exit(0 if success else 1)
