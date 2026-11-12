#include "ClusterAggregator.hpp"
#include "MT5Receiver.hpp"
#include "MT5FileReader.hpp"
#include "MarketSimulator.hpp"
#include "WSServer.hpp"
#include "Json.hpp"
#include <algorithm>
#include <chrono>
#include <csignal>
#include <iomanip>
#include <iostream>
#include <locale>
#include <mutex>
#include <thread>

using namespace delta;
namespace {
volatile std::sig_atomic_t stopped = 0;
void stop_signal(int) { stopped = 1; }
std::pair<double, double> symbol_defaults(std::string symbol) {
    std::transform(symbol.begin(), symbol.end(), symbol.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    auto has = [&](const char* part) { return symbol.find(part) != std::string::npos; };
    if (has("JPY")) return {0.01, 150};
    if (has("XAU") || has("GOLD")) return {0.1, 2750};
    if (has("XAG") || has("SILVER")) return {0.01, 33};
    if (has("BTC")) return {1, 95000};
    if (has("ETH")) return {0.1, 3300};
    if (has("SOL") || has("BNB")) return {0.05, 200};
    if (has("US30") || has("DJI") || has("DJ30") || has("DOW") || has("WALLSTREET")) return {1, 44000};
    if (has("NAS100") || has("US100") || has("USTEC") || has("NDX") || has("TECH")) return {0.25, 21000};
    if (has("US500") || has("SPX") || has("SP500")) return {0.1, 6000};
    if (has("GER40") || has("DAX")) return {0.5, 19500};
    if (has("OIL") || has("WTI") || has("BRENT")) return {0.01, 70};
    if (has("GAS")) return {0.005, 2.5};
    return {0.0001, has("GBP") ? 1.3 : 1.085};
}
void validate_text(const std::string& text, size_t limit) {
    if (text.size() > limit || std::any_of(text.begin(), text.end(), [](unsigned char c) { return c < 32 || c == ';'; }))
        throw std::invalid_argument("Invalid protocol text");
}
std::ostringstream json_stream() { std::ostringstream s; s.imbue(std::locale::classic()); s << std::setprecision(17); return s; }
}
int main(int argc, char** argv) {
    std::signal(SIGINT, stop_signal); std::signal(SIGTERM, stop_signal);
    bool auto_feeder = true, demo = true, bridge = false;
    int mt5_port = 9190, ws_port = 9191;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--bridge") { bridge = true; auto_feeder = false; demo = false; }
        else if (std::string(argv[i]) == "--no-feeder") auto_feeder = false;
        else if (std::string(argv[i]) == "--no-demo") demo = false;
        else if ((std::string(argv[i]) == "--mt5-port" || std::string(argv[i]) == "--ws-port") && i + 1 < argc) {
            bool mt5 = std::string(argv[i]) == "--mt5-port";
            std::string value = argv[++i]; int port = 0;
            auto parsed = std::from_chars(value.data(), value.data() + value.size(), port);
            if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() || port < 1 || port > 65535) return 2;
            (mt5 ? mt5_port : ws_port) = port;
        }
        else { std::cerr << "Usage: delta_engine [--bridge] [--no-feeder] [--no-demo] [--mt5-port N] [--ws-port N]\n"; return 2; }
    }
    std::cout << "DeltaORL C++20 Engine\n";
    ClusterAggregator aggregator;
    MT5FileReader files;
    MT5Receiver receiver(mt5_port);
    MarketSimulator simulator;
    WSServer server(ws_port);
    std::mutex state;
    bool broker_ready = false, loading = false, received_tick = false;
    uint64_t demo_generation = 1;
    std::string requested_symbol = "EURUSD";
    std::vector<DOMEntry> real_dom;
    std::vector<uint64_t> pending_connections;
    auto snapshot = [&](uint64_t id = 0) {
        server.send_to(id, aggregator.serialize_snapshot_json(1000));
        server.send_to(id, aggregator.serialize_profile_json());
    };
    auto load_result = [&](uint64_t id, bool success, const std::string& symbol, const std::string& message) {
        server.send_to(id, "{\"type\":\"mt5_load_result\",\"count\":" + std::string(success ? "1" : "0") + ",\"symbol\":" + json_quote(symbol) + ",\"msg\":" + json_quote(message) + "}");
    };
    auto terminals = [&](uint64_t id) {
        auto terms = files.detect_terminals();
        auto ss = json_stream(); ss << "{\"type\":\"mt5_terminals\",\"terminals\":[";
        for (size_t i = 0; i < terms.size(); ++i) {
            if (i) ss << ',';
            ss << "{\"id\":" << json_quote(terms[i].terminal_id) << ",\"path\":" << json_quote(terms[i].root_path) << ",\"servers\":[";
            for (size_t j = 0; j < terms[i].servers.size(); ++j) { if (j) ss << ','; ss << json_quote(terms[i].servers[j]); }
            ss << "]}";
        }
        ss << "]}"; server.send_to(id, ss.str());
    };
    auto demo_symbol = [&](const std::string& symbol) {
        auto [step, price] = symbol_defaults(symbol);
        aggregator.set_symbol(symbol, step); demo_generation = simulator.set_symbol(symbol, price, step);
        simulator.set_enabled(demo); loading = false; real_dom.clear();
    };
    auto tick_message = [&](const Tick& tick) {
        auto ss = json_stream();
        ss << "{\"type\":\"tick\",\"sym\":" << json_quote(tick.symbol) << ",\"p\":" << tick.price
           << ",\"v\":" << tick.volume << ",\"s\":" << static_cast<int>(tick.side) << ",\"t\":" << tick.time_msc << '}';
        server.broadcast(ss.str());
    };
    receiver.set_connection_callback([&](bool connected) {
        if (connected) return;
        std::lock_guard lock(state);
        std::cout << "[MT5] Disconnected" << std::endl;
        broker_ready = false;
        demo_symbol(requested_symbol);
        for (auto id : pending_connections) load_result(id, false, requested_symbol, "З'єднання з MT5 втрачено.");
        pending_connections.clear(); snapshot();
    });
    receiver.set_handshake_callback([&](const std::string& symbol, double step, int) {
        std::lock_guard lock(state);
        received_tick = false;
        std::cout << "[MT5] HELLO " << symbol << std::endl;
        simulator.set_enabled(false); broker_ready = true; loading = true; real_dom.clear();
        requested_symbol = symbol; aggregator.set_symbol(symbol, step); snapshot();
    });
    receiver.set_tick_callback([&](const Tick& tick) {
        std::lock_guard lock(state);
        if (!broker_ready || tick.symbol != aggregator.get_symbol()) return;
        received_tick = true;
        aggregator.process_tick(tick);
        if (!loading) tick_message(tick);
    });
    receiver.set_ready_callback([&] {
        std::lock_guard lock(state);
        if (!broker_ready) return;
        std::cout << "[MT5] READY; received ticks: " << receiver.get_total_ticks() << std::endl;
        loading = false; snapshot();
        for (auto id : pending_connections) load_result(id, true, aggregator.get_symbol(), "MT5 підключено, історію завантажено.");
        pending_connections.clear();
    });
    receiver.set_dom_callback([&](const std::string& symbol, const std::vector<DOMEntry>& dom) {
        std::lock_guard lock(state);
        if (broker_ready && symbol == aggregator.get_symbol()) real_dom = dom;
    });
    receiver.set_error_callback([&](const std::string& symbol, const std::string& message) {
        std::lock_guard lock(state);
        broker_ready = false; demo_symbol(requested_symbol);
        if (pending_connections.empty()) load_result(0, false, symbol, message);
        else for (auto id : pending_connections) load_result(id, false, symbol, message);
        pending_connections.clear(); snapshot();
    });
    server.set_message_callback([&](uint64_t id, const std::string& message) {
        try {
            JsonCommand command(message);
            auto action = command.string("action");
            std::lock_guard lock(state);
            if (action == "get_snapshot") snapshot(id);
            else if (action == "get_mt5_terminals") terminals(id);
            else if (action == "set_timeframe") {
                double tf = command.number("timeframe", 60);
                if (tf < 1 || tf > 86400 || std::floor(tf) != tf) throw std::invalid_argument("Timeframe must be 1..86400 seconds");
                if (aggregator.get_timeframe() != static_cast<int>(tf)) aggregator.set_timeframe(static_cast<int>(tf));
                snapshot();
            } else if (action == "set_imbalance") {
                double ratio = command.number("ratio", 3), minimum = command.number("min_vol", 1);
                if (ratio <= 0 || ratio > 1000 || minimum < 0 || minimum > 1e12) throw std::invalid_argument("Invalid imbalance parameters");
                aggregator.set_imbalance_params(ratio, minimum); snapshot();
            } else if (action == "set_symbol" || action == "connect_mt5" || action == "load_mt5_path") {
                std::string symbol = command.string("symbol", requested_symbol);
                validate_text(symbol, 128); if (symbol.empty()) throw std::invalid_argument("Empty symbol");
                std::string path = action == "set_symbol" ? receiver.get_active_path() : command.string("path");
                validate_text(path, 16000);
                requested_symbol = symbol; receiver.set_active_path(path);
                if (!broker_ready) { demo_symbol(symbol); snapshot(); }
                if (action != "set_symbol") pending_connections.push_back(id);
                bool ok;
                if (receiver.is_connected()) {
                    std::string cmd = !bridge && action != "set_symbol" && !path.empty() ? "PATH;" + path + "\n" : "";
                    ok = receiver.send_command(cmd + "SWITCH;" + symbol + "\n");
                } else if (bridge) {
                    load_result(id, false, symbol, "Очікування DeltaBridge на 127.0.0.1:9190. Прикріпіть радник до графіка MT5; Python feeder вимкнено.");
                    pending_connections.clear();
                    return;
                } else ok = receiver.trigger_feeder(path, symbol);
                if (!ok) {
                    pending_connections.clear();
                    load_result(id, false, symbol, "Не вдалося запустити Python або передати команду MT5. Перевірте engine/mt5_feeder.log.");
                }
            } else if (action == "install_ea") {
                std::string path = command.string("path"), destination;
                validate_text(path, 16000);
                bool ok = files.install_ea(path, destination);
                server.send_to(id, "{\"type\":\"install_ea_result\",\"success\":" + std::string(ok ? "true" : "false") + ",\"destination\":" + json_quote(destination) + "}");
            } else throw std::invalid_argument("Unknown command");
        } catch (const std::exception& e) {
            server.send_to(id, "{\"type\":\"error\",\"msg\":" + json_quote(e.what()) + "}");
        }
    });
    server.set_connection_callback([&](uint64_t id, bool connected) {
        std::lock_guard lock(state);
        if (connected) { snapshot(id); terminals(id); }
        else std::erase(pending_connections, id);
    });
    // Bind both ports before starting feeder/demo work. Failures reach the launcher.
    if (!server.start()) { std::cerr << "WebSocket port unavailable: " << ws_port << '\n'; return 1; }
    if (!receiver.start()) { std::cerr << "MT5 port unavailable: " << mt5_port << '\n'; server.stop(); return 1; }
    simulator.set_enabled(demo);
    simulator.start([&](const Tick& tick, uint64_t generation) {
        std::lock_guard lock(state);
        if (!broker_ready && demo && generation == demo_generation && tick.symbol == aggregator.get_symbol()) aggregator.process_tick(tick);
    });
    if (auto_feeder && !receiver.trigger_feeder("", requested_symbol)) std::cerr << "MT5 feeder unavailable; demo mode active.\n";
    int iteration = 0;
    while (!stopped) {
        std::this_thread::sleep_for(std::chrono::milliseconds(33));
        std::lock_guard lock(state);
        if (!loading) server.broadcast(aggregator.serialize_live_update_json());
        if (++iteration % 15 == 0) {
            auto ss = json_stream();
            ss << "{\"type\":\"stats\",\"mt5_connected\":" << (broker_ready && !loading && received_tick ? "true" : "false")
               << ",\"mt5_status\":" << json_quote(broker_ready && !loading && received_tick ? "Connected" : (receiver.is_connected() ? "Connecting" : "Disconnected"))
               << ",\"demo\":" << (demo && !broker_ready ? "true" : "false")
               << ",\"symbol\":" << json_quote(aggregator.get_symbol()) << ",\"tick_size\":" << aggregator.get_tick_size()
               << ",\"timeframe\":" << aggregator.get_timeframe() << ",\"ticks_per_sec\":" << (broker_ready ? receiver.get_ticks_per_sec() : 0)
               << ",\"cvd\":" << aggregator.get_cumulative_delta() << ",\"broker\":" << json_quote(broker_ready ? receiver.get_broker_info() : (demo ? "Simulator" : "Disconnected"))
               << ",\"ui_clients\":" << server.get_client_count() << '}';
            server.broadcast(ss.str());
            auto dom = broker_ready ? real_dom : (demo ? simulator.generate_simulated_dom(10) : std::vector<DOMEntry>{});
            auto ds = json_stream(); ds << "{\"type\":\"dom\",\"simulated\":" << (broker_ready ? "false" : "true") << ",\"levels\":[";
            for (size_t i = 0; i < dom.size(); ++i) { if (i) ds << ','; ds << '[' << dom[i].price << ',' << dom[i].volume << ',' << dom[i].type << ']'; }
            ds << "]}"; server.broadcast(ds.str());
            if (!loading && iteration % 60 == 0) server.broadcast(aggregator.serialize_profile_json());
        }
    }
    receiver.stop(); simulator.stop(); server.stop();
    return 0;
}
