"""Import the approved guide without rewording its content or flattening bold.

Usage: python tools/import_blue_belt_guide.py path/to/guide.docx [--check]
The original document stays untouched. Only heading lesson prefixes are removed.
The importer rejects unsupported structures rather than silently losing content.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src/data/blueBeltGuide.js'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'


def value(element, default=None):
    return element.get(W + 'val', default) if element is not None else default


def merge_runs(runs):
    result = []
    for run in runs:
        if not run['text']:
            continue
        if result and result[-1]['bold'] == run['bold']:
            result[-1]['text'] += run['text']
        else:
            result.append(dict(run))
    return result


def slice_runs(runs, start, end=None):
    result, offset = [], 0
    for run in runs:
        text = run['text']
        lo, hi = max(0, start - offset), len(text) if end is None else min(len(text), end - offset)
        if hi > lo:
            result.append({'text': text[lo:hi], 'bold': run['bold']})
        offset += len(text)
    return merge_runs(result)


def extract(path):
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        numbering = ET.fromstring(archive.read('word/numbering.xml'))
        styles = ET.fromstring(archive.read('word/styles.xml'))
    for unsupported in ['tbl', 'del', 'ins', 'rStyle', 'hyperlink', 'fldSimple']:
        if document.findall('.//w:' + unsupported, NS):
            raise ValueError('Review unsupported document structure: ' + unsupported)
    # Body and list paragraphs in this source inherit no bold. Fail if that changes.
    for name in ['Normal', 'ListParagraph']:
        style = styles.find(f"w:style[@w:styleId='{name}']", NS)
        if style is not None and style.find('w:rPr/w:b', NS) is not None:
            raise ValueError('Review inherited body bold before importing')
    counts, techniques = {}, []
    for paragraph in document.findall('w:body/w:p', NS):
        runs = []
        for run in paragraph.findall('w:r', NS):
            text = ''.join((node.text or '') if node.tag == W + 't' else '\n' if node.tag == W + 'br' else '\t' if node.tag == W + 'tab' else '' for node in run)
            runs.append({'text': text, 'bold': value(run.find('w:rPr/w:b', NS), 'false') not in ('false', '0', 'off')})
            # A present <w:b/> has no val and means true.
            if run.find('w:rPr/w:b', NS) is not None:
                runs[-1]['bold'] = value(run.find('w:rPr/w:b', NS), 'true') not in ('false', '0', 'off')
        runs = merge_runs(runs)
        text = ''.join(run['text'] for run in runs)
        if not text.strip():
            continue
        style = value(paragraph.find('w:pPr/w:pStyle', NS))
        if style == 'Title':
            continue
        if style == 'Heading1':
            name = re.sub(r'^Lesson\s+\d+[a-z]?\s+', '', text)
            if name == text:
                raise ValueError('Unexpected heading: ' + text)
            techniques.append({'name': name, 'scenario': '', 'stepDetails': []})
            continue
        if not techniques:
            raise ValueError('Content before first technique')
        num = paragraph.find('w:pPr/w:numPr', NS)
        explicit = re.match(r'^(\d+\.)(\s*)', text)
        if num is not None:
            num_id = value(num.find('w:numId', NS))
            level = value(num.find('w:ilvl', NS), '0')
            abstract_id = value(numbering.find(f"w:num[@w:numId='{num_id}']/w:abstractNumId", NS))
            lvl = numbering.find(f"w:abstractNum[@w:abstractNumId='{abstract_id}']/w:lvl[@w:ilvl='{level}']", NS)
            if level != '0' or value(lvl.find('w:numFmt', NS)) != 'decimal' or value(lvl.find('w:lvlText', NS)) != '%1.':
                raise ValueError('Unsupported list numbering')
            if numbering.find(f"w:num[@w:numId='{num_id}']/w:lvlOverride", NS) is not None:
                raise ValueError('Review numbering override')
            counts[num_id] = counts.get(num_id, int(value(lvl.find('w:start', NS), '1')) - 1) + 1
            label = str(counts[num_id]) + '.'
            label_runs = [{'text': label, 'bold': False}]
            separator = '\t'
            separator_runs = [{'text': separator, 'bold': False}]
            body_runs = runs
        elif explicit:
            label = explicit[1]
            label_runs = slice_runs(runs, 0, len(label))
            separator = explicit[2]
            separator_runs = slice_runs(runs, len(label), explicit.end())
            body_runs = slice_runs(runs, explicit.end())
        else:
            if techniques[-1]['scenario'] or techniques[-1]['stepDetails']:
                raise ValueError('Unexpected non-step paragraph: ' + text)
            techniques[-1]['scenario'] = text
            continue
        techniques[-1]['stepDetails'].append({'label': label, 'labelRuns': label_runs, 'separator': separator, 'separatorRuns': separator_runs, 'runs': body_runs})
    if len(techniques) != 36 or any(not technique['stepDetails'] for technique in techniques):
        raise ValueError('Unexpected guide coverage')
    return {'sourceSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'techniques': techniques}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('guide', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = extract(args.guide)
    content = '// Generated from the approved Word guide; preserve wording, bold, and source step labels.\nexport const blueBeltGuide = ' + json.dumps(result, ensure_ascii=False, indent=2) + ';\n'
    if args.check:
        assert OUTPUT.read_text(encoding='utf-8') == content, 'Guide content differs from the source document'
    else:
        OUTPUT.write_text(content, encoding='utf-8', newline='\n')
    print(json.dumps({'techniques': len(result['techniques']), 'steps': sum(len(x['stepDetails']) for x in result['techniques']), 'sourceSha256': result['sourceSha256'], 'matchesSource': True}))
