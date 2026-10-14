import math

def angle(a,b,c):
    x=(a.x-b.x,a.y-b.y); y=(c.x-b.x,c.y-b.y)
    length=math.hypot(*x)*math.hypot(*y)
    return math.degrees(math.acos(max(-1,min(1,(x[0]*y[0]+x[1]*y[1])/length)))) if length else 0

def measure(points,confidence=.65):
    if not points or len(points)<33: return None
    sides=[[points[i] for i in ids] for ids in [(11,13,15,23,25,27),(12,14,16,24,26,28)]]
    sides=[side for side in sides if all(p.visibility>=confidence for p in side)]
    if not sides: return None
    shoulder,elbow,wrist,hip,knee,ankle=max(sides,key=lambda side:min(p.visibility for p in side))
    torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
    if torso<.08 or abs(shoulder.x-hip.x)<=abs(shoulder.y-hip.y)*1.3: return None
    if wrist.y<=shoulder.y+torso*.08: return None
    if angle(shoulder,hip,knee)<145 or angle(hip,knee,ankle)<145: return None
    return angle(shoulder,elbow,wrist)

class Counter:
    def __init__(self,confidence=.65,up=155,down=100,hold_ms=180):
        self.confidence=confidence;self.up=up;self.down=down;self.hold_ms=hold_ms
        self.count=0;self.phase='ready';self.candidate=None;self.since=0;self.last_valid=0;self.last_time=-1
    def update(self,points,time_ms):
        if time_ms<=self.last_time:return False
        self.last_time=time_ms
        bend=measure(points,self.confidence)
        if bend is None:
            self.candidate=None
            if time_ms-self.last_valid>700:self.phase='ready'
            return False
        self.last_valid=time_ms
        next_phase='up' if bend>=self.up else 'down' if bend<=self.down else None
        if next_phase is None:self.candidate=None;return True
        if self.candidate!=next_phase:self.candidate=next_phase;self.since=time_ms
        if time_ms-self.since>=self.hold_ms:
            if next_phase=='up' and self.phase=='down':self.count+=1;self.phase='up'
            elif next_phase=='up' and self.phase=='ready':self.phase='up'
            elif next_phase=='down' and self.phase=='up':self.phase='down'
        return True
