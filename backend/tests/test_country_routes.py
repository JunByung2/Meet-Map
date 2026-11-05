import unittest
from datetime import datetime
from unittest.mock import patch
from meeting_tools.transit import tago_intercity as t


class NetworkTests(unittest.TestCase):
    def test_unique_national_station_match(self):
        def lookup(service, op, **params):
            if op == "GetCtyCodeList":
                return [{"cityname":"전라남도","citycode":36}]
            return [{"nodename":"여수EXPO","nodeid":"station"}]
        with patch.object(t, "lookup", side_effect=lookup):
            self.assertEqual(t.station_ids("여수엑스포역", "다른지역명"), {"station"})

    def test_mixed_transfer_wait_and_total(self):
        now = datetime(2026,11,5,9,tzinfo=t.KST)
        def at(h,m): return now.replace(hour=h,minute=m)
        legs = [[(at(10,0),at(9,15),{})],
                [(at(10,50),at(10,10),{}),(at(11,0),at(10,20),{})]]
        feeds = [{"properties":{"totalTime":0},"steps":[]},
                 {"properties":{"totalTime":300},"steps":[]},
                 {"properties":{"totalTime":60},"steps":[]}]
        a,v,w,z = t.HUBS["TRAIN"][:4]
        with patch.object(t,"trips",side_effect=legs),patch.object(t,"feeder",side_effect=feeds):
            r=t.compose(t.coord(a),t.coord(z),"TRAIN",a,z,now,v,"INTERCITY",w)
        self.assertEqual(r["properties"]["totalTime"],7260)
        self.assertEqual(r["steps"][-2]["properties"]["time"],900)
        self.assertEqual(r["steps"][-1]["properties"]["type"],"EXPRESSBUS")
