import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Content/Python'))
from local_receiver_contract import parse_command, response, SessionGate, MOVES


def setup(instance='preview', session=1):
    key=f'{instance}:{session}'
    return dict(channel='jiuquest.combat', protocolVersion=1, instanceId=instance, sessionId=key, requestId=key+':setup', type='configure')


def scene(serial=1):
    value=setup()
    athlete=dict(name='Fighter', skinTone='#d99b71', hairColor='#11131c', hairStyle='shadow spikes', giTop='#ffffff', giPants='#112a58', belt='#ffffff', stripes=0)
    value.update(requestId='preview:1:'+str(serial), type='play', moveId='rear_naked_choke', performerSide='fighter', speed=1, camera='side', compactViewport=False, fighter=athlete, opponent=copy.deepcopy(athlete), progress=0, paused=False)
    return value


class ContractTests(unittest.TestCase):
    def test_canonical_commands_and_response(self):
        for command in (setup(), scene()):
            self.assertEqual(parse_command(json.dumps(command)),command)
        event=json.loads(response(setup(),'ready',capabilities={'moves':list(MOVES)}))
        self.assertEqual(event['requestId'],'preview:1:setup')
        self.assertEqual(event['capabilities']['moves'],list(MOVES))

    def test_malformed_untrusted_commands(self):
        cases=[]
        for key,value in [('protocolVersion',True),('progress',True),('speed',True),('progress',float('nan')),('camera','console'),('moveId','trap_roll_escape'),('paused',0),('requestId','preview:1:0'),('requestId','preview:1:01'),('requestId','other:2:1')]:
            candidate=scene();candidate[key]=value;cases.append(candidate)
        candidate=scene();candidate['consoleCommand']='quit';cases.append(candidate)
        candidate=scene();candidate['fighter']['skinTone']='javascript:bad';cases.append(candidate)
        candidate=scene();candidate['fighter']['stripes']=True;cases.append(candidate)
        candidate=scene();candidate['fighter']['name']='\ud800';cases.append(candidate)
        candidate=setup();candidate['progress']=0;cases.append(candidate)
        for candidate in cases:
            with self.subTest(candidate=candidate):self.assertIsNone(parse_command(json.dumps(candidate)))
        for raw in ('null','[]','"double encoded"','x'*8193,'{"type":','\ud800'):
            self.assertIsNone(parse_command(raw))

    def test_stale_sessions_and_replays(self):
        gate=SessionGate()
        self.assertFalse(gate.accept(scene()))
        self.assertTrue(gate.accept(setup()))
        self.assertTrue(gate.accept(scene(2)))
        self.assertFalse(gate.accept(scene(1)))
        self.assertFalse(gate.accept(scene(2)))
        self.assertTrue(gate.accept(setup()))
        self.assertFalse(gate.accept(scene(2)))
        self.assertTrue(gate.accept(setup(session=2)))
        self.assertFalse(gate.accept(scene(3)))
        self.assertFalse(gate.accept(setup()))


if __name__=='__main__':unittest.main()
