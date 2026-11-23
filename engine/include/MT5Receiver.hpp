#pragma once
#include "Types.hpp"
#include <string>
#include <atomic>
#include <thread>
#include <functional>
#include <mutex>

#include "SocketPlatform.hpp"

namespace delta {

class MT5Receiver {
public:
    using TickCallback = std::function<void(const Tick&)>;
    using HandshakeCallback = std::function<void(const std::string& symbol, double tick_size, int digits)>;
    using ReadyCallback = std::function<void()>;
    using DOMCallback = std::function<void(const std::string& symbol, const std::vector<DOMEntry>&)>;
    using ConnectionCallback = std::function<void(bool)>;
    using ErrorCallback = std::function<void(const std::string&, const std::string&)>;

    MT5Receiver(int port = 9190);
    ~MT5Receiver();

    bool start();
    void stop();

    void set_tick_callback(TickCallback cb) { tick_cb_ = std::move(cb); }
    void set_handshake_callback(HandshakeCallback cb) { handshake_cb_ = std::move(cb); }
    void set_ready_callback(ReadyCallback cb) { ready_cb_ = std::move(cb); }
    void set_dom_callback(DOMCallback cb) { dom_cb_ = std::move(cb); }
    void set_connection_callback(ConnectionCallback cb) { connection_cb_ = std::move(cb); }
    void set_error_callback(ErrorCallback cb) { error_cb_ = std::move(cb); }

    bool is_connected() const { return client_connected_.load(); }
    int64_t get_total_ticks() const { return total_ticks_.load(); }
    double get_ticks_per_sec() const { return ticks_per_sec_.load(); }
    std::string get_connected_symbol() const { std::lock_guard lock(state_mutex_); return connected_symbol_; }
    std::string get_broker_info() const { std::lock_guard lock(state_mutex_); return broker_info_; }

    bool send_command(const std::string& cmd);
    bool trigger_feeder(const std::string& mt5_path, const std::string& symbol);
    void set_active_path(const std::string& path) { std::lock_guard lock(state_mutex_); active_path_ = path; }
    std::string get_active_path() const { std::lock_guard lock(state_mutex_); return active_path_; }

private:
    void server_loop();
    void parse_line(const std::string& line);

    int port_;
    std::atomic<bool> running_{false};
    std::atomic<bool> client_connected_{false};
    std::atomic<int64_t> total_ticks_{0};
    std::atomic<double> ticks_per_sec_{0.0};
    std::string connected_symbol_ = "Disconnected";
    std::string broker_info_ = "MT5 Direct";
    std::string active_path_ = "";
    mutable std::mutex state_mutex_;
    SOCKET listen_sock_ = INVALID_SOCKET;

    SOCKET client_sock_ = INVALID_SOCKET;
    std::mutex client_mutex_;

    std::thread worker_;
    TickCallback tick_cb_;
    HandshakeCallback handshake_cb_;
    ReadyCallback ready_cb_;
    DOMCallback dom_cb_;
    ConnectionCallback connection_cb_;
    ErrorCallback error_cb_;
};

} // namespace delta
