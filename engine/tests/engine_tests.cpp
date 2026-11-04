#include "ClusterAggregator.hpp"
#include "MT5FileReader.hpp"
#include "Json.hpp"
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <thread>

using namespace delta;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
template<class F> void rejects(F fn) { bool rejected = false; try { fn(); } catch (const std::exception&) { rejected = true; } require(rejected, "Invalid JSON accepted"); }
Tick tick(int64_t ms, double price, double volume, TradeSide side = TradeSide::Buy) { return {"TEST", ms, price, volume, side, price - 1, price + 1}; }
int main() {
    try {
        std::string command = R"( { "action" : "set_timeframe", "timeframe": 6e1, "path":"C:\\MT5\\\u0442\u0435\u0441\u0442", "ok":true } )";
        JsonCommand json(command);
        require(json.string("action") == "set_timeframe" && json.number("timeframe", 0) == 60, "Whitespace/exponent parsing");
        require(json.string("path").find("C:\\MT5\\") == 0, "Escaped path parsing");
        for (std::string invalid : {"{} trailing", "{\"a\":1,}", "{\"a\":01}", "{\"a\":NaN}", "{\"a\":1e999}", "{\"a\":1,\"a\":2}", "{\"a\":\"\\uD800\"}", "{\"a\":{}}", "[]"}) rejects([&] { JsonCommand bad(invalid); });
        require(json_quote("a\"b\\c\n") == "\"a\\\"b\\\\c\\n\"", "JSON escaping");

        ClusterAggregator a("TEST", 1, 60);
        a.process_tick(tick(60000, 100, 10, TradeSide::Sell));
        a.process_tick(tick(61000, 101, 40));
        auto snapshot = a.serialize_snapshot_json();
        require(snapshot.find("\"poc\":101") != std::string::npos, "POC");
        require(snapshot.find("\"d\":30") != std::string::npos, "Delta");
        require(snapshot.find("[101,0,40,0,1,1,0]") != std::string::npos, "Diagonal buy compares lower bid");
        require(a.get_cumulative_delta() == 30, "CVD");
        a.serialize_live_update_json();
        a.process_tick(tick(119999, 102, 7));
        a.process_tick(tick(120000, 103, 5));
        a.process_tick(tick(180000, 104, 2));
        auto update = a.serialize_live_update_json();
        require(update.find("\"v\":57") != std::string::npos && update.find("\"time\":120") != std::string::npos && update.find("\"time\":180") != std::string::npos, "Final closed candles lost at rollover");
        require(a.serialize_live_update_json().empty(), "Dirty flag");
        a.set_timeframe(120);
        require(a.get_candle_count() == 2 && a.get_cumulative_delta() == 44, "Timeframe replay");
        a.process_tick(tick(60500, 99, 1));
        require(a.get_candle_count() == 2 && a.get_cumulative_delta() == 45, "Out-of-order replay");
        a.process_tick(tick(181000, std::numeric_limits<double>::quiet_NaN(), 1));
        a.process_tick(tick(181000, 1, std::numeric_limits<double>::infinity()));
        auto wrong = tick(181000, 1, 1); wrong.symbol = "OTHER"; a.process_tick(wrong);
        require(a.get_cumulative_delta() == 45, "Invalid ticks accepted");
        ClusterAggregator sparse("TEST", 0.000001, 60);
        sparse.process_tick(tick(60000, 1, 1)); sparse.process_tick(tick(61000, 1000000, 1));
        require(!sparse.serialize_snapshot_json().empty(), "Sparse value area must finish without scanning gaps");

        std::thread writer([&] { for (int i = 0; i < 10000; ++i) a.process_tick(tick(200000 + i, 100 + i % 5, 1)); });
        std::thread reader([&] { for (int i = 0; i < 100; ++i) { a.get_symbol(); a.get_timeframe(); a.get_tick_size(); a.get_cumulative_delta(); a.serialize_snapshot_json(); } });
        writer.join(); reader.join();
        require(a.get_cumulative_delta() == 10045, "Concurrent aggregation");
        ClusterAggregator retained("TEST", 1, 60);
        for (int i = 0; i < 300001; ++i) retained.process_tick(tick(60000 + i, 100, 1));
        retained.set_timeframe(120);
        require(retained.get_cumulative_delta() == 300001, "CVD base lost when raw history evicts ticks");

        ClusterAggregator complete("TEST", 1, 900);
        complete.process_tick(tick(86400001, 90, 2, TradeSide::Sell));
        complete.process_tick(tick(86400002, 110, 3));
        for (int i = 0; i < 300000; ++i) complete.process_tick(tick(86400003 + i, 100, 1));
        auto before_rebuild = complete.serialize_snapshot_json();
        complete.set_timeframe(60);
        complete.set_timeframe(900);
        require(complete.serialize_snapshot_json() == before_rebuild, "Tick limit truncated the first retained candle");
        complete.process_tick(tick(172800001, 120, 1));
        for (int i = 0; i < 300000; ++i) complete.process_tick(tick(172800002 + i, 121, 1));
        const double complete_cvd = complete.get_cumulative_delta();
        complete.set_timeframe(86400);
        require(complete.get_candle_count() == 1, "Whole expired day was not evicted");
        require(complete.get_cumulative_delta() == complete_cvd, "Whole-day eviction lost CVD");
        require(complete.serialize_snapshot_json().find("\"o\":120") != std::string::npos, "Retained day lost its opening tick");

        auto fixture = std::filesystem::current_path() / "engine_test_ticks.csv";
        { std::ofstream file(fixture); file << "<DATE>\t<TIME>\t<BID>\t<ASK>\t<LAST>\t<VOLUME>\t<FLAGS>\n2026.11.02\t12:00:00.001\t1.1\t1.2\t1.2\t5\t32\n2026.11.02\t12:00:00.002\t\t1.3\t1.1\t2\t64\n"; }
        auto ticks = MT5FileReader::parse_ticks_csv(fixture, "TEST");
        require(ticks.size() == 2 && ticks[0].volume == 5 && ticks[1].bid == 1.1 && ticks[1].side == TradeSide::Sell, "MT5 CSV import");
        { std::ofstream file(fixture); file << "2026.11.02,12:00:00.001,NaN,1.2,1.2,5,32\n"; }
        require(MT5FileReader::parse_ticks_csv(fixture, "TEST").empty(), "Invalid CSV must fail");
        std::filesystem::remove(fixture);
        std::cout << "PASS: JSON, aggregation, rollover, timeframe, concurrency, sparse metrics, CSV\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << "FAIL: " << e.what() << '\n'; return 1; }
}
