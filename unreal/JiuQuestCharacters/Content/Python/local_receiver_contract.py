"""Bounded protocol for the local Editor preview; no Unreal or gameplay state."""
import json
import math
import re

CHANNEL = 'jiuquest.combat'
VERSION = 1
MAX_BYTES = 8192
MOVES = ('standing_stance', 'rear_naked_choke', 'armbar')
CAMERAS = ('front', 'focus', 'side', 'overhead', 'orbit')
SPEEDS = (.25, .5, 1)
CONTROLS = ('play', 'pause', 'resume', 'seek', 'reset', 'setSpeed', 'setCamera', 'setViewport', 'requestState')
IDENTIFIER = re.compile(r'[A-Za-z0-9:_-]{1,160}\Z')
COLOR = re.compile(r'#[a-fA-F0-9]{6}\Z')
ENVELOPE = {'channel', 'protocolVersion', 'instanceId', 'sessionId', 'requestId', 'type'}
SCENE = {'moveId', 'performerSide', 'speed', 'camera', 'compactViewport', 'fighter', 'opponent', 'progress', 'paused'}
ATHLETE = {'name', 'skinTone', 'hairColor', 'hairStyle', 'giTop', 'giPants', 'belt', 'stripes'}


def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def parse_command(descriptor):
    """Reject noncanonical fields rather than forwarding console commands/URLs."""
    if not isinstance(descriptor, str) or len(descriptor) > MAX_BYTES:
        return None
    try:
        if len(descriptor.encode('utf-8')) > MAX_BYTES:
            return None
        command = json.loads(descriptor, parse_constant=lambda _: None)
    except (ValueError, TypeError):
        return None
    if not isinstance(command, dict) or command.get('channel') != CHANNEL or type(command.get('protocolVersion')) is not int or command['protocolVersion'] != VERSION:
        return None
    if not all(isinstance(command.get(k), str) and IDENTIFIER.fullmatch(command[k]) for k in ('instanceId', 'sessionId', 'requestId')):
        return None
    session = command['sessionId']
    if not session.startswith(command['instanceId'] + ':'):
        return None
    if command.get('type') == 'configure':
        return command if set(command) == ENVELOPE and command['requestId'] == session + ':setup' else None
    if command.get('type') not in CONTROLS or set(command) != ENVELOPE | SCENE:
        return None
    suffix = command['requestId'].removeprefix(session + ':')
    if not suffix.isascii() or not suffix.isdecimal() or not 1 <= int(suffix) <= 2**53-1 or command['requestId'] != session + ':' + str(int(suffix)):
        return None
    if command['moveId'] not in MOVES or command['performerSide'] not in ('fighter', 'opponent'):
        return None
    if not number(command['speed'], .25, 1) or command['speed'] not in SPEEDS or command['camera'] not in CAMERAS:
        return None
    if not number(command['progress'], 0, 1) or type(command['paused']) is not bool or type(command['compactViewport']) is not bool:
        return None
    for field in ('fighter', 'opponent'):
        athlete = command[field]
        if not isinstance(athlete, dict) or set(athlete) != ATHLETE:
            return None
        if not isinstance(athlete['name'], str) or len(athlete['name']) > 100 or not isinstance(athlete['hairStyle'], str) or not 1 <= len(athlete['hairStyle']) <= 40:
            return None
        try:
            athlete['name'].encode('utf-8'); athlete['hairStyle'].encode('utf-8')
        except UnicodeError:
            return None
        if not all(isinstance(athlete[k], str) and COLOR.fullmatch(athlete[k]) for k in ('skinTone', 'hairColor', 'giTop', 'giPants', 'belt')):
            return None
        if type(athlete['stripes']) is not int or not 0 <= athlete['stripes'] <= 4:
            return None
    return command


def response(command, kind, **values):
    result = {key: command[key] for key in ENVELOPE}
    result.update(type=kind, **values)
    return json.dumps(result, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


class SessionGate:
    """One local subscriber; stale/replayed requests cannot alter the new scene."""
    def __init__(self):
        self.current = None
        self.retired = set()
        self.last_request = 0

    def accept(self, command):
        key = (command['instanceId'], command['sessionId'])
        if command['type'] == 'configure':
            if key in self.retired or len(self.retired) >= 512:
                return False
            if key != self.current:
                if self.current is not None:
                    self.retired.add(self.current)
                self.current = key
                self.last_request = 0
            return True
        if key != self.current:
            return False
        serial = int(command['requestId'].rsplit(':', 1)[1])
        if serial <= self.last_request:
            return False
        self.last_request = serial
        return True
