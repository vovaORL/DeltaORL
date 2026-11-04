#pragma once
#include "Types.hpp"
#include <string>
#include <vector>
#include <functional>
#include <filesystem>

namespace delta {

struct MT5TerminalInfo {
    std::string terminal_id;
    std::string root_path;
    std::vector<std::string> servers;
};

class MT5FileReader {
public:
    using TickBatchCallback = std::function<void(const std::vector<Tick>&)>;

    MT5FileReader();

    // Auto-detect installed MT5 terminals in AppData
    std::vector<MT5TerminalInfo> detect_terminals();

    // Load ticks directly from an MT5 terminal bases path or specific file
    int load_symbol_ticks(const std::string& terminal_path, const std::string& symbol, TickBatchCallback cb);

    // Auto-copy DeltaBridge.mq5 into MT5 Experts directory (DeltaRiver style)
    bool install_ea(const std::string& terminal_path, std::string& out_dest);

    // Parse a packed MqlTick binary export (60-byte records), not native MT5 caches.
    static std::vector<Tick> parse_ticks_dat(const std::filesystem::path& file_path, const std::string& symbol);

    // Parse CSV tick file (Date, Time, Bid, Ask, Volume, etc.)
    static std::vector<Tick> parse_ticks_csv(const std::filesystem::path& file_path, const std::string& symbol);

private:
    std::string last_loaded_path_;
};

} // namespace delta
