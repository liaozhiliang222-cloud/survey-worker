"""Capture actual PPT files for visual acceptance; does not call a model."""
from pathlib import Path
import sys
from pptx import Presentation
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pptx_report.officecli_runner import OfficeCliRunner

runner = OfficeCliRunner()
files = [Path('.data/r3-render/qualitative-python-pptx.pptx'),
         Path('.data/r3-render/mixed-python-pptx.pptx'),
         Path('.data/r3-model/report.pptx')]
for target in files:
    if not target.exists():
        continue
    images = target.parent / (target.stem + '-images')
    images.mkdir(exist_ok=True)
    for index in range(1, len(Presentation(target).slides) + 1):
        runner.execute(['view', str(target.resolve()), 'screenshot', '--page', str(index),
                        '-o', str((images / f'slide-{index:02d}.png').resolve()),
                        '--screenshot-width', '1280', '--screenshot-height', '720', '--render', 'html'],
                       expect_json=False)
    print(target, flush=True)
