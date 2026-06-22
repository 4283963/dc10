import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from backtest_engine import MAStrategy, load_csv_bars


def generate_sample_csv(path, days=120, bars_per_day=240, base_price=480.0, seed=42):
    np.random.seed(seed)
    rows = []
    start_ts_ms = 1700000000000
    ms_per_minute = 60 * 1000
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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    df.to_csv(path, index=False)
    print(f"[OK] Generated sample CSV: {path} ({len(df)} rows)")
    return path


def test_backtest_direct(csv_path):
    print(f"\n[TEST] Loading bars from {csv_path} ...")
    bars = load_csv_bars(csv_path, timeframe="1min")
    print(f"[OK] Loaded {len(bars)} bars, t={bars['timestamp'].min()}..{bars['timestamp'].max()}")

    print("\n[TEST] Running MA strategy...")
    progress = [0]
    def on_progress(p, t):
        pct = p / max(t, 1) * 100
        if int(pct) % 25 == 0 and int(pct) != progress[0]:
            progress[0] = int(pct)
            print(f"  progress: {pct:.0f}%  ({p}/{t})")

    received_signals = []
    def on_signal(sig):
        received_signals.append(sig)

    strategy = MAStrategy(
        fast_ma=5,
        slow_ma=20,
        initial_capital=100000.0,
        commission=0.0003,
        slippage=0.0005,
        stop_loss_pct=0.02,
        take_profit_pct=0.05,
    )

    result = strategy.run(bars, on_progress=on_progress, on_signal=on_signal)
    s = result["summary"]

    print(f"\n[RESULT] 回测完成，汇总指标：")
    for k, v in s.items():
        if "pct" in k or "rate" in k:
            print(f"  {k:25s} = {v:.4f}%")
        else:
            print(f"  {k:25s} = {v}")

    print(f"\n[RESULT] 交易信号数: {len(result['signals'])}  |  交易笔数: {len(result['trades'])}")
    print(f"[RESULT] K线数: {len(result['klines'])}  |  MA 快: {len(result['ma_fast'])}  |  MA 慢: {len(result['ma_slow'])}")
    print(f"[RESULT] 权益曲线点数: {len(result['equity_curve'])}")

    if len(result["trades"]) > 0:
        print("\n[RESULT] 最近 5 笔交易:")
        for t in result["trades"][-5:]:
            ts = pd.to_datetime(t["exit_ts"], unit="ms").strftime("%m-%d %H:%M")
            pnl_color = "🟢" if t["pnl"] >= 0 else "🔴"
            print(f"  {pnl_color} {ts}  PnL={t['pnl']:+.2f}  ({t['pnl_pct']:+.2f}%)  reason={t['exit_reason']}")

    assert len(result["klines"]) == len(bars), "K线数量不匹配"
    assert len(result["signals"]) == len(received_signals), "信号数量不匹配"
    assert result["equity_curve"][-1][0] == bars["timestamp"].iloc[-1], "权益曲线时间不对齐"
    assert "final_equity" in s and "total_return_pct" in s, "缺少关键指标"

    print("\n✅ All assertions passed! Core engine works correctly.")


if __name__ == "__main__":
    out_path = "/Users/kl/Documents/trae_projects2/dc10/sample_data/AU0_120d.csv"
    generate_sample_csv(out_path)
    test_backtest_direct(out_path)
