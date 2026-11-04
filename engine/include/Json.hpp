#pragma once
#include <charconv>
#include <cmath>
#include <iomanip>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <variant>

namespace delta {
inline std::string json_quote(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : value) {
        switch (c) {
        case '"': out << "\\\""; break;
        case '\\': out << "\\\\"; break;
        case '\b': out << "\\b"; break;
        case '\f': out << "\\f"; break;
        case '\n': out << "\\n"; break;
        case '\r': out << "\\r"; break;
        case '\t': out << "\\t"; break;
        default:
            if (c < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << unsigned(c) << std::dec;
            else out << char(c);
        }
    }
    out << '"';
    return out.str();
}

// UI commands are flat JSON objects. Reject unsupported values instead of
// extracting fields from arbitrary text or accepting partially parsed numbers.
class JsonCommand {
    using Value = std::variant<std::string, double, bool, std::nullptr_t>;
    std::map<std::string, Value> fields_;
    const std::string& input_;
    size_t pos_ = 0;
    [[noreturn]] void invalid() const { throw std::invalid_argument("Invalid command JSON"); }
    void space() { while (pos_ < input_.size() && (input_[pos_] == ' ' || input_[pos_] == '\n' || input_[pos_] == '\r' || input_[pos_] == '\t')) ++pos_; }
    bool take(char c) { space(); if (pos_ < input_.size() && input_[pos_] == c) { ++pos_; return true; } return false; }
    unsigned hex4() {
        unsigned n = 0;
        for (int i = 0; i < 4; ++i) {
            if (pos_ == input_.size()) invalid();
            char c = input_[pos_++];
            n <<= 4;
            if (c >= '0' && c <= '9') n += c - '0';
            else if (c >= 'a' && c <= 'f') n += c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') n += c - 'A' + 10;
            else invalid();
        }
        return n;
    }
    std::string string_value() {
        if (!take('"')) invalid();
        std::string out;
        while (pos_ < input_.size()) {
            unsigned char c = input_[pos_++];
            if (c == '"') return out;
            if (c < 32) invalid();
            if (c != '\\') { out += char(c); continue; }
            if (pos_ == input_.size()) invalid();
            switch (input_[pos_++]) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'u': {
                unsigned cp = hex4();
                if (cp >= 0xd800 && cp <= 0xdbff) {
                    if (pos_ + 2 > input_.size() || input_.substr(pos_, 2) != "\\u") invalid();
                    pos_ += 2;
                    unsigned low = hex4();
                    if (low < 0xdc00 || low > 0xdfff) invalid();
                    cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
                } else if (cp >= 0xdc00 && cp <= 0xdfff) invalid();
                if (cp < 0x80) out += char(cp);
                else if (cp < 0x800) { out += char(0xc0 | (cp >> 6)); out += char(0x80 | (cp & 63)); }
                else if (cp < 0x10000) { out += char(0xe0 | (cp >> 12)); out += char(0x80 | ((cp >> 6) & 63)); out += char(0x80 | (cp & 63)); }
                else { out += char(0xf0 | (cp >> 18)); out += char(0x80 | ((cp >> 12) & 63)); out += char(0x80 | ((cp >> 6) & 63)); out += char(0x80 | (cp & 63)); }
                break;
            }
            default: invalid();
            }
        }
        invalid();
    }
    Value value() {
        space();
        if (pos_ == input_.size()) invalid();
        if (input_[pos_] == '"') return string_value();
        for (auto literal : {"true", "false", "null"}) {
            std::string s(literal);
            if (input_.compare(pos_, s.size(), s) == 0) {
                pos_ += s.size();
                if (s == "null") return nullptr;
                return s == "true";
            }
        }
        size_t start = pos_;
        if (input_[pos_] == '-') ++pos_;
        if (pos_ == input_.size()) invalid();
        if (input_[pos_] == '0') ++pos_;
        else {
            if (input_[pos_] < '1' || input_[pos_] > '9') invalid();
            while (pos_ < input_.size() && input_[pos_] >= '0' && input_[pos_] <= '9') ++pos_;
        }
        auto digits = [&]() {
            size_t begin = pos_;
            while (pos_ < input_.size() && input_[pos_] >= '0' && input_[pos_] <= '9') ++pos_;
            if (begin == pos_) invalid();
        };
        if (pos_ < input_.size() && input_[pos_] == '.') { ++pos_; digits(); }
        if (pos_ < input_.size() && (input_[pos_] == 'e' || input_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < input_.size() && (input_[pos_] == '+' || input_[pos_] == '-')) ++pos_;
            digits();
        }
        double number;
        auto result = std::from_chars(input_.data() + start, input_.data() + pos_, number);
        if (result.ec != std::errc{} || result.ptr != input_.data() + pos_ || !std::isfinite(number)) invalid();
        return number;
    }
public:
    explicit JsonCommand(const std::string& input) : input_(input) {
        if (input.size() > 65536 || !take('{')) invalid();
        if (!take('}')) {
            do {
                std::string key = string_value();
                if (!take(':')) invalid();
                if (!fields_.emplace(key, value()).second) invalid();
                if (take('}')) break;
                if (!take(',')) invalid();
            } while (true);
        }
        space();
        if (pos_ != input_.size()) invalid();
    }
    std::string string(const std::string& key, const std::string& fallback = "") const {
        auto it = fields_.find(key);
        if (it == fields_.end()) return fallback;
        if (auto p = std::get_if<std::string>(&it->second)) return *p;
        throw std::invalid_argument("Expected string: " + key);
    }
    double number(const std::string& key, double fallback) const {
        auto it = fields_.find(key);
        if (it == fields_.end()) return fallback;
        if (auto p = std::get_if<double>(&it->second)) return *p;
        throw std::invalid_argument("Expected number: " + key);
    }
};
} // namespace delta
