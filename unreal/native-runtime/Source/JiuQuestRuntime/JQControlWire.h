#pragma once
#include <cstddef>
#include <string>
#include <string_view>

// Engine-independent wire and generation gate used by the native adapter.
namespace JQControl {
constexpr std::size_t MaxDescriptor = 8192, MaxWire = 8300;
enum class Action { Reject, Ready, Attach, Command, Detach };
inline bool Hex(std::string_view s, std::size_t count) {
    if (s.size() != count) return false;
    for (char c : s) if (!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9'))) return false;
    return true;
}
inline bool Utf8(std::string_view s) {
    for (std::size_t i = 0; i < s.size();) {
        unsigned char c = static_cast<unsigned char>(s[i++]);
        if (c == 0) return false;
        if (c < 0x80) continue;
        unsigned count; unsigned cp;
        if (c >= 0xc2 && c <= 0xdf) { count = 1; cp = c & 31; }
        else if (c >= 0xe0 && c <= 0xef) { count = 2; cp = c & 15; }
        else if (c >= 0xf0 && c <= 0xf4) { count = 3; cp = c & 7; }
        else return false;
        if (s.size() - i < count) return false;
        for (unsigned k = 0; k < count; ++k) {
            unsigned char d = static_cast<unsigned char>(s[i++]);
            if ((d & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (d & 63);
        }
        if ((count == 1 && cp < 0x80) || (count == 2 && cp < 0x800) || (count == 3 && cp < 0x10000)
            || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    }
    return true;
}
inline bool Descriptor(std::string_view s) {
    return s.size() >= 2 && s.size() <= MaxDescriptor && s.front() == '{' && s.back() == '}' && Utf8(s);
}
struct Result { Action Kind = Action::Reject; std::string Peer, Descriptor; };
class Gate {
    std::string Epoch, Owner;
public:
    bool Ready() const { return !Epoch.empty(); }
    std::string_view Peer() const { return Owner; }
    void Clear() { Epoch.clear(); Owner.clear(); }
    Result Receive(std::string_view wire) {
        if (wire.size() > MaxWire || !Utf8(wire)) return {};
        auto first = wire.find('\n');
        if (first == std::string_view::npos) return {};
        auto type = wire.substr(0, first), body = wire.substr(first + 1);
        if (type == "READY") {
            if (Ready() || !Hex(body, 32)) return {};
            Epoch = body; return {Action::Ready, {}, {}};
        }
        if (!Ready()) return {};
        if (type == "ATTACH") {
            if (!Owner.empty() || !Hex(body, 32)) return {};
            Owner = body; return {Action::Attach, Owner, {}};
        }
        if (type == "DETACH") {
            if (Owner.empty() || body != Owner) return {};
            auto old = Owner; Owner.clear(); return {Action::Detach, old, {}};
        }
        if (type == "COMMAND") {
            auto split = body.find('\n');
            if (split == std::string_view::npos || Owner.empty() || body.substr(0, split) != Owner) return {};
            auto descriptor = body.substr(split + 1);
            if (!Descriptor(descriptor)) return {};
            return {Action::Command, Owner, std::string(descriptor)};
        }
        return {};
    }
    std::string Response(std::string_view peer, std::string_view descriptor) const {
        if (!Ready() || Owner.empty() || peer != Owner || !Descriptor(descriptor)) return {};
        return "RESPONSE\n" + Owner + "\n" + std::string(descriptor);
    }
};
}
