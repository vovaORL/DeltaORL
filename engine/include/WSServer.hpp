#pragma once
#include "Types.hpp"
#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>
#include <deque>
#include <chrono>

namespace delta {

class WSServer {
public:
    using MessageCallback = std::function<void(uint64_t client_id, const std::string& message)>;
    using ConnectionCallback = std::function<void(uint64_t client_id, bool connected)>;

    WSServer(int port = 9191);
    ~WSServer();

    bool start();
    void stop();

    void broadcast(const std::string& text);
    void send_to(uint64_t client_id, const std::string& text);

    void set_message_callback(MessageCallback cb) { message_cb_ = std::move(cb); }
    void set_connection_callback(ConnectionCallback cb) { conn_cb_ = std::move(cb); }

    int get_client_count();

private:
    void server_loop();
    static std::string calculate_ws_accept(const std::string& client_key);
    static std::vector<uint8_t> encode_frame(const std::string& message, uint8_t opcode = 1);

    int port_;
    std::atomic<bool> running_{false};
    std::thread server_thread_;
    uintptr_t listen_socket_ = static_cast<uintptr_t>(-1);

    struct Client {
        uint64_t id;
        uintptr_t socket;
        bool handshaked = false;
        bool closing = false;
        bool close_after_send = false;
        std::vector<uint8_t> buffer;
        std::string fragmented;
        bool in_fragment = false;
        std::deque<std::shared_ptr<const std::vector<uint8_t>>> outgoing;
        size_t send_offset = 0;
        size_t queued_bytes = 0;
        std::chrono::steady_clock::time_point accepted = std::chrono::steady_clock::now();
    };

    std::mutex clients_mutex_;
    std::vector<std::shared_ptr<Client>> clients_;
    std::atomic<uint64_t> next_client_id_{1};

    MessageCallback message_cb_;
    ConnectionCallback conn_cb_;
};

} // namespace delta
