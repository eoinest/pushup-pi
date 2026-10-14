import argparse
import json
import signal
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from counter import Counter

def emit(kind,**data):
    print(json.dumps({'type':kind,**data}),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--settings',required=True)
    settings=json.loads(parser.parse_args().settings)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    # Only this native subprocess opens the camera. No frame is recorded or sent.
    stopped=False
    def cancel(_signal,_frame):
        nonlocal stopped
        stopped=True
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    counter=Counter(settings['confidence'],settings['upAngle'],settings['downAngle'],settings['holdMs'])
    model=Path(__file__).parent/'pose_landmarker_lite.task'
    if not model.exists():raise RuntimeError('Pose model missing. Run native/setup.py.')
    options=vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,num_poses=1,
        min_pose_detection_confidence=settings['confidence'],
        min_pose_presence_confidence=settings['confidence'],
        min_tracking_confidence=settings['confidence'])
    camera=None;window='Pi — push-up gate (Esc to edit prompt)'
    try:
        with vision.PoseLandmarker.create_from_options(options) as tracker:
            camera=cv2.VideoCapture(settings['camera'])
            if not camera.isOpened():raise RuntimeError('Camera unavailable. Allow camera access for your terminal/Python in system privacy settings.')
            camera.set(cv2.CAP_PROP_FRAME_WIDTH,960);camera.set(cv2.CAP_PROP_FRAME_HEIGHT,540)
            cv2.namedWindow(window,cv2.WINDOW_NORMAL)
            previous=-1;last_count=-1
            while not stopped:
                ok,frame=camera.read()
                if not ok:raise RuntimeError('Camera disconnected or failed to provide a frame.')
                # Pixel coordinates avoid aspect-ratio distortion in the counter.
                height,width=frame.shape[:2]
                timestamp=max(previous+1,int(time.monotonic()*1000));previous=timestamp
                image=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
                result=tracker.detect_for_video(image,timestamp)
                points=result.pose_landmarks[0] if result.pose_landmarks else None
                if points:
                    for connection in vision.PoseLandmarksConnections.POSE_LANDMARKS:
                        a,b=points[connection.start],points[connection.end]
                        if min(a.visibility,b.visibility)>=settings['confidence']:
                            cv2.line(frame,(int(a.x*width),int(a.y*height)),(int(b.x*width),int(b.y*height)),(110,240,150),3)
                    for point in points:
                        if point.visibility>=settings['confidence']:
                            cv2.circle(frame,(int(point.x*width),int(point.y*height)),5,(230,255,240),-1)
                    geometry=[SimpleNamespace(x=p.x*width/height,y=p.y,visibility=p.visibility) for p in points]
                else:geometry=None
                tracking=counter.update(geometry,timestamp)
                if counter.count!=last_count:emit('progress',count=counter.count);last_count=counter.count
                frame=cv2.flip(frame,1)
                text=f'{counter.count} / {settings["reps"]} push-ups'
                instruction='Push back up' if counter.phase=='down' else 'Lower, then return to a straight-arm plank'
                if not tracking:instruction='Move side-on; keep your full body visible'
                cv2.rectangle(frame,(0,0),(width,100),(25,35,25),-1)
                cv2.putText(frame,text,(20,40),cv2.FONT_HERSHEY_SIMPLEX,1,(180,240,160),2)
                cv2.putText(frame,instruction,(20,75),cv2.FONT_HERSHEY_SIMPLEX,.55,(240,240,240),1)
                cv2.imshow(window,frame)
                if cv2.waitKey(1)&0xff==27 or cv2.getWindowProperty(window,cv2.WND_PROP_VISIBLE)<1:stopped=True
                if not stopped and counter.count>=settings['reps']:
                    emit('complete');return
            emit('cancelled')
    finally:
        if camera is not None:camera.release()
        cv2.destroyAllWindows()

if __name__=='__main__':
    try:main()
    except Exception as error:emit('error',message=str(error));sys.exit(1)
