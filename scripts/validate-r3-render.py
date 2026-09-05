"""Render actual persisted R3 scripts; inspect editable text and every slide."""
from pathlib import Path
import json
import sys
from io import BytesIO
from pptx import Presentation

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pptx_report.qualitative_service import QualitativePptRenderService
from pptx_report.qualitative_renderer import prepare_pages
from pptx_report.officecli_runner import OfficeCliRunner

latest = json.loads((ROOT / '.data/r3-delivery/latest.json').read_text(encoding='utf-8'))
output = ROOT / '.data/r3-render'
output.mkdir(exist_ok=True)
records = []
quantitative = next(c for c in latest['results'] if c['case'] == 'quantitative')
try:
    prepare_pages(json.loads(Path(quantitative['script_path']).read_text(encoding='utf-8')))
except ValueError as error:
    assert '不支持定量图表' in str(error)
else:
    raise AssertionError('Quantitative charts must not silently become empty qualitative pages')
for case in latest['results']:
    if case['case'] == 'quantitative':
        continue
    script = json.loads(Path(case['script_path']).read_text(encoding='utf-8'))
    name = case['case'] if case['adapter'] == 'local' else 'd1-' + case['case']
    for engine in (['python-pptx', 'officecli'] if case['adapter'] == 'local' else ['python-pptx']):
        service = QualitativePptRenderService(engine_mode=engine, quality_mode='off' if engine == 'python-pptx' else 'required')
        result = service.render(script)
        assert result['validation']['passed'], result['validation']
        target = output / f'{name}-{engine}.pptx'
        target.write_bytes(result['content'])
        prs = Presentation(BytesIO(result['content']))
        texts = [shape.text for slide in prs.slides for shape in slide.shapes if getattr(shape, 'has_text_frame', False)]
        joined = ''.join(texts)
        pages, _ = prepare_pages(script)
        for original in script.get('pages', []):
            for quote in original.get('quotes', []):
                fragments = [q['text'] for p in pages if (p.get('split_from_page_id') or p['id']) == original['id'] for q in p.get('quotes', []) if q.get('evidence_id') == quote.get('evidence_id')]
                assert ''.join(fragments) == quote['text'], 'Continuation must preserve every source character'
        for page in pages:
            for quote in page.get('quotes', []):
                assert quote['text'] in joined, f"Missing quote on {page['id']}"
            for finding in page.get('supporting_findings', []):
                assert finding['text'] in joined, f"Missing finding on {page['id']}"
        assert result['object_counts']['editable_native']
        assert result['object_counts']['full_slide_images'] == 0
        record = {k: v for k, v in result.items() if k != 'content'}
        record.update(case=case['case'], adapter=case['adapter'], project_id=case['project_id'], file=str(target), engine=engine, source_script_id=case['source_script_id'], source_outline_id=case['source_outline_id'])
        records.append(record)
        if engine == 'officecli':
            runner = OfficeCliRunner()
            images = output / name
            images.mkdir(exist_ok=True)
            for index in range(1, len(prs.slides)+1):
                runner.execute(['view', str(target), 'screenshot', '--page', str(index), '-o', str(images/f'slide-{index:02d}.png'), '--screenshot-width', '1280', '--screenshot-height', '720', '--render', 'html'], expect_json=False)
    print(f'{name}: editable text and both renderers passed', flush=True)
(output/'acceptance.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
