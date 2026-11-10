"""Persistent local Chinese ASR worker. Audio travels via stdin and is never saved."""
import base64
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import wave

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
root = Path(__file__).resolve().parents[1]


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


try:
    import numpy as np
    import sherpa_onnx

    manifest = json.loads((root / 'models/speech-manifest.json').read_text(encoding='utf-8'))
    model_dir = (root / manifest['model_dir']).resolve()
    if not model_dir.is_relative_to((root / 'models').resolve()):
        raise ValueError('Invalid model location')
    # Relative model filenames also work with Windows projects whose paths contain Chinese.
    os.chdir(model_dir)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=manifest['model'], tokens=manifest['tokens'], num_threads=2,
        use_itn=True, language='zh', debug=False, provider='cpu',
    )
    emit({'type': 'ready'})
except Exception:
    emit({'type': 'startup_error', 'code': 'speech_runtime_unavailable'})
    sys.exit(1)

for line in sys.stdin:
    request_id = None
    try:
        if len(line) > 1_500_000:
            raise ValueError('Request too large')
        request = json.loads(line)
        request_id = request['id']
        started = time.perf_counter()
        audio = base64.b64decode(request['audio'], validate=True)
        with wave.open(io.BytesIO(audio), 'rb') as reader:
            if reader.getnchannels() != 1 or reader.getsampwidth() != 2 or reader.getframerate() != 16000:
                raise ValueError('Unsupported WAV')
            frames = reader.getnframes()
            if not 3200 <= frames <= 484000:
                raise ValueError('Unsupported duration')
            samples = np.frombuffer(reader.readframes(frames), dtype='<i2').astype(np.float32) / 32768
        # Reject near-silence before a language model can hallucinate words.
        if samples.size == 0 or float(np.sqrt(np.mean(samples * samples))) < 0.0005:
            emit({'id': request_id, 'status': 'no_speech', 'text': '', 'processing_ms': 0})
            continue
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        text = re.sub(r'<\|[^|]*\|>', '', stream.result.text).strip()
        if len(text) > 2000:
            raise ValueError('Unexpected output size')
        emit({'id': request_id, 'status': 'transcribed' if text else 'no_speech', 'text': text,
              'processing_ms': round((time.perf_counter() - started) * 1000)})
    except Exception:
        emit({'id': request_id, 'error': 'speech_input_failed'})
