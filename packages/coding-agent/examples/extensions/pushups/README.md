# Pushup Pi — native Pi TUI gate

Use Pi's existing terminal editor, model selector, login, tools, and conversation. There is no web app, browser, HTTP server, or replacement chat UI. When you submit a prompt, this extension holds it and starts a native OpenCV camera window. MediaPipe draws a skeleton and counts push-ups locally. Completing the configured reps releases the original prompt through Pi's normal input pipeline. Escape in the camera window or Pi's terminal cancels and restores the text draft. Set reps to zero to send immediately without camera access.

## Setup

```sh
cd ~/Documents/dev/pushup-pi
npm install --ignore-scripts
npm run hydrate:model-data
python3.12 packages/coding-agent/examples/extensions/pushups/native/setup.py
./pushup-pi.sh
```

Requires Node 24.5+ and Python 3.10–3.12. The setup creates an isolated Python environment, installs pinned MediaPipe/OpenCV wheels, and downloads a versioned model with SHA-256 verification. Use Pi's `/login` and model selection as usual. To work in another project, run the absolute path to `pushup-pi.sh` from that project; the launcher preserves the working directory. Pass ordinary Pi arguments to the launcher.

## Settings — inside Pi

- `/pushups` opens Pi's native settings selector.
- `/pushups 3` or `/pushups reps 3` sets the required reps (default 1, range 0–100).
- `/pushups 0` disables the gate.
- `/pushups camera 1` selects a camera index (default 0).
- `/pushups confidence 0.65` sets minimum landmark confidence.
- `/pushups upAngle 155` and `/pushups downAngle 100` set elbow thresholds.
- `/pushups holdMs 180` changes the stable-position hold time.
- `/pushups reset` restores defaults and repairs invalid settings.

Settings persist in this fork's `.pi/pushups.local.json`, excluded from git, so they apply when the launcher is used in different projects. `PUSHUP_PI_SETTINGS` overrides that file. `PUSHUP_PI_PYTHON` optionally selects another Python interpreter with the dependencies installed. The footer displays the required count. Pi's configured `app.interrupt` and `app.clear` keys cancel the gate in the terminal; the default interrupt key is Escape. Camera-window Escape always cancels.

## Structure

```text
pushup-pi.sh                           launch the existing Pi TUI + extension
packages/coding-agent/examples/extensions/pushups/
  index.ts                            Pi input interception and settings command
  settings.ts                         settings validation and defaults
  worker.ts                           native subprocess protocol and cancellation
  native/camera.py                     camera, MediaPipe, native overlay
  native/counter.py                    pure geometry and rep state machine
  native/setup.py                      isolated dependencies and verified model
  native/requirements.txt              exact native dependencies
```

The extension uses Pi's supported `input` hook, so upstream editor and agent code stay intact. Slash commands remain Pi commands and do not require reps. Positive-count noninteractive prompts are blocked because they cannot show a camera gate; zero-count mode passes them through. Other extensions' programmatic messages pass through. User prompts sent as steering/follow-ups through the TUI are gated before entering Pi's queue.

## Camera and counting

The native helper opens the camera only for a positive-count submitted prompt. On macOS the OS may attribute the camera request to your terminal or Python process because Pi launches a native helper; grant access there, rather than in a browser. Closing the camera, Escape, timeout, session shutdown, or a camera error releases the capture. Frames and landmarks remain local and are neither recorded nor sent to the AI provider. A failed helper never releases the held prompt.

Place your full body side-on to the camera in good lighting. Counting requires a roughly horizontal torso, straight hips/knees, hands below shoulders, and a full straight-arm → lowered → straight-arm cycle. Each threshold must be held for the configured duration. Tracking lost for over 700ms requires a new starting plank. Knee push-ups are not currently counted. This is an approximate rep counter, not an exercise-form assessment. Cancelling discards partial reps. Text drafts are restored exactly; attached images must be reattached after cancellation.

## Verification and licenses

```sh
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/pushups.test.ts)
python3.12 -m unittest discover -s packages/coding-agent/examples/extensions/pushups/native -p 'test_*.py'
npm run check
```

The public fork and added code use the root MIT license. [Pi upstream](https://github.com/earendil-works/pi). MediaPipe is Apache-2.0; OpenCV uses Apache-2.0. [Official Python Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python). Native camera accuracy depends on your physical camera placement and lighting.
