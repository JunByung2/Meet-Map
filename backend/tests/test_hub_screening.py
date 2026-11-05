import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('hub_screening', Path(__file__).parents[1] / 'meeting_tools/recommendation/hub_screening.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class ScreeningTests(unittest.TestCase):
    def setUp(self):
        h._cache.clear()
        self.a = {'x': 0, 'y': 0}
        self.b = {'x': 1, 'y': 0}

    def test_cache_direction_policy_and_expiry(self):
        with patch.object(h.time, 'monotonic', return_value=0):
            self.assertEqual(h.verified_seconds(self.a, self.b, 'p', lambda: 100), 100)
        with patch.object(h.time, 'monotonic', return_value=299):
            self.assertEqual(h.verified_seconds(self.a, self.b, 'p', lambda: 999), 100)
            self.assertEqual(h.verified_seconds(self.b, self.a, 'p', lambda: 200), 200)
            self.assertEqual(h.verified_seconds(self.a, self.b, 'q', lambda: 300), 300)
        with patch.object(h.time, 'monotonic', return_value=301):
            self.assertEqual(h.verified_seconds(self.a, self.b, 'p', lambda: 400), 400)

    def test_failure_is_not_cached(self):
        def fail():
            raise RuntimeError('upstream')
        with self.assertRaises(RuntimeError):
            h.verified_seconds(self.a, self.b, 'p', fail)
        self.assertEqual(h.verified_seconds(self.a, self.b, 'p', lambda: 50), 50)

    def test_concurrent_requests_only_fetch_once(self):
        calls = []
        def fetch():
            calls.append(1)
            return 120
        with ThreadPoolExecutor(max_workers=5) as pool:
            answers = list(pool.map(lambda _: h.verified_seconds(self.a, self.b, 'p', fetch), range(10)))
        self.assertEqual(answers, [120]*10)
        self.assertEqual(len(calls), 1)

    def test_long_distance_diversity_and_limit(self):
        distance = lambda a,b: abs(a['x']-b['x'])
        points = [dict(x=x, y=0, id=str(x), candidate_type='train') for x in (140,141,142,170,200,240)]
        points.append(dict(x=150,y=0,id='subway',candidate_type='subway'))
        result = h.shortlist(points,[dict(x=0,y=0),dict(x=300,y=0)],[],distance,'p',5)
        self.assertEqual(len(result),5)
        self.assertNotIn('subway',[p['id'] for p in result])
        self.assertGreaterEqual(abs(result[0]['x']-result[1]['x']),15)
        self.assertEqual(len({p['id'] for p in result}),5)

    def test_short_distance_keeps_subway_and_no_padding(self):
        p = dict(x=5,y=0,id='station',candidate_type='subway')
        self.assertEqual(h.shortlist([p],[self.a,self.b],[],lambda a,b:abs(a['x']-b['x']),'p'),[p])

if __name__ == '__main__':
    unittest.main()
