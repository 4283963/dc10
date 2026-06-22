import sys
import os
import argparse
import json
import socket
import threading
import traceback
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backtest_engine import MAStrategy, load_csv_bars
from market_data_engine import MarketDataEngine, Tick, SpreadAlert


class EngineServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 52525):
        self.host = host
        self.port = port
        self.server_socket = None
        self.client_socket = None
        self._running = False
        self._send_lock = threading.Lock()
        self._buffer = ""

        self.md_engine: Optional[MarketDataEngine] = None
        self._md_lock = threading.Lock()
        self._tick_rate_limit_ms = 200
        self._last_tick_sent: Dict[str, int] = {}
        self._md_send_thread: Optional[threading.Thread] = None
        self._md_snap_queue: List[Dict[str, Any]] = []
        self._md_running = False

    def _send(self, msg: Dict[str, Any]) -> None:
        if not self.client_socket:
            return
        raw = (json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8")
        try:
            with self._send_lock:
                self.client_socket.sendall(raw)
        except Exception as e:
            print(f"[EngineServer] send error: {e}", file=sys.stderr)

    def _log(self, level: str, message: str) -> None:
        self._send({"type": "log", "level": level, "message": message})

    def _stream(self, stream_name: str, data: Any) -> None:
        self._send({"type": "stream", "stream": stream_name, "data": data})

    def _respond(self, request_id: str, success: bool, payload: Any = None, error: str = None) -> None:
        resp = {"id": request_id, "success": success}
        if payload is not None:
            resp["result"] = payload
        if error is not None:
            resp["error"] = error
        self._send(resp)

    def _handle_request(self, req: Dict[str, Any]) -> None:
        req_id = req.get("id", "")
        action = req.get("action", "")

        try:
            if action == "ping":
                self._respond(req_id, True, "pong")

            elif action == "start_backtest":
                self._run_backtest(req_id, req.get("params", {}))

            elif action == "preview_csv":
                self._preview_csv(req_id, req.get("params", {}))

            elif action == "generate_sample":
                self._generate_sample(req_id, req.get("params", {}))

            elif action == "start_monitor":
                self._start_monitor(req_id, req.get("params", {}))

            elif action == "stop_monitor":
                self._stop_monitor(req_id)

            elif action == "get_monitor_snapshot":
                self._get_monitor_snapshot(req_id)

            elif action == "get_alert_history":
                self._get_alert_history(req_id, req.get("params", {}))

            elif action == "get_exchange_configs":
                self._get_exchange_configs(req_id)

            elif action == "set_spread_threshold":
                self._set_spread_threshold(req_id, req.get("params", {}))

            else:
                self._respond(req_id, False, error=f"Unknown action: {action}")

        except Exception as e:
            tb = traceback.format_exc()
            print(f"[EngineServer] Request error: {tb}", file=sys.stderr)
            self._respond(req_id, False, error=str(e))

    def _run_backtest(self, req_id: str, params: Dict[str, Any]) -> None:
        csv_path = params.get("csvPath")
        if not csv_path or not os.path.exists(csv_path):
            self._respond(req_id, False, error="CSV file not found")
            return

        timeframe = params.get("timeframe", "1min")
        strategy_name = params.get("strategy", "ma")

        try:
            self._stream("progress", {"stage": "loading_csv", "message": "加载 CSV 数据中..."})
            bars = load_csv_bars(csv_path, timeframe=timeframe)
            self._log("info", f"Loaded {len(bars)} bars from {csv_path}")
        except Exception as e:
            self._respond(req_id, False, error=f"Failed to load CSV: {e}")
            return

        self._stream("progress", {
            "stage": "data_loaded",
            "message": f"数据加载完成，共 {len(bars)} 根 K 线",
            "barCount": len(bars),
        })

        if strategy_name == "ma":
            strategy = MAStrategy(
                fast_ma=int(params.get("fastMa", 5)),
                slow_ma=int(params.get("slowMa", 20)),
                initial_capital=float(params.get("initialCapital", 100000)),
                commission=float(params.get("commission", 0.0003)),
                slippage=float(params.get("slippage", 0.0)),
                stop_loss_pct=float(params.get("stopLossPct", 0.02)),
                take_profit_pct=float(params.get("takeProfitPct", 0.05)),
            )
        else:
            self._respond(req_id, False, error=f"Unknown strategy: {strategy_name}")
            return

        def on_progress(processed, total):
            pct = round(processed / max(total, 1) * 100, 2)
            self._stream("progress", {
                "stage": "running",
                "processed": processed,
                "total": total,
                "percent": pct,
                "message": f"回测中 {processed}/{total} ({pct}%)",
            })

        def on_signal(signal):
            self._stream("signal", signal)

        try:
            self._stream("progress", {"stage": "running", "message": "开始执行回测..."})
            result = strategy.run(bars, on_signal=on_signal, on_progress=on_progress)
            self._stream("progress", {"stage": "finished", "message": "回测完成，正在汇总结果..."})
            self._stream("result", {
                "summary": result["summary"],
                "trades": result["trades"],
            })
            self._stream("klines", result["klines"])
            self._stream("indicators", {
                "ma_fast": result["ma_fast"],
                "ma_slow": result["ma_slow"],
            })
            self._stream("equity_curve", result["equity_curve"])
            self._respond(req_id, True, {"summary": result["summary"]})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[EngineServer] Backtest error: {tb}", file=sys.stderr)
            self._respond(req_id, False, error=f"Backtest failed: {e}")

    def _preview_csv(self, req_id: str, params: Dict[str, Any]) -> None:
        csv_path = params.get("csvPath")
        if not csv_path or not os.path.exists(csv_path):
            self._respond(req_id, False, error="CSV file not found")
            return
        try:
            import pandas as pd
            df = pd.read_csv(csv_path, nrows=10)
            total = sum(1 for _ in open(csv_path)) - 1
            self._respond(req_id, True, {
                "columns": list(df.columns),
                "rows": df.head(5).values.tolist(),
                "totalRows": total,
                "sizeBytes": os.path.getsize(csv_path),
            })
        except Exception as e:
            self._respond(req_id, False, error=str(e))

    def _generate_sample(self, req_id: str, params: Dict[str, Any]) -> None:
        output_path = params.get("outputPath")
        if not output_path:
            self._respond(req_id, False, error="Output path required")
            return

        import pandas as pd
        import numpy as np

        days = int(params.get("days", 120))
        symbol = params.get("symbol", "AU0")
        np.random.seed(42)

        rows = []
        base_price = 480.0
        start_ts_ms = 1700000000000
        ms_per_minute = 60 * 1000
        bars_per_day = 240

        current_price = base_price
        for day in range(days):
            day_ts = start_ts_ms + day * 86400 * 1000
            for bar in range(bars_per_day):
                ts = day_ts + bar * ms_per_minute
                volatility = 0.0015
                drift = np.random.normal(0, volatility)
                open_p = current_price
                high_p = open_p * (1 + abs(np.random.normal(0, volatility * 1.5)))
                low_p = open_p * (1 - abs(np.random.normal(0, volatility * 1.5)))
                close_p = open_p * (1 + drift)
                high_p = max(high_p, open_p, close_p)
                low_p = min(low_p, open_p, close_p)
                volume = int(np.random.uniform(100, 2000))
                rows.append({
                    "timestamp": ts,
                    "open": round(open_p, 2),
                    "high": round(high_p, 2),
                    "low": round(low_p, 2),
                    "close": round(close_p, 2),
                    "volume": volume,
                })
                current_price = close_p

        df = pd.DataFrame(rows)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        df.to_csv(output_path, index=False)
        self._respond(req_id, True, {
            "path": output_path,
            "rows": len(df),
            "symbol": symbol,
        })

    def _on_md_tick(self, tick: Tick) -> None:
        key = f"{tick.exchange}_{tick.symbol}"
        with self._md_lock:
            if not self._md_running:
                return
            now_ms = int(tick.timestamp)
            last = self._last_tick_sent.get(key, 0)
            if now_ms - last < self._tick_rate_limit_ms:
                return
            self._last_tick_sent[key] = now_ms
            self._md_snap_queue.append(tick.to_dict())

    def _on_md_alert(self, alert: SpreadAlert) -> None:
        with self._md_lock:
            if not self._md_running:
                return
        alert_dict = alert.to_dict()
        threshold_pct = alert_dict.pop("threshold_pct", False)
        alert_dict["threshold_type"] = "bp" if threshold_pct else "absolute"
        self._stream("md_alert", alert_dict)

    def _md_send_worker(self) -> None:
        import time
        while True:
            with self._md_lock:
                if not self._md_running:
                    break
                queue_snapshot = self._md_snap_queue
                self._md_snap_queue = []
            if queue_snapshot:
                self._stream("md_tick_batch", queue_snapshot)
            time.sleep(0.05)

    def _start_monitor(self, req_id: str, params: Dict[str, Any]) -> None:
        with self._md_lock:
            if self.md_engine is not None and self._md_running:
                self._respond(req_id, True, {"running": True, "message": "Already running"})
                return

            if self.md_engine is None:
                self.md_engine = MarketDataEngine(
                    on_tick=self._on_md_tick,
                    on_alert=self._on_md_alert,
                )

            threshold = float(params.get("threshold", 20))
            threshold_type = params.get("threshold_type", "bp")
            use_pct = threshold_type == "bp"
            cooldown_ms = int(params.get("cooldown_ms", 5000))
            exchanges = params.get("exchanges")

            self.md_engine.set_threshold(threshold, use_pct)
            self.md_engine.set_cooldown(cooldown_ms)
            self._md_running = True
            self._last_tick_sent.clear()
            self._md_snap_queue.clear()

            self.md_engine.start(exchange_ids=exchanges)

            self._md_send_thread = threading.Thread(
                target=self._md_send_worker,
                daemon=True,
                name="MD-Send",
            )
            self._md_send_thread.start()

        configs = self.md_engine.get_exchange_configs()
        exchange_list = [
            {"exchange": exch_id, "name": cfg["name"], "symbols": cfg["symbols"]}
            for exch_id, cfg in configs.items()
        ]
        self._respond(req_id, True, {
            "running": True,
            "gateway_count": len(configs),
            "exchanges": exchange_list,
            "threshold": threshold,
            "threshold_type": threshold_type,
            "cooldown_ms": cooldown_ms,
        })
        self._log("info", "Market data monitor started")

    def _stop_monitor(self, req_id: str) -> None:
        with self._md_lock:
            self._md_running = False
            if self.md_engine is not None:
                self.md_engine.stop()
                self.md_engine = None
            if self._md_send_thread is not None:
                self._md_send_thread = None
            self._md_snap_queue.clear()
            self._last_tick_sent.clear()
        self._respond(req_id, True, {"running": False})
        self._log("info", "Market data monitor stopped")

    def _get_monitor_snapshot(self, req_id: str) -> None:
        with self._md_lock:
            if self.md_engine is None or not self._md_running:
                self._respond(req_id, True, {"running": False, "snapshot": {}})
                return
            snapshot = self.md_engine.get_latest_snapshot()
        self._respond(req_id, True, {"running": True, "snapshot": snapshot})

    def _get_alert_history(self, req_id: str, params: Dict[str, Any]) -> None:
        limit = int(params.get("limit", 100))
        with self._md_lock:
            if self.md_engine is None:
                self._respond(req_id, True, {"alerts": []})
                return
            alerts = self.md_engine.get_alert_history(limit=limit)
        self._respond(req_id, True, {"alerts": alerts})

    def _get_exchange_configs(self, req_id: str) -> None:
        from market_data_engine import EXCHANGE_CONFIGS
        exchange_list = []
        for exch_id, cfg in EXCHANGE_CONFIGS.items():
            exchange_list.append({
                "exchange": exch_id,
                "name": cfg["name"],
                "symbols": list(cfg["symbols"]),
            })
        self._respond(req_id, True, {"exchanges": exchange_list})

    def _set_spread_threshold(self, req_id: str, params: Dict[str, Any]) -> None:
        threshold = float(params.get("threshold", 20))
        threshold_type = params.get("threshold_type", "bp")
        use_pct = threshold_type == "bp"
        cooldown_ms = int(params.get("cooldown_ms", 5000))
        with self._md_lock:
            if self.md_engine is not None:
                self.md_engine.set_threshold(threshold, use_pct)
                self.md_engine.set_cooldown(cooldown_ms)
        self._respond(req_id, True, {
            "threshold": threshold,
            "threshold_type": threshold_type,
            "cooldown_ms": cooldown_ms,
        })

    def _read_lines(self, sock: socket.socket):
        buf = b""
        while self._running:
            try:
                data = sock.recv(65536)
                if not data:
                    print("[EngineServer] Client disconnected")
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line_s = line.decode("utf-8").strip()
                    if not line_s:
                        continue
                    try:
                        req = json.loads(line_s)
                        threading.Thread(
                            target=self._handle_request,
                            args=(req,),
                            daemon=True,
                        ).start()
                    except json.JSONDecodeError as e:
                        print(f"[EngineServer] JSON decode error: {e}: {line_s[:200]}", file=sys.stderr)
            except Exception as e:
                print(f"[EngineServer] Read error: {e}", file=sys.stderr)
                break

    def start(self) -> None:
        self._running = True
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(1)
        print(f"[EngineServer] Listening on {self.host}:{self.port}", flush=True)

        while self._running:
            try:
                client, addr = self.server_socket.accept()
                print(f"[EngineServer] Client connected from {addr}", flush=True)
                self.client_socket = client
                self._read_lines(client)
                with self._md_lock:
                    self._md_running = False
                    if self.md_engine is not None:
                        try:
                            self.md_engine.stop()
                        except Exception:
                            pass
                        self.md_engine = None
                    self._md_snap_queue.clear()
                self.client_socket = None
            except Exception as e:
                if self._running:
                    print(f"[EngineServer] Accept error: {e}", file=sys.stderr)
                break

    def stop(self) -> None:
        self._running = False
        if self.client_socket:
            try:
                self.client_socket.close()
            except Exception:
                pass
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=52525)
    args = parser.parse_args()

    server = EngineServer(host=args.host, port=args.port)
    try:
        server.start()
    except KeyboardInterrupt:
        print("[EngineServer] Shutting down...")
        server.stop()


if __name__ == "__main__":
    main()
