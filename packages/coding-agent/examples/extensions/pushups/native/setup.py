import hashlib
import subprocess
import sys
import urllib.request
import venv
from pathlib import Path

if not (3,10)<=sys.version_info[:2]<=(3,12):
    raise SystemExit('Use Python 3.10–3.12 for MediaPipe (e.g. python3.12 setup.py).')
directory=Path(__file__).resolve().parent
environment=directory/'.venv'
venv.EnvBuilder(with_pip=True).create(environment)
python=environment/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
subprocess.run([str(python),'-m','pip','install','--only-binary=:all:','-r',str(directory/'requirements.txt')],check=True)
url='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
with urllib.request.urlopen(url,timeout=60) as response:data=response.read()
if hashlib.sha256(data).hexdigest()!='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a':
    raise SystemExit('Model checksum mismatch.')
(directory/'pose_landmarker_lite.task').write_bytes(data)
print('Native camera helper installed. Start ./pushup-pi.sh; use /pushups for settings.')
