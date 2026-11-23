#pragma once
#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

namespace delta {
inline std::filesystem::path executable_directory() {
#ifdef _WIN32
    wchar_t executable[32768];
    DWORD size = GetModuleFileNameW(nullptr, executable, 32768);
    return std::filesystem::path(std::wstring(executable, size)).parent_path();
#else
    return std::filesystem::canonical("/proc/self/exe").parent_path();
#endif
}
#ifndef _WIN32
inline std::filesystem::path wine_prefix() {
    if (const char* prefix = std::getenv("WINEPREFIX")) return prefix;
    if (const char* home = std::getenv("HOME")) return std::filesystem::path(home) / ".wine";
    return {};
}
inline std::filesystem::path native_wine_path(std::filesystem::path path) {
    auto text = path.string();
    if (text.size() >= 3 && text[1] == ':') {
        char drive = text[0];
        if (drive >= 'A' && drive <= 'Z') drive += 'a' - 'A';
        std::replace(text.begin(), text.end(), '\\', '/');
        return wine_prefix() / "dosdevices" / (std::string(1, drive) + ":") / text.substr(3);
    }
    return path;
}
#endif
}
