#include "JQControlWire.h"
#include <cstdlib>
#include <iostream>
using namespace JQControl;
int checks = 0;
void require(bool ok, const char* label) { ++checks; if (!ok) { std::cerr << label << '\n'; std::exit(1); } }
int main() {
    const std::string e(32, 'e'), a(32, 'a'), b(32, 'b');
    Gate gate;
    require(gate.Receive("ATTACH\n" + a).Kind == Action::Reject, "no owner before authenticated gateway ready");
    require(gate.Receive("READY\n" + e).Kind == Action::Ready, "gateway epoch");
    require(gate.Receive("READY\n" + e).Kind == Action::Reject, "no epoch reset");
    require(gate.Receive("ATTACH\n" + a).Kind == Action::Attach, "owner attached");
    require(gate.Receive("ATTACH\n" + b).Kind == Action::Reject, "no owner theft");
    require(gate.Receive("COMMAND\n" + b + "\n{}").Kind == Action::Reject, "wrong owner rejected");
    require(gate.Receive("COMMAND\n" + std::string(32, 'A') + "\n{}").Kind == Action::Reject, "case changed owner rejected");
    auto raw = std::string("{\"type\":\"configure\",\"type\":\"evil\"}");
    require(gate.Receive("COMMAND\n" + a + "\n" + raw).Descriptor == raw, "native parser receives raw duplicate-key JSON");
    require(gate.Receive("COMMAND\n" + a + "\n{}").Kind == Action::Command, "authorized descriptor");
    require(gate.Response(a, "{}") == "RESPONSE\n" + a + "\n{}", "correct response routing");
    require(gate.Response(b, "{}").empty(), "response cannot redirect");
    require(gate.Receive("DETACH\n" + b).Kind == Action::Reject, "wrong detach ignored");
    require(gate.Receive("DETACH\n" + a).Kind == Action::Detach, "current detach");
    require(gate.Response(a, "{}").empty(), "late response rejected");
    require(gate.Receive("COMMAND\n" + a + "\n{}").Kind == Action::Reject, "late control rejected");
    require(gate.Receive("ATTACH\n" + b).Kind == Action::Attach, "new owner generation");
    gate.Clear(); require(!gate.Ready() && gate.Peer().empty(), "disconnect clears everything");
    for (const auto& bad : {std::string("\xc0\xaf", 2), std::string("\xed\xa0\x80", 3), std::string("\xf4\x90\x80\x80", 4), std::string("a\0b", 3), std::string("\xe2\x82", 2)})
        require(!Utf8(bad), "malformed UTF8 rejected");
    require(Utf8("\xf0\x9f\x98\x80"), "valid astral UTF8");
    require(!Descriptor("{" + std::string(8191, ' ') + "}"), "byte cap");
    require(Descriptor("{" + std::string(8190, ' ') + "}"), "exact byte bound");
    require(gate.Receive(std::string(MaxWire + 1, 'x')).Kind == Action::Reject, "wire bound");
    require(gate.Receive("ready\n" + e).Kind == Action::Reject, "case-sensitive type");
    require(gate.Receive("READY\n" + e + "\n").Kind == Action::Reject, "trailing bytes");
    std::cout << checks << " native wire checks passed\n";
}
