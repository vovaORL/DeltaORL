#include "ClusterAggregator.hpp"
#include <algorithm>
#include <iomanip>
#include "Json.hpp"
#include <limits>
#include <locale>

namespace delta {

ClusterAggregator::ClusterAggregator(std::string symbol, double tick_size, int timeframe_sec)
    : symbol_(symbol), tick_size_(tick_size), timeframe_sec_(timeframe_sec) {
    if (!std::isfinite(tick_size_) || tick_size_ <= 0) tick_size_ = 0.0001;
    if (timeframe_sec_ <= 0) timeframe_sec_ = 60;
}

void ClusterAggregator::set_symbol(const std::string& symbol, double tick_size) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (symbol.empty() || !std::isfinite(tick_size) || tick_size <= 0) return;
    symbol_ = symbol;
    tick_size_ = tick_size;
    candles_.clear();
    tick_history_.clear();
    cumulative_delta_ = 0.0;
    history_base_delta_ = 0.0;
    live_dirty_ = true;
    last_published_time_ = 0;
}

void ClusterAggregator::set_timeframe(int seconds) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (seconds <= 0) seconds = 60;
    timeframe_sec_ = seconds;
    rebuild_candles_from_history();
    live_dirty_ = true;
}

void ClusterAggregator::set_tick_size(double tick_size) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (std::isfinite(tick_size) && tick_size > 0.0) {
        tick_size_ = tick_size;
        rebuild_candles_from_history();
        live_dirty_ = true;
    }
}

void ClusterAggregator::set_imbalance_params(double ratio, double min_vol) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!std::isfinite(ratio) || ratio <= 0 || !std::isfinite(min_vol) || min_vol < 0) return;
    imbalance_ratio_ = ratio;
    imbalance_min_vol_ = min_vol;
    for (auto& c : candles_) {
        update_candle_metrics(c);
    }
    live_dirty_ = true;
}

int64_t ClusterAggregator::to_tick_index(double price) const {
    if (tick_size_ <= 0.0) return 0;
    return static_cast<int64_t>(std::llround(price / tick_size_));
}

double ClusterAggregator::from_tick_index(int64_t index) const {
    return static_cast<double>(index) * tick_size_;
}

void ClusterAggregator::rebuild_candles_from_history() {
    candles_.clear();
    cumulative_delta_ = history_base_delta_;
    last_published_time_ = 0;
    for (const auto& tick : tick_history_) {
        aggregate_tick_internal(tick);
    }
}

void ClusterAggregator::process_tick(const Tick& tick) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!std::isfinite(tick.price) || !std::isfinite(tick.volume) || tick.price <= 0.0 || tick.volume <= 0.0 || tick.time_msc <= 0 || tick.symbol != symbol_ || tick.price / tick_size_ > 9e15) return;

    if (!tick_history_.empty() && tick.time_msc < tick_history_.back().time_msc) {
        // Keep chronological OHLC even when imported/history batches overlap.
        auto it = std::upper_bound(tick_history_.begin(), tick_history_.end(), tick.time_msc,
            [](int64_t time, const Tick& value) { return time < value.time_msc; });
        tick_history_.insert(it, tick);
        if (tick_history_.size() > 300000) {
            history_base_delta_ += static_cast<int>(tick_history_.front().side) * tick_history_.front().volume;
            tick_history_.pop_front();
        }
        rebuild_candles_from_history();
        live_dirty_ = true;
        return;
    }

    // Buffer raw ticks for instant timeframe recalculation (up to 300,000 ticks)
    tick_history_.push_back(tick);
    if (tick_history_.size() > 300000) {
        history_base_delta_ += static_cast<int>(tick_history_.front().side) * tick_history_.front().volume;
        tick_history_.pop_front();
    }

    aggregate_tick_internal(tick);
    live_dirty_ = true;
}

void ClusterAggregator::aggregate_tick_internal(const Tick& tick) {
    int64_t tick_time_sec = tick.time_msc / 1000;
    int64_t candle_start_sec = (tick_time_sec / timeframe_sec_) * timeframe_sec_;

    // Check if we need to start a new candle
    if (candles_.empty() || candles_.back().time_sec != candle_start_sec) {
        if (!candles_.empty()) {
            update_candle_metrics(candles_.back());
            candles_.back().cvd = cumulative_delta_;
        }

        Candle new_candle;
        new_candle.time_sec = candle_start_sec;
        new_candle.open = tick.price;
        new_candle.high = tick.price;
        new_candle.low = tick.price;
        new_candle.close = tick.price;
        new_candle.cvd = cumulative_delta_;
        candles_.push_back(new_candle);

        if (candles_.size() > 5000) {
            candles_.pop_front();
        }
    }

    Candle& current = candles_.back();

    // Update OHLC
    if (tick.price > current.high) current.high = tick.price;
    if (tick.price < current.low) current.low = tick.price;
    current.close = tick.price;
    current.total_vol += tick.volume;

    // Price level indexing
    int64_t price_idx = to_tick_index(tick.price);
    auto& level = current.clusters[price_idx];
    level.price = from_tick_index(price_idx);

    // Delta & Volume distribution (Sellers vs Buyers)
    double tick_delta = 0.0;
    if (tick.side == TradeSide::Buy) {
        level.ask_vol += tick.volume;
        level.ask_trades++;
        current.ask_vol += tick.volume;
        tick_delta = tick.volume;
    } else if (tick.side == TradeSide::Sell) {
        level.bid_vol += tick.volume;
        level.bid_trades++;
        current.bid_vol += tick.volume;
        tick_delta = -tick.volume;
    } else {
        double half = tick.volume * 0.5;
        level.ask_vol += half;
        level.bid_vol += half;
        level.ask_trades++;
        level.bid_trades++;
        current.ask_vol += half;
        current.bid_vol += half;
    }

    current.delta += tick_delta;
    cumulative_delta_ += tick_delta;
    current.cvd = cumulative_delta_;

    // Derived metrics are computed on publication, not for every raw tick.
}

void ClusterAggregator::update_candle_metrics(Candle& candle) {
    if (candle.clusters.empty()) return;

    // Fill in intermediate price rows between low and high so the candle is a solid continuous ladder
    int64_t min_idx = to_tick_index(candle.low);
    int64_t max_idx = to_tick_index(candle.high);
    if (max_idx - min_idx <= 500) {
        for (int64_t idx = min_idx; idx <= max_idx; ++idx) {
            if (candle.clusters.find(idx) == candle.clusters.end()) {
                ClusterLevel empty_lvl;
                empty_lvl.price = from_tick_index(idx);
                candle.clusters[idx] = empty_lvl;
            }
        }
    }

    double max_vol = 0.0;
    int64_t poc_idx = 0;
    double total_vol = 0.0;

    for (const auto& [idx, lvl] : candle.clusters) {
        double vol = lvl.bid_vol + lvl.ask_vol;
        total_vol += vol;
        if (vol > max_vol) {
            max_vol = vol;
            poc_idx = idx;
        }
    }

    candle.poc_price = from_tick_index(poc_idx);
    candle.poc_volume = max_vol;

    // Diagonal Imbalance Detection
    for (auto& [idx, lvl] : candle.clusters) {
        auto next_it = candle.clusters.find(idx - 1);
        if (next_it != candle.clusters.end()) {
            if (lvl.ask_vol >= imbalance_min_vol_ && lvl.ask_vol >= next_it->second.bid_vol * imbalance_ratio_) {
                lvl.buy_imbalance = true;
            } else {
                lvl.buy_imbalance = false;
            }
        } else {
            lvl.buy_imbalance = false;
        }

        auto prev_it = candle.clusters.find(idx + 1);
        if (prev_it != candle.clusters.end()) {
            if (lvl.bid_vol >= imbalance_min_vol_ && lvl.bid_vol >= prev_it->second.ask_vol * imbalance_ratio_) {
                lvl.sell_imbalance = true;
            } else {
                lvl.sell_imbalance = false;
            }
        } else {
            lvl.sell_imbalance = false;
        }
    }

    // Value Area (70% Volume around POC)
    if (total_vol > 0.0) {
        double target_vol = total_vol * 0.70;
        double current_va_vol = max_vol;
        auto low = candle.clusters.find(poc_idx);
        auto high = low;
        while (current_va_vol < target_vol) {
            auto up = std::next(high);
            bool has_down = low != candle.clusters.begin();
            if (up == candle.clusters.end() && !has_down) break;
            auto down = has_down ? std::prev(low) : low;
            if (up != candle.clusters.end() && (!has_down || up->second.total_vol() >= down->second.total_vol())) {
                current_va_vol += up->second.total_vol(); high = up;
            } else { current_va_vol += down->second.total_vol(); low = down; }
        }
        candle.vah_price = high->second.price;
        candle.val_price = low->second.price;
    } else {
        candle.vah_price = candle.high;
        candle.val_price = candle.low;
    }
}

size_t ClusterAggregator::get_candle_count() {
    std::lock_guard<std::mutex> lock(mutex_);
    return candles_.size();
}

void ClusterAggregator::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    candles_.clear();
    tick_history_.clear();
    cumulative_delta_ = 0.0;
    history_base_delta_ = 0.0;
    live_dirty_ = true;
    last_published_time_ = 0;
}

static void serialize_candle_json(std::ostringstream& ss, const Candle& c) {
    ss << "{\"time\":" << c.time_sec
       << ",\"o\":" << c.open
       << ",\"h\":" << c.high
       << ",\"l\":" << c.low
       << ",\"c\":" << c.close
       << ",\"v\":" << c.total_vol
       << ",\"bv\":" << c.bid_vol
       << ",\"av\":" << c.ask_vol
       << ",\"d\":" << c.delta
       << ",\"cvd\":" << c.cvd
       << ",\"poc\":" << c.poc_price
       << ",\"poc_v\":" << c.poc_volume
       << ",\"vah\":" << c.vah_price
       << ",\"val\":" << c.val_price
       << ",\"clusters\":[";

    bool first = true;
    for (const auto& [idx, lvl] : c.clusters) {
        if (!first) ss << ",";
        first = false;
        ss << "[" << lvl.price << ","
           << lvl.bid_vol << ","
           << lvl.ask_vol << ","
           << lvl.bid_trades << ","
           << lvl.ask_trades << ","
           << (lvl.buy_imbalance ? 1 : 0) << ","
           << (lvl.sell_imbalance ? 1 : 0) << "]";
    }
    ss << "]}";
}

std::string ClusterAggregator::serialize_snapshot_json(size_t max_candles) {
    std::vector<Candle> copy;
    std::string symbol;
    double step, cvd;
    int timeframe;
    {
        std::lock_guard lock(mutex_);
        if (!candles_.empty()) update_candle_metrics(candles_.back());
        size_t start = candles_.size() > max_candles ? candles_.size() - max_candles : 0;
        copy.assign(candles_.begin() + start, candles_.end());
        symbol = symbol_; step = tick_size_; cvd = cumulative_delta_; timeframe = timeframe_sec_;
    }
    std::ostringstream ss;
    ss.imbue(std::locale::classic()); ss << std::setprecision(17);
    ss << "{\"type\":\"snapshot\",\"symbol\":" << json_quote(symbol)
       << ",\"tick_size\":" << step << ",\"timeframe\":" << timeframe << ",\"cvd\":" << cvd << ",\"candles\":[";
    bool first = true;
    for (const auto& candle : copy) { if (!first) ss << ','; first = false; serialize_candle_json(ss, candle); }
    ss << "]}";
    return ss.str();
}

std::string ClusterAggregator::serialize_live_update_json() {
    std::vector<Candle> copy;
    std::string symbol;
    int timeframe;
    {
        std::lock_guard lock(mutex_);
        if (candles_.empty() || !live_dirty_) return "";
        update_candle_metrics(candles_.back());
        size_t start = candles_.size() > 1000 ? candles_.size() - 1000 : 0;
        for (size_t i = start; i < candles_.size(); ++i)
            if (candles_[i].time_sec >= last_published_time_) copy.push_back(candles_[i]);
        last_published_time_ = candles_.back().time_sec;
        live_dirty_ = false; symbol = symbol_; timeframe = timeframe_sec_;
    }
    std::ostringstream ss;
    ss.imbue(std::locale::classic()); ss << std::setprecision(17);
    ss << "{\"type\":\"candle_update\",\"symbol\":" << json_quote(symbol) << ",\"timeframe\":" << timeframe << ",\"candles\":[";
    bool first = true;
    for (const auto& candle : copy) { if (!first) ss << ','; first = false; serialize_candle_json(ss, candle); }
    ss << "],\"candle\":";
    serialize_candle_json(ss, copy.back()); ss << '}';
    return ss.str();
}

std::string ClusterAggregator::serialize_profile_json() {
    std::map<int64_t, std::pair<double, double>> profile;
    double step;
    {
        std::lock_guard lock(mutex_);
        step = tick_size_;
        for (const auto& c : candles_) for (const auto& [idx, lvl] : c.clusters) {
            profile[idx].first += lvl.bid_vol; profile[idx].second += lvl.ask_vol;
        }
    }
    std::ostringstream ss;
    ss.imbue(std::locale::classic()); ss << std::setprecision(17);
    ss << "{\"type\":\"profile\",\"levels\":[";
    bool first = true;
    for (const auto& [idx, vols] : profile) {
        if (!first) ss << ',';
        first = false;
        ss << '[' << idx * step << ',' << vols.first << ',' << vols.second << ']';
    }
    ss << "]}";
    return ss.str();
}
} // namespace delta
