#pragma once
#include "Types.hpp"
#include <deque>
#include <mutex>
#include <memory>
#include <sstream>

namespace delta {

class ClusterAggregator {
public:
    ClusterAggregator(std::string symbol = "EURUSD", double tick_size = 0.0001, int timeframe_sec = 60);

    void set_symbol(const std::string& symbol, double tick_size);
    void set_timeframe(int seconds);
    void set_tick_size(double tick_size);
    void set_imbalance_params(double ratio, double min_vol);

    void process_tick(const Tick& tick);
    void clear();

    std::string serialize_snapshot_json(size_t max_candles = 100);
    std::string serialize_live_update_json();
    std::string serialize_profile_json();

    std::string get_symbol() const { std::lock_guard lock(mutex_); return symbol_; }
    double get_tick_size() const { std::lock_guard lock(mutex_); return tick_size_; }
    int get_timeframe() const { std::lock_guard lock(mutex_); return timeframe_sec_; }
    double get_cumulative_delta() const { std::lock_guard lock(mutex_); return cumulative_delta_; }
    size_t get_candle_count();

private:
    void aggregate_tick_internal(const Tick& tick);
    void rebuild_candles_from_history();
    void trim_tick_history();
    void update_candle_metrics(Candle& candle);
    int64_t to_tick_index(double price) const;
    double from_tick_index(int64_t index) const;

    mutable std::mutex mutex_;
    std::string symbol_;
    double tick_size_;
    int timeframe_sec_;
    double imbalance_ratio_ = 3.0;
    double imbalance_min_vol_ = 1.0;
    double cumulative_delta_ = 0.0;
    double history_base_delta_ = 0.0;

    std::deque<Candle> candles_;
    std::deque<Tick> tick_history_; // Stores recent raw ticks for instant timeframe rebuilding
    bool live_dirty_ = false;
    int64_t last_published_time_ = 0;
};

} // namespace delta
