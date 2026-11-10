"""Extract a verified archive under the project's models directory only."""
import hashlib
import json
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
archive = root / '.runtime-logs/asr-setup/sensevoice-int8.tar.bz2'
expected = '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e'
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Model checksum mismatch')
destination = root / 'models'
destination.mkdir(exist_ok=True)
with tarfile.open(archive, 'r:bz2') as package:
    members = package.getmembers()
    if sum(member.size for member in members) > 900 * 1024 * 1024:
        raise RuntimeError('Unexpected archive size')
    for member in members:
        target = (destination / member.name).resolve()
        if not target.is_relative_to(destination.resolve()) or not (member.isfile() or member.isdir()):
            raise RuntimeError('Unsafe archive member')
    package.extractall(destination, filter='data')
model_files = list(destination.glob('sherpa-onnx-sense-voice-*/model.int8.onnx'))
if len(model_files) != 1:
    raise RuntimeError('Expected one model.int8.onnx')
model_dir = model_files[0].parent
manifest = {'name': 'SenseVoice Small INT8', 'model_dir': str(model_dir.relative_to(root)), 'model': 'model.int8.onnx', 'tokens': 'tokens.txt'}
(destination / 'speech-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'ready': True, 'files': [str(path.relative_to(root)) for path in model_dir.rglob('*') if path.is_file()]}, ensure_ascii=True))
