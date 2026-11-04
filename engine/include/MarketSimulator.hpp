#pragma once
#include "Types.hpp"
#include <atomic>
#include <thread>
#include <functional>
#include <random>
#include <mutex>

namespace delta {

class MarketSimulator {
public:
    using TickCallback = std::function<void(const Tick&, uint64_t generation)>;

    MarketSimulator(std::string symbol = "EURUSD", double base_price = 1.0850, double tick_size = 0.0001);
    ~MarketSimulator();

    void start(TickCallback cb);
    void stop();
    void set_enabled(bool enabled) { enabled_.store(enabled); }
    bool is_enabled() const { return enabled_.load(); }
    uint64_t set_symbol(const std::string& symbol, double base_price, double tick_size);

    std::vector<DOMEntry> generate_simulated_dom(int depth = 10);

private:
    void sim_loop();

    std::string symbol_;
    double current_price_;
    double tick_size_;
    std::atomic<bool> running_{false};
    std::atomic<bool> enabled_{true};

    TickCallback tick_cb_;
    std::thread worker_;
    std::mt19937 rng_;
    std::mutex mutex_;
    uint64_t generation_ = 1;
};

} // namespace delta
