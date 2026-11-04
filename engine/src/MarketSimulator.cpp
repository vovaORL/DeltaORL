#include "MarketSimulator.hpp"
#include <chrono>
#include <cmath>

namespace delta {
MarketSimulator::MarketSimulator(std::string symbol, double price, double step)
    : symbol_(std::move(symbol)), current_price_(price), tick_size_(step), rng_(1337) {}
MarketSimulator::~MarketSimulator() { stop(); }
void MarketSimulator::start(TickCallback cb) {
    if (running_.exchange(true)) return;
    tick_cb_ = std::move(cb);
    worker_ = std::thread(&MarketSimulator::sim_loop, this);
}
void MarketSimulator::stop() { running_ = false; if (worker_.joinable()) worker_.join(); }
uint64_t MarketSimulator::set_symbol(const std::string& symbol, double price, double step) {
    std::lock_guard lock(mutex_);
    if (symbol.empty() || !std::isfinite(price) || !std::isfinite(step) || price <= 0 || step <= 0) return generation_;
    symbol_ = symbol; current_price_ = price; tick_size_ = step; ++generation_;
    return generation_;
}
std::vector<DOMEntry> MarketSimulator::generate_simulated_dom(int depth) {
    std::lock_guard lock(mutex_);
    std::vector<DOMEntry> dom;
    std::uniform_real_distribution<double> volume(5, 85);
    for (int type : {1, 2}) for (int i = 1; i <= depth; ++i)
        dom.push_back({current_price_ + (type == 1 ? -i : i) * tick_size_, std::round(volume(rng_) * 10) / 10, type});
    return dom;
}
void MarketSimulator::sim_loop() {
    uint64_t seen = 0;
    std::normal_distribution<double> move(0, 1.2);
    std::exponential_distribution<double> volume(0.3);
    while (running_) {
        if (!enabled_) { std::this_thread::sleep_for(std::chrono::milliseconds(50)); continue; }
        std::vector<Tick> batch;
        uint64_t generation;
        {
            std::lock_guard lock(mutex_);
            generation = generation_;
            auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            bool history = seen != generation;
            int count = history ? 8000 : 1;
            batch.reserve(count);
            for (int i = 0; i < count; ++i) {
                current_price_ = std::max(tick_size_, current_price_ + std::round(move(rng_)) * tick_size_);
                Tick tick;
                tick.symbol = symbol_; tick.time_msc = history ? now - (count - i) * 3000LL : now;
                tick.price = current_price_; tick.volume = std::round((0.5 + volume(rng_)) * 10) / 10;
                tick.side = rng_() % 2 ? TradeSide::Buy : TradeSide::Sell;
                tick.bid = tick.price - tick_size_ / 2; tick.ask = tick.price + tick_size_ / 2;
                batch.push_back(tick);
            }
            seen = generation;
        }
        for (const auto& tick : batch) {
            if (!running_ || !enabled_) break;
            { std::lock_guard lock(mutex_); if (generation != generation_) break; }
            if (tick_cb_) tick_cb_(tick, generation);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
    }
}
} // namespace delta
