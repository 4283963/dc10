import threading
import time
import random
import queue
from dataclasses import dataclass, field
from typing import Callable, Optional, List, Dict, Any, Deque
from collections import deque
import json


@dataclass
class Tick:
    timestamp: int
    exchange: str
    symbol: str
    bid1_price: float
    bid1_qty: float
    ask1_price: float
    ask1_qty: float
    last_price: float
    volume: float = 0.0
    high: float = 0.0
    low: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "exchange": self.exchange,
            "symbol": self.symbol,
            "bid1_price": self.bid1_price,
            "bid1_qty": self.bid1_qty,
            "ask1_price": self.ask1_price,
            "ask1_qty": self.ask1_qty,
            "last_price": self.last_price,
            "volume": self.volume,
            "high": self.high,
            "low": self.low,
            "spread": round(self.ask1_price - self.bid1_price, 4),
            "spread_pct": round((self.ask1_price / self.bid1_price - 1) * 10000, 2),
        }


@dataclass
class SpreadAlert:
    timestamp: int
    exchange: str
    symbol: str
    bid1_price: float
    ask1_price: float
    spread: float
    spread_pct: float
    threshold: float
    threshold_pct: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "exchange": self.exchange,
            "symbol": self.symbol,
            "bid1_price": self.bid1_price,
            "ask1_price": self.ask1_price,
            "spread": self.spread,
            "spread_pct": self.spread_pct,
            "threshold": self.threshold,
            "threshold_pct": self.threshold_pct,
        }


EXCHANGE_CONFIGS = {
    "SHFE": {
        "name": "上期所",
        "symbols": ["AU0", "AG0", "CU0"],
        "base_price": {"AU0": 480.0, "AG0": 6200.0, "CU0": 68000.0},
        "tick_size": {"AU0": 0.02, "AG0": 1.0, "CU0": 10.0},
    },
    "DCE": {
        "name": "大商所",
        "symbols": ["I0", "M0", "P0"],
        "base_price": {"I0": 820.0, "M0": 2980.0, "P0": 6650.0},
        "tick_size": {"I0": 0.5, "M0": 1.0, "P0": 2.0},
    },
    "CZCE": {
        "name": "郑商所",
        "symbols": ["SR0", "TA0", "MA0"],
        "base_price": {"SR0": 5650.0, "TA0": 5820.0, "MA0": 2480.0},
        "tick_size": {"SR0": 1.0, "TA0": 2.0, "MA0": 1.0},
    },
}


class MockExchangeGateway:
    """
    模拟交易所 WebSocket 网关。
    真实场景下这里会接入交易所的实际 WebSocket API。
    """

    def __init__(self, exchange_id: str, tick_queue: queue.Queue, interval_ms: int = 200):
        self.exchange_id = exchange_id
        self.config = EXCHANGE_CONFIGS[exchange_id]
        self.tick_queue = tick_queue
        self.interval_ms = interval_ms
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_prices: Dict[str, Dict[str, float]] = {}
        self._init_prices()

    def _init_prices(self) -> None:
        for symbol in self.config["symbols"]:
            base = self.config["base_price"][symbol]
            self._last_prices[symbol] = {
                "last": base,
                "high": base,
                "low": base,
                "bid": base - self.config["tick_size"][symbol],
                "ask": base + self.config["tick_size"][symbol],
                "volume": 0,
            }

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name=f"GW-{self.exchange_id}")
        self._thread.start()
        print(f"[Gateway {self.exchange_id}] Started", flush=True)

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None
        print(f"[Gateway {self.exchange_id}] Stopped", flush=True)

    def _run(self) -> None:
        while self._running:
            try:
                for symbol in self.config["symbols"]:
                    if not self._running:
                        break
                    tick = self._generate_tick(symbol)
                    self.tick_queue.put(tick)
                time.sleep(self.interval_ms / 1000.0)
            except Exception as e:
                print(f"[Gateway {self.exchange_id}] Error: {e}", flush=True)
                time.sleep(0.1)

    def _generate_tick(self, symbol: str) -> Tick:
        tick_size = self.config["tick_size"][symbol]
        state = self._last_prices[symbol]

        drift = random.choice([-tick_size, 0, tick_size]) * random.choice([0, 1, 1, 2])
        new_last = state["last"] + drift
        spread_ticks = random.choice([1, 1, 1, 2, 2, 3, 5, 10])
        spread_ticks = max(1, spread_ticks)
        if random.random() < 0.02:
            spread_ticks = random.randint(8, 30)

        bid = new_last - tick_size * spread_ticks
        ask = new_last + tick_size * spread_ticks

        state["last"] = new_last
        state["high"] = max(state["high"], new_last)
        state["low"] = min(state["low"], new_last)
        state["bid"] = bid
        state["ask"] = ask
        state["volume"] += random.randint(1, 20)

        return Tick(
            timestamp=int(time.time() * 1000),
            exchange=self.exchange_id,
            symbol=symbol,
            bid1_price=round(bid, 4),
            bid1_qty=round(random.uniform(1, 50), 2),
            ask1_price=round(ask, 4),
            ask1_qty=round(random.uniform(1, 50), 2),
            last_price=round(new_last, 4),
            volume=state["volume"],
            high=round(state["high"], 4),
            low=round(state["low"], 4),
        )


class MarketDataEngine:
    """
    行情引擎：
    - 管理多路交易所网关
    - 维护内存中的最新行情快照
    - 检测盘口价差异常并触发报警
    - 去重报警（同一品种同一报警间隔内不重复触发）
    """

    def __init__(self, on_tick: Optional[Callable[[Tick], None]] = None,
                 on_alert: Optional[Callable[[SpreadAlert], None]] = None):
        self.tick_queue: queue.Queue = queue.Queue(maxsize=10000)
        self.gateways: Dict[str, MockExchangeGateway] = {}
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None
        self._dispatch_thread: Optional[threading.Thread] = None

        self._latest_snapshots: Dict[str, Dict[str, Tick]] = {}
        self._alert_history: Deque[SpreadAlert] = deque(maxlen=1000)
        self._alert_cooldown: Dict[str, int] = {}

        self.spread_threshold = 0.02
        self.spread_threshold_pct = 0.5
        self.use_pct_threshold = False
        self.alert_cooldown_ms = 5000
        self._alert_handlers_lock = threading.Lock()

        self.on_tick = on_tick
        self.on_alert = on_alert

        for exch_id in EXCHANGE_CONFIGS:
            self._latest_snapshots[exch_id] = {}

    def set_threshold(self, threshold: float, use_pct: bool = False) -> None:
        self.use_pct_threshold = use_pct
        if use_pct:
            self.spread_threshold_pct = threshold
        else:
            self.spread_threshold = threshold
        print(f"[MD] Spread threshold set: {threshold}{'%' if use_pct else ''}", flush=True)

    def set_cooldown(self, cooldown_ms: int) -> None:
        self.alert_cooldown_ms = max(500, cooldown_ms)
        print(f"[MD] Alert cooldown set: {self.alert_cooldown_ms}ms", flush=True)

    def start(self, exchange_ids: Optional[List[str]] = None) -> None:
        if self._running:
            return
        exchange_ids = exchange_ids or list(EXCHANGE_CONFIGS.keys())
        self._running = True

        for exch_id in exchange_ids:
            if exch_id in EXCHANGE_CONFIGS and exch_id not in self.gateways:
                gw = MockExchangeGateway(exch_id, self.tick_queue, interval_ms=200)
                gw.start()
                self.gateways[exch_id] = gw

        self._worker_thread = threading.Thread(target=self._process_queue, daemon=True, name="MD-Worker")
        self._worker_thread.start()
        print(f"[MD] MarketDataEngine started with gateways: {exchange_ids}", flush=True)

    def stop(self) -> None:
        self._running = False
        for gw in self.gateways.values():
            gw.stop()
        self.gateways.clear()
        if self._worker_thread:
            self._worker_thread.join(timeout=2.0)
            self._worker_thread = None
        self.tick_queue.queue.clear()
        print(f"[MD] MarketDataEngine stopped", flush=True)

    def _process_queue(self) -> None:
        while self._running:
            try:
                tick = self.tick_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            try:
                exch_id = tick.exchange
                symbol = tick.symbol
                self._latest_snapshots[exch_id][symbol] = tick

                self._check_spread_alert(tick)

                if self.on_tick:
                    try:
                        self.on_tick(tick)
                    except Exception as e:
                        print(f"[MD] on_tick error: {e}", flush=True)
            except Exception as e:
                print(f"[MD] Process tick error: {e}", flush=True)

    def _check_spread_alert(self, tick: Tick) -> None:
        spread = tick.ask1_price - tick.bid1_price
        spread_pct = (tick.ask1_price / tick.bid1_price - 1) * 10000

        if self.use_pct_threshold:
            exceeds = spread_pct > self.spread_threshold_pct
            threshold_val = self.spread_threshold_pct
        else:
            exceeds = spread > self.spread_threshold
            threshold_val = self.spread_threshold

        if not exceeds:
            return

        now = int(time.time() * 1000)
        key = f"{tick.exchange}_{tick.symbol}"
        last_alert_ts = self._alert_cooldown.get(key, 0)
        if now - last_alert_ts < self.alert_cooldown_ms:
            return

        alert = SpreadAlert(
            timestamp=now,
            exchange=tick.exchange,
            symbol=tick.symbol,
            bid1_price=tick.bid1_price,
            ask1_price=tick.ask1_price,
            spread=round(spread, 4),
            spread_pct=round(spread_pct, 2),
            threshold=threshold_val,
            threshold_pct=self.use_pct_threshold,
        )

        self._alert_history.append(alert)
        self._alert_cooldown[key] = now

        print(f"[ALERT] {tick.exchange} {tick.symbol} spread={spread:.4f} "
              f"({spread_pct:.1f}bp) exceeds threshold={threshold_val}", flush=True)

        if self.on_alert:
            try:
                self.on_alert(alert)
            except Exception as e:
                print(f"[MD] on_alert error: {e}", flush=True)

    def get_latest_snapshot(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        result = {}
        for exch_id, symbols in self._latest_snapshots.items():
            result[exch_id] = {}
            for symbol, tick in symbols.items():
                if tick:
                    result[exch_id][symbol] = tick.to_dict()
        return result

    def get_alert_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        limit = max(1, min(limit, 1000))
        alerts = list(self._alert_history)[-limit:]
        return [a.to_dict() for a in reversed(alerts)]

    def get_exchange_configs(self) -> Dict[str, Any]:
        configs = {}
        for exch_id, cfg in EXCHANGE_CONFIGS.items():
            configs[exch_id] = {
                "name": cfg["name"],
                "symbols": list(cfg["symbols"]),
            }
        return configs
