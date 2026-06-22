import pandas as pd
import numpy as np
from typing import Callable, Optional, List, Dict, Any, Tuple


class MAStrategy:
    def __init__(
        self,
        fast_ma: int = 5,
        slow_ma: int = 20,
        initial_capital: float = 100000.0,
        commission: float = 0.0003,
        slippage: float = 0.0,
        stop_loss_pct: float = 0.02,
        take_profit_pct: float = 0.05,
    ):
        self.fast_ma = fast_ma
        self.slow_ma = slow_ma
        self.initial_capital = initial_capital
        self.commission = commission
        self.slippage = slippage
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct

    def run(
        self,
        bars: pd.DataFrame,
        on_signal: Optional[Callable] = None,
        on_progress: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        if bars.empty:
            raise ValueError("No bar data provided")

        df = bars.copy()
        df.sort_values("timestamp", inplace=True)
        df.reset_index(drop=True, inplace=True)

        df["ma_fast"] = df["close"].rolling(window=self.fast_ma, min_periods=self.fast_ma).mean()
        df["ma_slow"] = df["close"].rolling(window=self.slow_ma, min_periods=self.slow_ma).mean()

        capital = float(self.initial_capital)
        position = 0.0
        avg_cost = 0.0
        equity = float(self.initial_capital)

        signals: List[Dict[str, Any]] = []
        equity_curve: List[Tuple[int, float]] = []
        trades: List[Dict[str, Any]] = []

        total_bars = len(df)
        open_trade = None

        pending_order = None

        for i in range(total_bars):
            row = df.iloc[i]
            ts = int(row["timestamp"])
            open_price = float(row["open"])
            high = float(row["high"])
            low = float(row["low"])
            close = float(row["close"])

            if on_progress and i % max(1, total_bars // 100) == 0:
                on_progress(i, total_bars)

            ma_fast = float(row["ma_fast"]) if not np.isnan(row["ma_fast"]) else None
            ma_slow = float(row["ma_slow"]) if not np.isnan(row["ma_slow"]) else None

            exit_reason = None
            exec_price = None

            if pending_order is not None:
                if pending_order["side"] == "buy" and position == 0:
                    buy_price = open_price * (1 + self.slippage)
                    fee = buy_price * self.commission
                    if capital > fee:
                        tradable_capital = capital - fee
                        qty = tradable_capital / buy_price
                        if qty > 0:
                            total_cost = qty * buy_price + fee
                            if total_cost <= capital:
                                position = qty
                                avg_cost = buy_price
                                capital -= total_cost
                                signal = {
                                    "index": i,
                                    "timestamp": ts,
                                    "type": "buy",
                                    "price": round(buy_price, 4),
                                    "qty": round(qty, 6),
                                    "reason": pending_order["reason"],
                                    "exec_at": "open",
                                }
                                signals.append(signal)
                                open_trade = {
                                    "entry_index": i,
                                    "entry_ts": ts,
                                    "entry_price": buy_price,
                                    "qty": qty,
                                }
                                if on_signal:
                                    on_signal(signal)
                elif pending_order["side"] == "sell" and position > 0 and open_trade is not None:
                    sell_price = open_price * (1 - self.slippage)
                    qty = position
                    revenue = qty * sell_price
                    fee = revenue * self.commission
                    net_revenue = revenue - fee
                    capital += net_revenue
                    pnl = (sell_price - open_trade["entry_price"]) * qty - fee - (open_trade["entry_price"] * qty * self.commission)
                    trades.append({
                        "entry_index": open_trade["entry_index"],
                        "entry_ts": open_trade["entry_ts"],
                        "entry_price": round(open_trade["entry_price"], 4),
                        "exit_index": i,
                        "exit_ts": ts,
                        "exit_price": round(sell_price, 4),
                        "qty": round(qty, 6),
                        "pnl": round(pnl, 4),
                        "pnl_pct": round((sell_price / open_trade["entry_price"] - 1) * 100, 4),
                        "exit_reason": pending_order["reason"],
                    })
                    signal = {
                        "index": i,
                        "timestamp": ts,
                        "type": "sell",
                        "price": round(sell_price, 4),
                        "qty": round(qty, 6),
                        "reason": pending_order["reason"],
                        "pnl": round(pnl, 4),
                        "exec_at": "open",
                    }
                    signals.append(signal)
                    if on_signal:
                        on_signal(signal)
                    position = 0.0
                    avg_cost = 0.0
                    open_trade = None
                pending_order = None

            if position > 0 and open_trade is not None and exit_reason is None:
                entry_price = open_trade["entry_price"]
                stop_price = entry_price * (1 - self.stop_loss_pct)
                target_price = entry_price * (1 + self.take_profit_pct)

                hit_stop = low <= stop_price
                hit_target = high >= target_price

                if hit_stop and hit_target:
                    dist_to_stop = abs(open_price - stop_price)
                    dist_to_target = abs(open_price - target_price)
                    if dist_to_stop <= dist_to_target:
                        exec_price = stop_price * (1 - self.slippage)
                        exit_reason = "stop_loss"
                    else:
                        exec_price = target_price * (1 - self.slippage)
                        exit_reason = "take_profit"
                elif hit_stop:
                    exec_price = stop_price * (1 - self.slippage)
                    exit_reason = "stop_loss"
                elif hit_target:
                    exec_price = target_price * (1 - self.slippage)
                    exit_reason = "take_profit"

            if exit_reason is not None and position > 0 and open_trade is not None:
                qty = position
                fee = abs(exec_price * qty * self.commission)
                if exec_price > 0:
                    revenue = qty * exec_price
                    net_revenue = revenue - fee
                    capital += net_revenue
                    pnl = (exec_price - open_trade["entry_price"]) * qty - fee - (open_trade["entry_price"] * qty * self.commission)
                else:
                    pnl = -capital
                    capital = 0.0

                trades.append({
                    "entry_index": open_trade["entry_index"],
                    "entry_ts": open_trade["entry_ts"],
                    "entry_price": round(open_trade["entry_price"], 4),
                    "exit_index": i,
                    "exit_ts": ts,
                    "exit_price": round(exec_price, 4),
                    "qty": round(qty, 6),
                    "pnl": round(pnl, 4),
                    "pnl_pct": round((exec_price / open_trade["entry_price"] - 1) * 100, 4),
                    "exit_reason": exit_reason,
                })
                signal = {
                    "index": i,
                    "timestamp": ts,
                    "type": "sell",
                    "price": round(exec_price, 4),
                    "qty": round(qty, 6),
                    "reason": exit_reason,
                    "pnl": round(pnl, 4),
                    "exec_at": "intraday",
                }
                signals.append(signal)
                if on_signal:
                    on_signal(signal)
                position = 0.0
                avg_cost = 0.0
                open_trade = None
                pending_order = None

            if i >= self.slow_ma and ma_fast is not None and ma_slow is not None:
                prev_ma_fast = float(df.iloc[i - 1]["ma_fast"]) if i > 0 else ma_fast
                prev_ma_slow = float(df.iloc[i - 1]["ma_slow"]) if i > 0 else ma_slow

                if position == 0 and pending_order is None:
                    if prev_ma_fast <= prev_ma_slow and ma_fast > ma_slow:
                        pending_order = {"side": "buy", "reason": "ma_cross_up"}

                elif position > 0 and pending_order is None:
                    if prev_ma_fast >= prev_ma_slow and ma_fast < ma_slow:
                        pending_order = {"side": "sell", "reason": "ma_cross_down"}

            equity = capital + position * close
            equity_curve.append((ts, round(equity, 4)))

        if position > 0 and open_trade is not None:
            last_price = float(df.iloc[-1]["close"])
            exec_price = last_price * (1 - self.slippage)
            qty = position
            revenue = qty * exec_price
            fee = revenue * self.commission
            net_revenue = revenue - fee
            capital += net_revenue
            pnl = (exec_price - open_trade["entry_price"]) * qty - fee - (open_trade["entry_price"] * qty * self.commission)
            ts = int(df.iloc[-1]["timestamp"])
            i = total_bars - 1
            trades.append({
                "entry_index": open_trade["entry_index"],
                "entry_ts": open_trade["entry_ts"],
                "entry_price": round(open_trade["entry_price"], 4),
                "exit_index": i,
                "exit_ts": ts,
                "exit_price": round(exec_price, 4),
                "qty": round(qty, 6),
                "pnl": round(pnl, 4),
                "pnl_pct": round((exec_price / open_trade["entry_price"] - 1) * 100, 4),
                "exit_reason": "force_close",
            })
            signals.append({
                "index": i,
                "timestamp": ts,
                "type": "sell",
                "price": round(exec_price, 4),
                "qty": round(qty, 6),
                "reason": "force_close",
                "pnl": round(pnl, 4),
                "exec_at": "close",
            })
            if on_signal:
                on_signal(signals[-1])
            position = 0.0
            equity = capital

        if on_progress:
            on_progress(total_bars, total_bars)

        result = self._calculate_metrics(df, equity_curve, trades, signals)
        return result

    def _calculate_metrics(
        self,
        df: pd.DataFrame,
        equity_curve: List[Tuple[int, float]],
        trades: List[Dict[str, Any]],
        signals: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        total_bars = len(df)
        if total_bars < 2:
            return {}

        eq_arr = np.array([e[1] for e in equity_curve], dtype=np.float64)
        final_equity = eq_arr[-1]
        total_return = (final_equity / self.initial_capital - 1) * 100

        ts_start = equity_curve[0][0]
        ts_end = equity_curve[-1][0]
        days = max((ts_end - ts_start) / 86400000, 0.001)
        ratio = final_equity / self.initial_capital
        if ratio > 0 and days > 0:
            annual_return = (np.sign(ratio) * (abs(ratio) ** (365.0 / days)) - 1) * 100
            if not np.isfinite(annual_return):
                annual_return = 0.0
        else:
            annual_return = 0.0

        peak = np.maximum.accumulate(eq_arr)
        drawdown = (eq_arr - peak) / peak
        max_drawdown = float(np.min(drawdown) * 100)

        daily_ts = []
        daily_eq = []
        current_day = None
        for ts, eq in equity_curve:
            day = ts // 86400000
            if day != current_day:
                daily_ts.append(ts)
                daily_eq.append(eq)
                current_day = day

        daily_returns = []
        for i in range(1, len(daily_eq)):
            daily_returns.append(daily_eq[i] / daily_eq[i - 1] - 1)

        sharpe = 0.0
        sortino = 0.0
        if len(daily_returns) > 1:
            dr_arr = np.array(daily_returns, dtype=np.float64)
            mean_r = float(np.mean(dr_arr))
            std_r = float(np.std(dr_arr, ddof=1))
            if std_r > 0:
                sharpe = (mean_r / std_r) * np.sqrt(252)
            neg_returns = dr_arr[dr_arr < 0]
            if len(neg_returns) > 0:
                std_neg = float(np.std(neg_returns, ddof=1))
                if std_neg > 0:
                    sortino = (mean_r / std_neg) * np.sqrt(252)

        win_count = 0
        loss_count = 0
        total_pnl = 0.0
        max_win = 0.0
        max_loss = 0.0
        for t in trades:
            pnl = t["pnl"]
            total_pnl += pnl
            if pnl >= 0:
                win_count += 1
                max_win = max(max_win, pnl)
            else:
                loss_count += 1
                max_loss = min(max_loss, pnl)

        trade_count = len(trades)
        win_rate = (win_count / trade_count * 100) if trade_count > 0 else 0.0
        avg_win = (max_win / win_count) if win_count > 0 else 0.0
        avg_loss = (max_loss / loss_count) if loss_count > 0 else 0.0
        profit_factor = abs(avg_win / avg_loss) if avg_loss != 0 else 0.0

        klines = []
        for i in range(total_bars):
            r = df.iloc[i]
            klines.append([
                int(r["timestamp"]),
                float(r["open"]),
                float(r["high"]),
                float(r["low"]),
                float(r["close"]),
                float(r.get("volume", 0)),
            ])

        ma_fast_list = []
        ma_slow_list = []
        for i in range(total_bars):
            ts = int(df.iloc[i]["timestamp"])
            mf = df.iloc[i]["ma_fast"]
            ms = df.iloc[i]["ma_slow"]
            if not np.isnan(mf):
                ma_fast_list.append([ts, round(float(mf), 4)])
            if not np.isnan(ms):
                ma_slow_list.append([ts, round(float(ms), 4)])

        return {
            "summary": {
                "initial_capital": round(self.initial_capital, 2),
                "final_equity": round(final_equity, 2),
                "total_return_pct": round(total_return, 4),
                "annual_return_pct": round(annual_return, 4),
                "max_drawdown_pct": round(max_drawdown, 4),
                "sharpe_ratio": round(sharpe, 4),
                "sortino_ratio": round(sortino, 4),
                "trade_count": trade_count,
                "win_count": win_count,
                "loss_count": loss_count,
                "win_rate_pct": round(win_rate, 4),
                "total_pnl": round(total_pnl, 4),
                "avg_win_pnl": round(avg_win, 4),
                "avg_loss_pnl": round(avg_loss, 4),
                "profit_factor": round(profit_factor, 4),
                "bar_count": total_bars,
            },
            "klines": klines,
            "ma_fast": ma_fast_list,
            "ma_slow": ma_slow_list,
            "signals": signals,
            "trades": trades,
            "equity_curve": equity_curve,
        }


def load_csv_bars(csv_path: str, timeframe: str = "1min") -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    col_map = {}
    for c in df.columns:
        lc = c.strip().lower()
        if lc in ("timestamp", "time", "datetime", "date", "trade_time"):
            col_map[c] = "timestamp"
        elif lc in ("open", "o"):
            col_map[c] = "open"
        elif lc in ("high", "h", "highest"):
            col_map[c] = "high"
        elif lc in ("low", "l", "lowest"):
            col_map[c] = "low"
        elif lc in ("close", "c", "last"):
            col_map[c] = "close"
        elif lc in ("volume", "v", "vol"):
            col_map[c] = "volume"
        elif lc in ("price", "last_price", "tick_price"):
            col_map[c] = "price"
    df = df.rename(columns=col_map)

    if "timestamp" not in df.columns:
        raise ValueError("CSV must contain a timestamp column")

    ts_series = df["timestamp"]
    sample = ts_series.iloc[0] if len(df) > 0 else ""
    if isinstance(sample, str):
        try:
            df["timestamp"] = pd.to_datetime(df["timestamp"]).astype("int64") // 10**6
        except Exception:
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms").astype("int64") // 10**6
    else:
        sample_val = float(sample)
        if sample_val > 10**12:
            df["timestamp"] = df["timestamp"].astype("int64")
        elif sample_val > 10**9:
            df["timestamp"] = df["timestamp"].astype("int64") * 1000

    if "price" in df.columns and "close" not in df.columns:
        df["close"] = df["price"]
        df["open"] = df["price"]
        df["high"] = df["price"]
        df["low"] = df["price"]

    for col in ["open", "high", "low", "close"]:
        if col not in df.columns:
            raise ValueError(f"CSV must contain {col} column (or tick price data)")
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["timestamp", "open", "high", "low", "close"])

    if timeframe and timeframe != "tick":
        dt_idx = pd.to_datetime(df["timestamp"], unit="ms")
        work_df = df.drop(columns=["timestamp"]).copy()
        work_df.index = dt_idx
        period_map = {
            "1s": "1s", "5s": "5s", "15s": "15s", "30s": "30s",
            "1min": "1min", "5min": "5min", "15min": "15min", "30min": "30min",
            "1h": "1h", "4h": "4h", "1d": "1D",
        }
        rule = period_map.get(timeframe, timeframe)
        agg_dict = {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
        }
        if "volume" in work_df.columns:
            work_df["volume"] = pd.to_numeric(work_df["volume"], errors="coerce").fillna(0)
            agg_dict["volume"] = "sum"
        resampled = work_df.resample(rule).agg(agg_dict).dropna()
        resampled["timestamp"] = resampled.index.astype("int64") // 10**6
        resampled.reset_index(drop=True, inplace=True)
        if "volume" not in resampled.columns:
            resampled["volume"] = 0
        return resampled[["timestamp", "open", "high", "low", "close", "volume"]].reset_index(drop=True)

    if "volume" not in df.columns:
        df["volume"] = 0
    else:
        df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0)

    return df[["timestamp", "open", "high", "low", "close", "volume"]].reset_index(drop=True)
