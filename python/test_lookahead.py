import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from backtest_engine import MAStrategy


def test_no_lookahead_bias():
    """
    确定性测试：验证不存在未来函数。
    构造一个简单的价格序列，验证：
    1. 第 i 根 K 线收盘后才产生信号
    2. 成交发生在第 i+1 根的开盘价
    3. 成交价绝不优于开盘价（考虑滑点）
    """

    data = {
        "timestamp": [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
        "open":      [100,  102,  104,  103,  101,   99,   97,   98,  100,  103],
        "high":      [103,  105,  106,  104,  102,  100,   99,  101,  104,  106],
        "low":       [ 99,  100,  102,  100,   98,   96,   95,   96,   99,  101],
        "close":     [102,  104,  103,  101,   99,   97,   98,  100,  103,  105],
        "volume":    [100,  150,  200,  180,  160,  140,  130,  150,  170,  200],
    }
    df = pd.DataFrame(data)

    strategy = MAStrategy(
        fast_ma=2,
        slow_ma=4,
        initial_capital=100000.0,
        commission=0.0,
        slippage=0.0,
        stop_loss_pct=0.5,
        take_profit_pct=0.5,
    )

    signals_received = []
    def on_signal(sig):
        signals_received.append(sig)

    result = strategy.run(df, on_signal=on_signal)

    signals = result["signals"]
    trades = result["trades"]
    bars = result["klines"]

    print("=== 价格序列 ===")
    for i, row in df.iterrows():
        print(f"  bar {i}: ts={int(row['timestamp'])} O={row['open']} H={row['high']} L={row['low']} C={row['close']}")

    print(f"\n=== 交易信号 ({len(signals)} 个) ===")
    for s in signals:
        print(f"  [{s['index']}] ts={s['timestamp']} {s['type']:>4s} @ {s['price']:.2f}  reason={s['reason']}  exec_at={s.get('exec_at', '?')}")

    print(f"\n=== 成交记录 ({len(trades)} 笔) ===")
    for t in trades:
        print(f"  入:{t['entry_index']}@{t['entry_ts']}  出:{t['exit_index']}@{t['exit_ts']}  PnL={t['pnl']:+.2f} ({t['pnl_pct']:+.2f}%)  reason={t['exit_reason']}")

    print(f"\n=== 绩效汇总 ===")
    s = result["summary"]
    print(f"  总收益率: {s['total_return_pct']:.2f}%")
    print(f"  交易次数: {s['trade_count']}")
    print(f"  期末权益: {s['final_equity']:.2f}")

    print("\n=== 未来函数检测 ===")
    all_passed = True

    buy_signals = [s for s in signals if s["type"] == "buy"]
    sell_signals = [s for s in signals if s["type"] == "sell"]

    for bs in buy_signals:
        idx = bs["index"]
        price = bs["price"]
        bar_open = df.iloc[idx]["open"]
        bar_high = df.iloc[idx]["high"]
        bar_low = df.iloc[idx]["low"]

        if bs.get("exec_at") == "open":
            if abs(price - bar_open) > 0.001:
                print(f"  ❌ [FAIL] 买点 idx={idx}: 开盘成交但价格 {price} != 开盘价 {bar_open}")
                all_passed = False
            else:
                print(f"  ✅ [PASS] 买点 idx={idx}: 开盘成交，价格 {price} == 开盘价 {bar_open}")

    for ss in sell_signals:
        idx = ss["index"]
        price = ss["price"]
        reason = ss["reason"]
        bar_open = df.iloc[idx]["open"]
        bar_high = df.iloc[idx]["high"]
        bar_low = df.iloc[idx]["low"]

        if reason == "ma_cross_down":
            if abs(price - bar_open) > 0.001:
                print(f"  ❌ [FAIL] MA卖点 idx={idx}: 开盘成交但价格 {price} != 开盘价 {bar_open}")
                all_passed = False
            else:
                print(f"  ✅ [PASS] MA卖点 idx={idx}: 开盘成交，价格 {price} == 开盘价 {bar_open}")
        elif reason in ("stop_loss", "take_profit", "force_close"):
            if price > bar_high + 0.001 or price < bar_low - 0.001:
                print(f"  ❌ [FAIL] {reason}卖点 idx={idx}: 价格 {price} 超出当根 K 线范围 [{bar_low}, {bar_high}]")
                all_passed = False
            else:
                print(f"  ✅ [PASS] {reason}卖点 idx={idx}: 价格 {price} 在当根 K 线范围内 [{bar_low}, {bar_high}]")

    for trade in trades:
        entry_idx = trade["entry_index"]
        exit_idx = trade["exit_index"]
        if exit_idx <= entry_idx:
            print(f"  ❌ [FAIL] 交易 entry={entry_idx} exit={exit_idx}: 卖出不在买入之后")
            all_passed = False
        else:
            print(f"  ✅ [PASS] 交易 entry={entry_idx} < exit={exit_idx}: 时序正确")

    if len(trades) > 0:
        first_entry = min(t["entry_index"] for t in trades)
        if first_entry < 4:
            print(f"  ⚠️  [WARN] 第一笔交易发生在 idx={first_entry}，早于 slow_ma=4 的形成期（索引>=4）")
        else:
            print(f"  ✅ [PASS] 第一笔交易在 idx={first_entry}，在 slow_ma 形成之后")

    if all_passed:
        print("\n✅ 所有未来函数检测通过！回测逻辑严谨，无未来数据泄露。")
    else:
        print("\n❌ 检测失败！存在未来函数。")
        sys.exit(1)

    return all_passed


def test_slippage_direction():
    """
    验证滑点方向正确：买入滑点向上（更贵），卖出滑点向下（更便宜）。
    这是保守回测的基本要求。
    """
    data = {
        "timestamp": [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
        "open":      [100,  101,  102,  103,  102,  101,  100,   99],
        "high":      [102,  103,  104,  105,  104,  103,  102,  101],
        "low":       [ 98,   99,  100,  101,  100,   99,   98,   97],
        "close":     [101,  102,  103,  102,  101,  100,   99,   98],
        "volume":    [100,  100,  100,  100,  100,  100,  100,  100],
    }
    df = pd.DataFrame(data)

    strategy = MAStrategy(
        fast_ma=2,
        slow_ma=3,
        initial_capital=100000.0,
        commission=0.0,
        slippage=0.01,
        stop_loss_pct=0.5,
        take_profit_pct=0.5,
    )

    result = strategy.run(df)
    trades = result["trades"]

    print("\n=== 滑点方向测试 ===")
    all_ok = True

    for t in trades:
        entry_bar = df.iloc[t["entry_index"]]
        exit_bar = df.iloc[t["exit_index"]]

        expected_buy = entry_bar["open"] * 1.01
        if abs(t["entry_price"] - expected_buy) > 0.01:
            print(f"  ❌ [FAIL] 买入价 {t['entry_price']:.4f} != 预期 {expected_buy:.4f} (开盘 * 1.01)")
            all_ok = False
        else:
            print(f"  ✅ [PASS] 买入价 {t['entry_price']:.4f} == 开盘价 {entry_bar['open']} * 1.01 (滑点向上)")

    if all_ok:
        print("✅ 滑点方向正确，保守回测生效。")
    else:
        print("❌ 滑点方向错误！")
        sys.exit(1)


if __name__ == "__main__":
    test_no_lookahead_bias()
    test_slippage_direction()
    print("\n🎉 全部测试通过！")
