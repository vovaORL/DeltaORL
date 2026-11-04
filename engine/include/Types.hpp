#pragma once
#include <string>
#include <vector>
#include <map>
#include <cstdint>
#include <cmath>

namespace delta {

enum class TradeSide : int {
    Sell = -1,
    Unknown = 0,
    Buy = 1
};

struct Tick {
    std::string symbol;
    int64_t time_msc = 0;
    double price = 0.0;
    double volume = 0.0;
    TradeSide side = TradeSide::Unknown;
    double bid = 0.0;
    double ask = 0.0;
};

struct ClusterLevel {
    double price = 0.0;
    double bid_vol = 0.0;
    double ask_vol = 0.0;
    uint32_t bid_trades = 0;
    uint32_t ask_trades = 0;
    bool buy_imbalance = false;
    bool sell_imbalance = false;

    double total_vol() const { return bid_vol + ask_vol; }
    double delta() const { return ask_vol - bid_vol; }
};

struct Candle {
    int64_t time_sec = 0;   // Timestamp (seconds)
    double open = 0.0;
    double high = 0.0;
    double low = 0.0;
    double close = 0.0;
    double total_vol = 0.0;
    double bid_vol = 0.0;   // Seller volume
    double ask_vol = 0.0;   // Buyer volume
    double delta = 0.0;
    double cvd = 0.0;       // Cumulative Volume Delta at candle close
    
    // POC & Value Area
    double poc_price = 0.0;
    double poc_volume = 0.0;
    double vah_price = 0.0; // Value Area High (70%)
    double val_price = 0.0; // Value Area Low (70%)

    // Price Tick Index -> ClusterLevel
    std::map<int64_t, ClusterLevel> clusters;
};

struct DOMEntry {
    double price = 0.0;
    double volume = 0.0;
    int type = 1; // 1 = Bid, 2 = Ask
};

struct EngineStats {
    bool mt5_connected = false;
    std::string current_symbol = "EURUSD";
    int64_t ticks_received = 0;
    double ticks_per_sec = 0.0;
    int active_ui_clients = 0;
    int64_t memory_used_bytes = 0;
};

} // namespace delta
