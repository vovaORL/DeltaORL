#include "MT5FileReader.hpp"
#include <iostream>
#include <fstream>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <charconv>
#include <iomanip>
#include <sstream>
#include <windows.h>

namespace delta {

namespace {
std::filesystem::path from_utf8(const std::string& text) {
    return std::filesystem::path(std::u8string(text.begin(), text.end()));
}
}

MT5FileReader::MT5FileReader() {
}

std::vector<MT5TerminalInfo> MT5FileReader::detect_terminals() {
    std::vector<MT5TerminalInfo> results;

    const wchar_t* appdata = _wgetenv(L"APPDATA");
    if (!appdata) return results;

    std::filesystem::path term_dir = std::filesystem::path(appdata) / "MetaQuotes" / "Terminal";
    if (!std::filesystem::exists(term_dir)) return results;

    try {
        for (const auto& entry : std::filesystem::directory_iterator(term_dir)) {
            if (entry.is_directory()) {
                std::string name = entry.path().filename().string();
                if (name == "Common" || name == "Community") continue;

                MT5TerminalInfo info;
                info.terminal_id = name;
                auto utf8 = entry.path().u8string();
                info.root_path.assign(utf8.begin(), utf8.end());

                std::filesystem::path bases_dir = entry.path() / "bases";
                if (std::filesystem::exists(bases_dir)) {
                    for (const auto& b_entry : std::filesystem::directory_iterator(bases_dir)) {
                        if (b_entry.is_directory()) {
                            std::string server_name = b_entry.path().filename().string();
                            if (server_name != "Custom" && server_name != "Default" && server_name != "signals") {
                                info.servers.push_back(server_name);
                            }
                        }
                    }
                }
                results.push_back(info);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[MT5FileReader] Exception in detect_terminals: " << e.what() << "\n";
    }

    return results;
}

namespace {
std::string utf8_path(const std::filesystem::path& path) {
    auto bytes = path.u8string(); return {bytes.begin(), bytes.end()};
}
std::filesystem::path origin_path(const std::filesystem::path& data) {
    std::ifstream file(data / "origin.txt", std::ios::binary);
    std::string bytes((std::istreambuf_iterator<char>(file)), {});
    if (bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xff && static_cast<unsigned char>(bytes[1]) == 0xfe) {
        std::wstring text;
        for (size_t i = 2; i + 1 < bytes.size(); i += 2) text += wchar_t(static_cast<unsigned char>(bytes[i]) | (static_cast<unsigned char>(bytes[i + 1]) << 8));
        while (!text.empty() && (text.back() == L'\r' || text.back() == L'\n' || text.back() == 0)) text.pop_back();
        return std::filesystem::path(text);
    }
    if (bytes.rfind("\xef\xbb\xbf", 0) == 0) bytes.erase(0, 3);
    while (!bytes.empty() && (bytes.back() == '\r' || bytes.back() == '\n' || bytes.back() == 0)) bytes.pop_back();
    return from_utf8(bytes);
}
}
bool MT5FileReader::install_ea(const std::string& terminal_path, std::string& out_dest) {
    try {
        auto requested = from_utf8(terminal_path);
        if (requested.extension() == ".exe") requested = requested.parent_path();
        std::filesystem::path data;
        if (!requested.empty() && std::filesystem::is_directory(requested / "MQL5" / "Experts")) data = requested;
        if (data.empty()) {
            for (const auto& term : detect_terminals()) {
                auto candidate = from_utf8(term.root_path);
                if (!std::filesystem::is_directory(candidate / "MQL5" / "Experts")) continue;
                if (requested.empty() || (!origin_path(candidate).empty() && std::filesystem::equivalent(origin_path(candidate), requested))) { data = candidate; break; }
            }
        }
        if (data.empty()) return false;
        wchar_t executable[32768]; DWORD n = GetModuleFileNameW(nullptr, executable, 32768);
        auto root = std::filesystem::path(std::wstring(executable, n)).parent_path();
        std::filesystem::path source;
        for (const auto& candidate : {root / ".." / "mql5" / "DeltaBridge.mq5", root / "mql5" / "DeltaBridge.mq5"})
            if (std::filesystem::is_regular_file(candidate)) { source = candidate; break; }
        if (source.empty()) return false;
        auto destination = data / "MQL5" / "Experts" / "DeltaORL" / "DeltaBridge.mq5";
        std::filesystem::create_directories(destination.parent_path());
        std::filesystem::copy_file(source, destination, std::filesystem::copy_options::overwrite_existing);
        auto compiled = source; compiled.replace_extension(".ex5");
        if (std::filesystem::is_regular_file(compiled) && std::filesystem::last_write_time(compiled) >= std::filesystem::last_write_time(source)) {
            auto compiled_destination = destination; compiled_destination.replace_extension(".ex5");
            std::filesystem::copy_file(compiled, compiled_destination, std::filesystem::copy_options::overwrite_existing);
        }
        out_dest = utf8_path(destination);
        return true;
    } catch (const std::exception& e) { std::cerr << "[MT5FileReader] install_ea: " << e.what() << '\n'; return false; }
}

namespace {
template<class T> T read_value(const unsigned char* bytes) { T value; std::memcpy(&value, bytes, sizeof(T)); return value; }
bool make_tick(Tick& tick, double last, uint32_t flags, double& previous, TradeSide& side) {
    tick.price = last > 0 ? last : (tick.bid > 0 && tick.ask > 0 ? (tick.bid + tick.ask) / 2 : std::max(tick.bid, tick.ask));
    if (!std::isfinite(tick.price) || !std::isfinite(tick.volume) || !std::isfinite(tick.bid) || !std::isfinite(tick.ask) || tick.price <= 0 || tick.time_msc <= 0) return false;
    if (tick.volume <= 0) tick.volume = 1;
    if (flags & 32) side = TradeSide::Buy;
    else if (flags & 64) side = TradeSide::Sell;
    else if (last > 0 && tick.ask > 0 && last >= tick.ask) side = TradeSide::Buy;
    else if (last > 0 && tick.bid > 0 && last <= tick.bid) side = TradeSide::Sell;
    else if (tick.price > previous) side = TradeSide::Buy;
    else if (tick.price < previous) side = TradeSide::Sell;
    previous = tick.price; tick.side = side;
    return true;
}
}
std::vector<Tick> MT5FileReader::parse_ticks_dat(const std::filesystem::path& path, const std::string& symbol) {
    // Supported binary export: packed little-endian MqlTick[60]. Native MT5
    // cache files have private formats; never infer offsets from random bytes.
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return {};
    auto size = file.tellg();
    if (size <= 0 || size % 60 != 0 || size > 300000LL * 60) return {};
    file.seekg(0);
    std::vector<Tick> ticks;
    double previous = 0; TradeSide side = TradeSide::Buy;
    unsigned char bytes[60];
    while (file.read(reinterpret_cast<char*>(bytes), sizeof(bytes))) {
        Tick tick; tick.symbol = symbol;
        auto seconds = read_value<int64_t>(bytes);
        tick.bid = read_value<double>(bytes + 8); tick.ask = read_value<double>(bytes + 16);
        double last = read_value<double>(bytes + 24);
        auto volume = read_value<uint64_t>(bytes + 32);
        tick.time_msc = read_value<int64_t>(bytes + 40);
        auto flags = read_value<uint32_t>(bytes + 48);
        tick.volume = read_value<double>(bytes + 52);
        if (tick.volume <= 0) tick.volume = static_cast<double>(volume);
        if (tick.time_msc / 1000 != seconds || (!ticks.empty() && tick.time_msc < ticks.back().time_msc) || !make_tick(tick, last, flags, previous, side)) return {};
        ticks.push_back(tick);
    }
    return ticks;
}

std::vector<Tick> MT5FileReader::parse_ticks_csv(const std::filesystem::path& path, const std::string& symbol) {
    std::ifstream file(path);
    if (!file) return {};
    std::vector<Tick> ticks;
    std::string line;
    double bid = 0, ask = 0, previous = 0; TradeSide side = TradeSide::Buy;
    while (std::getline(file, line)) {
        if (line.empty()) continue;
        char separator = line.find('\t') != std::string::npos ? '\t' : (line.find(';') != std::string::npos ? ';' : ',');
        std::vector<std::string> columns;
        std::stringstream row(line); std::string column;
        while (std::getline(row, column, separator)) { if (!column.empty() && column.back() == '\r') column.pop_back(); columns.push_back(column); }
        if (columns.size() < 4 || columns[0].find("DATE") != std::string::npos) continue;
        try {
            std::tm time{};
            std::istringstream date(columns[0] + " " + columns[1]);
            date >> std::get_time(&time, "%Y.%m.%d %H:%M:%S");
            if (date.fail()) return {};
            auto seconds = _mkgmtime(&time);
            if (seconds < 0) return {};
            auto dot = columns[1].find('.');
            int milliseconds = 0;
            if (dot != std::string::npos) {
                auto fraction = columns[1].substr(dot + 1);
                if (fraction.empty() || fraction.size() > 3 || !std::all_of(fraction.begin(), fraction.end(), [](char c) { return c >= '0' && c <= '9'; })) return {};
                while (fraction.size() < 3) fraction += '0';
                milliseconds = std::stoi(fraction);
            }
            auto numeric = [](const std::string& s) { if (s.empty()) return 0.0; size_t end; double v = std::stod(s, &end); if (end != s.size() || !std::isfinite(v)) throw std::invalid_argument("Invalid CSV value"); return v; };
            if (!columns[2].empty()) bid = numeric(columns[2]);
            if (!columns[3].empty()) ask = numeric(columns[3]);
            Tick tick; tick.symbol = symbol; tick.time_msc = seconds * 1000 + milliseconds; tick.bid = bid; tick.ask = ask;
            double last = columns.size() > 4 ? numeric(columns[4]) : 0;
            tick.volume = columns.size() > 5 ? numeric(columns[5]) : 1;
            double flags = columns.size() > 6 ? numeric(columns[6]) : 0;
            if (flags < 0 || flags > 127 || std::floor(flags) != flags || !make_tick(tick, last, static_cast<uint32_t>(flags), previous, side)) return {};
            ticks.push_back(tick);
            if (ticks.size() > 300000) return {};
        } catch (...) { return {}; }
    }
    std::stable_sort(ticks.begin(), ticks.end(), [](const Tick& a, const Tick& b) { return a.time_msc < b.time_msc; });
    return ticks;
}

int MT5FileReader::load_symbol_ticks(const std::string& terminal_path, const std::string& symbol, TickBatchCallback cb) {
    auto root = from_utf8(terminal_path);
    if (!std::filesystem::exists(root)) {
        return 0;
    }

    if (std::filesystem::is_regular_file(root)) {
        auto extension = root.extension().string();
        std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        auto ticks = extension == ".csv" || extension == ".tsv" ? parse_ticks_csv(root, symbol) : parse_ticks_dat(root, symbol);
        if (!ticks.empty() && cb) {
            cb(ticks);
            return static_cast<int>(ticks.size());
        }
        return 0;
    }

    std::vector<std::filesystem::path> candidates;

    try {
        for (const auto& entry : std::filesystem::recursive_directory_iterator(root)) {
            if (entry.is_regular_file()) {
                std::string fname = entry.path().filename().string();
                std::string parent = entry.path().parent_path().filename().string();

                if (fname == "ticks.dat" && (parent == symbol || parent.find(symbol) != std::string::npos)) {
                    candidates.push_back(entry.path());
                }
            }
        }
    } catch (...) {}

    for (const auto& f : candidates) {
        auto ticks = parse_ticks_dat(f, symbol);
        if (!ticks.empty()) {
            if (cb) cb(ticks);
            return static_cast<int>(ticks.size());
        }
    }

    return 0;
}

} // namespace delta
