#pragma once

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <cerrno>
#include <netinet/tcp.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <unistd.h>

using SOCKET = int;
inline constexpr SOCKET INVALID_SOCKET = -1;
inline constexpr int SOCKET_ERROR = -1;
inline constexpr int WSAEWOULDBLOCK = EWOULDBLOCK;
using BOOL = int;
inline constexpr BOOL TRUE = 1;
struct WSADATA {};
inline int WSAStartup(int, WSADATA*) { return 0; }
inline void WSACleanup() {}
inline int MAKEWORD(int, int) { return 0; }
inline int closesocket(SOCKET socket) { return close(socket); }
inline int WSAGetLastError() { return errno; }
inline int ioctlsocket(SOCKET socket, unsigned long request, unsigned long* value) { return ioctl(socket, request, value); }
#endif

namespace delta {
inline SOCKET create_socket() {
#ifdef _WIN32
    return socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
    return socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, IPPROTO_TCP);
#endif
}
inline SOCKET accept_socket(SOCKET listener) {
#ifdef _WIN32
    return accept(listener, nullptr, nullptr);
#else
    // A Wine feeder must not keep the engine's sockets open after engine exit.
    return accept4(listener, nullptr, nullptr, SOCK_CLOEXEC);
#endif
}
inline void configure_listener(SOCKET socket) {
    int enabled = 1;
#ifdef _WIN32
    setsockopt(socket, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&enabled), sizeof(enabled));
#else
    setsockopt(socket, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
#endif
}
inline int select_sockets(fd_set* reads, fd_set* writes, timeval* timeout) {
#ifdef _WIN32
    return select(0, reads, writes, nullptr, timeout);
#else
    int maximum = -1;
    for (int fd = 0; fd < FD_SETSIZE; ++fd)
        if ((reads && FD_ISSET(fd, reads)) || (writes && FD_ISSET(fd, writes))) maximum = fd;
    return select(maximum + 1, reads, writes, nullptr, timeout);
#endif
}
inline int send_socket(SOCKET socket, const char* data, int size) {
#ifdef _WIN32
    return send(socket, data, size, 0);
#else
    return static_cast<int>(send(socket, data, size, MSG_NOSIGNAL));
#endif
}
}
