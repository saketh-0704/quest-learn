"""Isolated interpreter self-check: real PDF/TXT extraction, mocked generation."""
import asyncio
import base64
from io import BytesIO
import json
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers import gemini_text as worker
from app.documents.processing import DocumentError
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject

TEXT = 'The Cedar library lends three books for fourteen days. Return borrowed books on time.'
writer = PdfWriter()
page = writer.add_blank_page(width=612, height=792)
font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
stream = DecodedStreamObject()
stream.set_data(f'BT /F1 12 Tf 30 700 Td ({TEXT}) Tj ET'.encode())
page[NameObject('/Contents')] = writer._add_object(stream)
pdf = BytesIO(); writer.write(pdf)

async def generate(payload):
    assert 'three books' in payload['text']
    return {'answer': json.dumps({'lessons': [{'title': title, 'content': TEXT} for title in ['Introduction', 'Main concepts', 'Examples']]})}

def upload(name, data):
    return {'filename': name, 'data': base64.b64encode(data).decode(), 'goal': 'Learn the rules', 'difficulty': 'Beginner'}

with patch.object(worker, 'run', generate):
    for name, data in [('notes.txt', TEXT.encode()), ('notes.pdf', pdf.getvalue())]:
        result = asyncio.run(worker.run_document(upload(name, data)))
        assert result['source'] == name and len(result['lessons']) == 3
        assert 'three books' in result['text']
    long_text = (TEXT + '\n') * 8000
    result = asyncio.run(worker.run_document(upload('long.txt', long_text.encode())))
    assert len(result['text']) > 500000 and result['text'].endswith(TEXT)
    blank = PdfWriter(); blank.add_blank_page(width=200, height=200)
    buffer = BytesIO(); blank.write(buffer)
    for name, data in [('empty.pdf', buffer.getvalue()), ('broken.pdf', b'%PDF-broken'), ('binary.txt', b'\x00' * 50)]:
        try:
            asyncio.run(worker.run_document(upload(name, data)))
            raise AssertionError('Invalid document was accepted')
        except DocumentError:
            pass
print('PDF/TXT extraction, generated lesson contract, and invalid-document checks passed.')
