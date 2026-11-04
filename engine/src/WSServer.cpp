#include "WSServer.hpp"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <wincrypt.h>
#include <algorithm>
#include <iostream>

namespace delta {
constexpr size_t max_queue = 32 * 1024 * 1024;
constexpr size_t max_command = 65536;

std::string WSServer::calculate_ws_accept(const std::string& key) {
    const std::string combined = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    HCRYPTPROV provider = 0;
    HCRYPTHASH hash = 0;
    std::string result;
    if (CryptAcquireContext(&provider, nullptr, nullptr, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
        if (CryptCreateHash(provider, CALG_SHA1, 0, 0, &hash)) {
            BYTE digest[20]; DWORD length = sizeof(digest);
            if (CryptHashData(hash, reinterpret_cast<const BYTE*>(combined.data()), static_cast<DWORD>(combined.size()), 0) &&
                CryptGetHashParam(hash, HP_HASHVAL, digest, &length, 0)) {
                DWORD size = 0;
                CryptBinaryToStringA(digest, length, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &size);
                std::vector<char> encoded(size);
                if (CryptBinaryToStringA(digest, length, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, encoded.data(), &size)) result = encoded.data();
            }
            CryptDestroyHash(hash);
        }
        CryptReleaseContext(provider, 0);
    }
    return result;
}
std::vector<uint8_t> WSServer::encode_frame(const std::string& text, uint8_t opcode) {
    std::vector<uint8_t> frame;
    uint64_t n = text.size();
    frame.reserve(text.size() + 10);
    frame.push_back(0x80 | opcode);
    if (n <= 125) frame.push_back(static_cast<uint8_t>(n));
    else if (n <= 65535) { frame.push_back(126); frame.push_back(static_cast<uint8_t>(n >> 8)); frame.push_back(static_cast<uint8_t>(n)); }
    else { frame.push_back(127); for (int i = 7; i >= 0; --i) frame.push_back(static_cast<uint8_t>(n >> (8 * i))); }
    frame.insert(frame.end(), text.begin(), text.end());
    return frame;
}
WSServer::WSServer(int port) : port_(port) {}
WSServer::~WSServer() { stop(); }
bool WSServer::start() {
    if (running_) return true;
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data)) return false;
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) { WSACleanup(); return false; }
    BOOL exclusive = TRUE;
    setsockopt(sock, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive), sizeof(exclusive));
    sockaddr_in address{};
    address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = htons(static_cast<u_short>(port_));
    u_long mode = 1;
    if (bind(sock, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR || listen(sock, 16) == SOCKET_ERROR || ioctlsocket(sock, FIONBIO, &mode) == SOCKET_ERROR) {
        closesocket(sock); WSACleanup(); return false;
    }
    listen_socket_ = static_cast<uintptr_t>(sock);
    running_ = true;
    server_thread_ = std::thread(&WSServer::server_loop, this);
    return true;
}
void WSServer::stop() { running_ = false; if (server_thread_.joinable()) server_thread_.join(); }
int WSServer::get_client_count() {
    std::lock_guard lock(clients_mutex_);
    return static_cast<int>(std::count_if(clients_.begin(), clients_.end(), [](const auto& c) { return c->handshaked && !c->closing; }));
}
void WSServer::broadcast(const std::string& text) { send_to(0, text); }
void WSServer::send_to(uint64_t id, const std::string& text) {
    if (text.empty()) return;
    auto frame = std::make_shared<const std::vector<uint8_t>>(encode_frame(text));
    std::lock_guard lock(clients_mutex_);
    for (auto& c : clients_) {
        if ((id != 0 && c->id != id) || !c->handshaked || c->closing || c->close_after_send) continue;
        if (c->queued_bytes + frame->size() > max_queue) { c->closing = true; continue; }
        c->outgoing.push_back(frame); c->queued_bytes += frame->size();
    }
}
void WSServer::server_loop() {
    SOCKET listener = static_cast<SOCKET>(listen_socket_);
    std::cout << "[WSServer] Listening on ws://127.0.0.1:" << port_ << '\n';
    while (running_) {
        fd_set reads, writes;
        FD_ZERO(&reads); FD_ZERO(&writes); FD_SET(listener, &reads);
        std::vector<std::shared_ptr<Client>> current;
        {
            std::lock_guard lock(clients_mutex_);
            current = clients_;
            for (auto& c : current) {
                if (c->closing) continue;
                FD_SET(static_cast<SOCKET>(c->socket), &reads);
                if (!c->outgoing.empty()) FD_SET(static_cast<SOCKET>(c->socket), &writes);
            }
        }
        timeval timeout{0, 10000};
        if (select(0, &reads, &writes, nullptr, &timeout) == SOCKET_ERROR) break;
        if (FD_ISSET(listener, &reads)) {
            SOCKET sock = accept(listener, nullptr, nullptr);
            if (sock != INVALID_SOCKET) {
                u_long mode = 1; ioctlsocket(sock, FIONBIO, &mode);
                BOOL yes = TRUE; setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&yes), sizeof(yes));
                std::lock_guard lock(clients_mutex_);
                if (clients_.size() >= 32) closesocket(sock);
                else { auto c = std::make_shared<Client>(); c->id = next_client_id_++; c->socket = static_cast<uintptr_t>(sock); clients_.push_back(c); }
            }
        }
        for (auto& c : current) {
            bool opened = false;
            std::vector<std::string> messages;
            {
                std::lock_guard lock(clients_mutex_);
                SOCKET sock = static_cast<SOCKET>(c->socket);
                auto enqueue = [&](std::vector<uint8_t> bytes) {
                    if (c->queued_bytes + bytes.size() > max_queue) { c->closing = true; return; }
                    c->queued_bytes += bytes.size(); c->outgoing.push_back(std::make_shared<const std::vector<uint8_t>>(std::move(bytes)));
                };
                if (!c->handshaked && std::chrono::steady_clock::now() - c->accepted > std::chrono::seconds(5)) c->closing = true;
                if (!c->closing && FD_ISSET(sock, &reads)) {
                    uint8_t bytes[16384];
                    int n = recv(sock, reinterpret_cast<char*>(bytes), sizeof(bytes), 0);
                    if (n == 0 || (n < 0 && WSAGetLastError() != WSAEWOULDBLOCK)) c->closing = true;
                    if (n > 0) c->buffer.insert(c->buffer.end(), bytes, bytes + n);
                    if (!c->handshaked && !c->closing) {
                        std::string req(c->buffer.begin(), c->buffer.end());
                        size_t end = req.find("\r\n\r\n");
                        if (end != std::string::npos) {
                            std::string lower = req.substr(0, end + 4);
                            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char v) { return static_cast<char>(std::tolower(v)); });
                            const std::string marker = "\r\nsec-websocket-key:";
                            size_t key = lower.find(marker);
                            if (req.rfind("GET ", 0) || key == std::string::npos || lower.find("upgrade: websocket") == std::string::npos) c->closing = true;
                            else {
                                size_t begin = key + marker.size();
                                while (begin < end && (req[begin] == ' ' || req[begin] == '\t')) ++begin;
                                size_t finish = req.find("\r\n", begin);
                                std::string accept_key = calculate_ws_accept(req.substr(begin, finish - begin));
                                if (accept_key.empty()) c->closing = true;
                                else {
                                    std::string response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept_key + "\r\n\r\n";
                                    enqueue(std::vector<uint8_t>(response.begin(), response.end())); c->handshaked = true; opened = true;
                                }
                            }
                            c->buffer.erase(c->buffer.begin(), c->buffer.begin() + end + 4);
                        } else if (c->buffer.size() > 16384) c->closing = true;
                    }
                    while (c->handshaked && !c->closing && !c->close_after_send && c->buffer.size() >= 2) {
                        auto& b = c->buffer;
                        bool fin = (b[0] & 0x80) != 0;
                        uint8_t opcode = b[0] & 15;
                        uint64_t length = b[1] & 127; size_t header = 2;
                        if ((b[0] & 0x70) || !(b[1] & 0x80)) { c->closing = true; break; }
                        if (length == 126) { if (b.size() < 4) break; length = (uint64_t(b[2]) << 8) | b[3]; header = 4; }
                        else if (length == 127) { if (b.size() < 10) break; length = 0; for (int i = 2; i < 10; ++i) length = (length << 8) | b[i]; header = 10; }
                        if (length > max_command || (opcode >= 8 && (!fin || length > 125))) { c->closing = true; break; }
                        if (b.size() < header + 4 + length) break;
                        std::string payload;
                        for (size_t i = 0; i < length; ++i) payload += char(b[header + 4 + i] ^ b[header + i % 4]);
                        b.erase(b.begin(), b.begin() + header + 4 + static_cast<size_t>(length));
                        if (opcode == 8) { enqueue(encode_frame(payload, 8)); c->close_after_send = true; }
                        else if (opcode == 9) enqueue(encode_frame(payload, 10));
                        else if (opcode == 10) {}
                        else if (opcode == 1 && !c->in_fragment) {
                            if (fin) messages.push_back(std::move(payload));
                            else { c->fragmented = std::move(payload); c->in_fragment = true; }
                        } else if (opcode == 0 && c->in_fragment) {
                            c->fragmented += payload;
                            if (c->fragmented.size() > max_command) { c->closing = true; break; }
                            if (fin) { messages.push_back(std::move(c->fragmented)); c->fragmented.clear(); c->in_fragment = false; }
                        } else { c->closing = true; break; }
                    }
                }
                if (!c->closing && FD_ISSET(sock, &writes)) {
                    size_t budget = 256 * 1024;
                    while (!c->outgoing.empty() && budget > 0) {
                        const auto& frame = *c->outgoing.front();
                        size_t amount = std::min({frame.size() - c->send_offset, budget, size_t(32768)});
                        int sent = send(sock, reinterpret_cast<const char*>(frame.data() + c->send_offset), static_cast<int>(amount), 0);
                        if (sent <= 0) { if (sent == 0 || WSAGetLastError() != WSAEWOULDBLOCK) c->closing = true; break; }
                        c->send_offset += sent; c->queued_bytes -= sent; budget -= sent;
                        if (c->send_offset == frame.size()) { c->outgoing.pop_front(); c->send_offset = 0; }
                    }
                    if (c->close_after_send && c->outgoing.empty()) c->closing = true;
                }
            }
            try {
                if (opened && conn_cb_) conn_cb_(c->id, true);
                for (const auto& msg : messages) if (message_cb_) message_cb_(c->id, msg);
            } catch (const std::exception& e) { std::cerr << "[WSServer] Callback: " << e.what() << '\n'; }
        }
        std::vector<uint64_t> disconnected;
        {
            std::lock_guard lock(clients_mutex_);
            std::erase_if(clients_, [&](auto& c) {
                if (!c->closing) return false;
                closesocket(static_cast<SOCKET>(c->socket));
                if (c->handshaked) disconnected.push_back(c->id);
                return true;
            });
        }
        for (auto id : disconnected) if (conn_cb_) conn_cb_(id, false);
    }
    { std::lock_guard lock(clients_mutex_); for (auto& c : clients_) closesocket(static_cast<SOCKET>(c->socket)); clients_.clear(); }
    closesocket(listener); listen_socket_ = static_cast<uintptr_t>(-1); WSACleanup(); running_ = false;
}
} // namespace delta
