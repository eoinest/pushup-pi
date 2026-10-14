import unittest
from types import SimpleNamespace
from counter import Counter,measure

def pose(down=False):
    points=[SimpleNamespace(x=0,y=0,visibility=0) for _ in range(33)]
    geometry=[(.25,.5),(.25,.65),(.4,.65),(.55,.5),(.7,.5),(.9,.5)] if down else [(.25,.25),(.25,.45),(.25,.65),(.55,.25),(.7,.25),(.9,.25)]
    for index,(x,y) in zip([11,13,15,23,25,27],geometry):points[index]=SimpleNamespace(x=x,y=y,visibility=.95)
    return points

class CounterTest(unittest.TestCase):
    def test_full_cycle_and_hold(self):
        counter=Counter()
        for down,times in [(False,[0,200,400]),(True,[600,800,1000]),(False,[1200,1400,1600])]:
            for timestamp in times:counter.update(pose(down),timestamp)
        self.assertEqual(counter.count,1)
    def test_starting_down_and_jitter(self):
        counter=Counter()
        for down,timestamp in [(True,0),(True,200),(False,400),(False,600),(True,650),(False,700)]:counter.update(pose(down),timestamp)
        self.assertEqual(counter.count,0)
    def test_visibility_and_upright_rejected(self):
        points=pose();points[13].visibility=.1;self.assertIsNone(measure(points))
        points=pose();points[23].x=.25;points[23].y=.6;self.assertIsNone(measure(points))
    def test_tracking_loss_resets_cycle(self):
        counter=Counter()
        for down,timestamp in [(False,0),(False,200),(True,400),(True,600)]:counter.update(pose(down),timestamp)
        counter.update(None,1400);counter.update(pose(),1600);counter.update(pose(),1800)
        self.assertEqual(counter.count,0)
    def test_threshold_hold_is_configurable(self):
        counter=Counter(hold_ms=500)
        counter.update(pose(),0);counter.update(pose(),200)
        self.assertEqual(counter.phase,'ready')
        counter.update(pose(),500);self.assertEqual(counter.phase,'up')

if __name__=='__main__':unittest.main()
