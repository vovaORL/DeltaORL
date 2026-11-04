#include "MT5Receiver.hpp"
#include <ws2tcpip.h>
#include <windows.h>
#include <algorithm>
#include <charconv>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <sstream>

namespace delta {
namespace {
std::vector<std::string> split(const std::string& line, char separator) {
    std::vector<std::string> fields;
    std::stringstream stream(line);
    std::string field;
    while (std::getline(stream, field, separator)) fields.push_back(field);
    return fields;
}
template<class T> T number(const std::string& s) {
    T result{};
    auto parsed = std::from_chars(s.data(), s.data() + s.size(), result);
    if (parsed.ec != std::errc{} || parsed.ptr != s.data() + s.size() || !std::isfinite(static_cast<double>(result))) throw std::invalid_argument("Invalid number");
    return result;
}
std::wstring wide(const std::string& s) {
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
    if (size <= 0 && !s.empty()) throw std::invalid_argument("Invalid UTF-8");
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), result.data(), size);
    return result;
}
// Quote for CreateProcess argv parsing; no shell is involved.
std::wstring quote(const std::wstring& s) {
    std::wstring out = L"\"";
    size_t slashes = 0;
    for (wchar_t c : s) {
        if (c == L'\\') { ++slashes; continue; }
        out.append(slashes * (c == L'"' ? 2 : 1), L'\\'); slashes = 0;
        if (c == L'"') out += L'\\';
        out += c;
    }
    out.append(slashes * 2, L'\\');
    return out + L'"';
}
}
MT5Receiver::MT5Receiver(int port) : port_(port) {}
MT5Receiver::~MT5Receiver() { stop(); }
bool MT5Receiver::start() {
    if (running_) return true;
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data)) return false;
    listen_sock_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock_ == INVALID_SOCKET) { WSACleanup(); return false; }
    BOOL exclusive = TRUE;
    setsockopt(listen_sock_, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive), sizeof(exclusive));
    sockaddr_in address{};
    address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = htons(static_cast<u_short>(port_));
    if (bind(listen_sock_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR || listen(listen_sock_, 4) == SOCKET_ERROR) {
        closesocket(listen_sock_); listen_sock_ = INVALID_SOCKET; WSACleanup(); return false;
    }
    running_ = true;
    worker_ = std::thread(&MT5Receiver::server_loop, this);
    return true;
}
void MT5Receiver::stop() {
    running_ = false;
    if (worker_.joinable()) worker_.join();
}
bool MT5Receiver::send_command(const std::string& cmd) {
    std::lock_guard lock(client_mutex_);
    if (client_sock_ == INVALID_SOCKET) return false;
    size_t offset = 0;
    while (offset < cmd.size()) {
        int n = send(client_sock_, cmd.data() + offset, static_cast<int>(cmd.size() - offset), 0);
        if (n <= 0) return false;
        offset += n;
    }
    return true;
}
bool MT5Receiver::trigger_feeder(const std::string& mt5_path, const std::string& symbol) {
    try {
        wchar_t executable[32768];
        DWORD size = GetModuleFileNameW(nullptr, executable, 32768);
        auto root = std::filesystem::path(std::wstring(executable, size)).parent_path();
        auto script = root / "mt5_feeder.py";
        if (!std::filesystem::exists(script)) script = root / "engine" / "mt5_feeder.py";
        if (!std::filesystem::exists(script)) return false;
        std::wstring python;
        if (auto configured = _wgetenv(L"DELTAORL_PYTHON")) python = configured;
        if (python.empty()) {
            // Prefer a real interpreter over the WindowsApps execution alias.
            if (auto local = _wgetenv(L"LOCALAPPDATA")) {
                for (auto base : {std::filesystem::path(local) / "Python", std::filesystem::path(local) / "Programs" / "Python"}) {
                    if (!std::filesystem::exists(base)) continue;
                    for (const auto& entry : std::filesystem::directory_iterator(base)) {
                        if (std::filesystem::exists(entry.path() / "python.exe")) python = (entry.path() / "python.exe").wstring();
                    }
                }
            }
        }
        if (python.empty()) {
            wchar_t found[32768];
            DWORD n = SearchPathW(nullptr, L"python.exe", nullptr, 32768, found, nullptr);
            if (n == 0 || n >= 32768) return false;
            python.assign(found, n);
        }
        std::wstring command = quote(python) + L" -u " + quote(script.wstring()) + L" --port " + std::to_wstring(port_) + L" --symbol " + quote(wide(symbol));
        if (!mt5_path.empty()) command += L" --path " + quote(wide(mt5_path));
        STARTUPINFOW startup{}; startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(python.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, root.c_str(), &startup, &process)) return false;
        CloseHandle(process.hThread); CloseHandle(process.hProcess);
        return true;
    } catch (const std::exception& e) { std::cerr << "[MT5Receiver] Feeder launch: " << e.what() << '\n'; return false; }
}
void MT5Receiver::server_loop() {
    std::cout << "[MT5Receiver] Listening on 127.0.0.1:" << port_ << '\n';
    auto rate_time = std::chrono::steady_clock::now();
    int64_t previous = total_ticks_;
    std::string buffer;
    while (running_) {
        SOCKET client;
        { std::lock_guard lock(client_mutex_); client = client_sock_; }
        fd_set reads; FD_ZERO(&reads); FD_SET(listen_sock_, &reads);
        if (client != INVALID_SOCKET) FD_SET(client, &reads);
        timeval timeout{0, 100000};
        int selected = select(0, &reads, nullptr, nullptr, &timeout);
        auto now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - rate_time).count();
        if (elapsed >= 1) { auto ticks = total_ticks_.load(); ticks_per_sec_ = (ticks - previous) / elapsed; previous = ticks; rate_time = now; }
        if (selected == SOCKET_ERROR) break;
        if (FD_ISSET(listen_sock_, &reads)) {
            SOCKET accepted = accept(listen_sock_, nullptr, nullptr);
            if (accepted != INVALID_SOCKET) {
                if (client != INVALID_SOCKET) closesocket(accepted);
                else {
                    DWORD timeout_ms = 500;
                    setsockopt(accepted, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout_ms), sizeof(timeout_ms));
                    BOOL yes = TRUE;
                    setsockopt(accepted, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&yes), sizeof(yes));
                    { std::lock_guard lock(client_mutex_); client_sock_ = accepted; }
                    { std::lock_guard lock(state_mutex_); broker_info_ = "MT5"; connected_symbol_.clear(); }
                    buffer.clear(); client_connected_ = true;
                    if (connection_cb_) connection_cb_(true);
                }
            }
        }
        if (client != INVALID_SOCKET && FD_ISSET(client, &reads)) {
            char bytes[65536]; int n = recv(client, bytes, sizeof(bytes), 0);
            bool disconnected = n <= 0;
            if (n > 0) {
                buffer.append(bytes, n);
                size_t begin = 0, end;
                while ((end = buffer.find('\n', begin)) != std::string::npos) {
                    std::string line = buffer.substr(begin, end - begin); begin = end + 1;
                    if (!line.empty() && line.back() == '\r') line.pop_back();
                    if (line.size() <= 65536) {
                        try { parse_line(line); }
                        catch (const std::exception& e) { std::cerr << "[MT5Receiver] Ignored malformed message: " << e.what() << '\n'; }
                    }
                }
                buffer.erase(0, begin);
                if (buffer.size() > 65536) disconnected = true;
            }
            if (disconnected) {
                { std::lock_guard lock(client_mutex_); closesocket(client_sock_); client_sock_ = INVALID_SOCKET; }
                client_connected_ = false; ticks_per_sec_ = 0;
                if (connection_cb_) connection_cb_(false);
            }
        }
    }
    { std::lock_guard lock(client_mutex_); if (client_sock_ != INVALID_SOCKET) closesocket(client_sock_); client_sock_ = INVALID_SOCKET; }
    closesocket(listen_sock_); listen_sock_ = INVALID_SOCKET;
    client_connected_ = false; WSACleanup(); running_ = false;
}
void MT5Receiver::parse_line(const std::string& line) {
    auto fields = split(line, ';');
    if (fields.empty()) return;
    const auto& kind = fields[0];
    if (kind == "TICK" && fields.size() == 8) {
        Tick tick;
        tick.symbol = fields[1]; tick.time_msc = number<int64_t>(fields[2]); tick.price = number<double>(fields[3]); tick.volume = number<double>(fields[4]);
        int side = number<int>(fields[5]); tick.side = side == 1 ? TradeSide::Buy : (side == -1 ? TradeSide::Sell : TradeSide::Unknown);
        tick.bid = number<double>(fields[6]); tick.ask = number<double>(fields[7]);
        if (tick.price <= 0 || tick.volume <= 0 || tick.time_msc <= 0) return;
        ++total_ticks_; if (tick_cb_) tick_cb_(tick);
    } else if (kind == "HELLO" && fields.size() >= 4) {
        double step = number<double>(fields[2]); int digits = number<int>(fields[3]);
        if (fields[1].empty() || step <= 0 || digits < 0 || digits > 12) return;
        { std::lock_guard lock(state_mutex_); connected_symbol_ = fields[1]; }
        if (handshake_cb_) handshake_cb_(fields[1], step, digits);
    } else if (kind == "INFO" && fields.size() >= 2) {
        std::lock_guard lock(state_mutex_); broker_info_ = line.substr(5);
    } else if (kind == "READY") {
        if (ready_cb_) ready_cb_();
    } else if (kind == "DOM" && fields.size() >= 3) {
        int count = number<int>(fields[2]);
        if (count < 0 || count > 200 || fields.size() != static_cast<size_t>(count + 3)) return;
        std::vector<DOMEntry> dom;
        for (int i = 0; i < count; ++i) {
            auto row = split(fields[i + 3], ',');
            if (row.size() != 3) return;
            DOMEntry entry{number<double>(row[0]), number<double>(row[1]), number<int>(row[2])};
            if (entry.price <= 0 || entry.volume < 0 || (entry.type != 1 && entry.type != 2)) return;
            dom.push_back(entry);
        }
        if (dom_cb_) dom_cb_(fields[1], dom);
    } else if (kind == "ERROR" && fields.size() >= 3) {
        if (error_cb_) error_cb_(fields[1], line.substr(line.find(';', 6) + 1));
    }
}
} // namespace delta
