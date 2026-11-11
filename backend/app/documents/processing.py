"""Deterministic extraction core. Run PDF parsing in a bounded worker before HTTP exposure."""
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
import unicodedata

from pypdf import PdfReader
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProcessingLimits(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    max_bytes: int = Field(default=10 * 1024 * 1024, ge=1, le=10 * 1024 * 1024)
    max_pages: int = Field(default=100, ge=1, le=100)
    max_characters: int | None = Field(default=500_000, ge=1, le=2_000_000)
    max_page_stream_bytes: int = Field(default=5_000_000, ge=1, le=10_000_000)
    chunk_size: int = Field(default=2000, ge=100, le=6000)
    chunk_overlap: int = Field(default=200, ge=0, le=5999)

    @model_validator(mode="after")
    def check_overlap(self):
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("Chunk overlap must be smaller than chunk size")
        return self


class DocumentError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Chunk:
    index: int
    page_number: int | None
    content: str


@dataclass(frozen=True)
class Extraction:
    filename: str
    kind: str
    content_type: str
    size_bytes: int
    page_count: int | None
    chunks: tuple[Chunk, ...]
    empty_pages: tuple[int, ...]


def validate_file(filename: str, data: bytes, content_type: str, limits: ProcessingLimits) -> str:
    if not filename.strip() or len(filename) > 255 or any(c in filename for c in '/\\:') or any(unicodedata.category(c).startswith('C') for c in filename):
        raise DocumentError("invalid_filename", "Use a filename without path separators or control characters.")
    if not data:
        raise DocumentError("empty_file", "The selected file is empty.")
    if len(data) > limits.max_bytes:
        raise DocumentError("file_too_large", "The selected file exceeds the upload limit.")
    kind = PurePosixPath(filename).suffix.lower().removeprefix('.')
    expected = {"pdf": "application/pdf", "txt": "text/plain"}
    if kind not in expected or content_type.split(';')[0].strip().lower() != expected[kind]:
        raise DocumentError("unsupported_type", "Use a PDF or UTF-8 TXT file with the matching content type.")
    if kind == "pdf" and not data.startswith(b'%PDF-'):
        raise DocumentError("invalid_pdf", "The file does not contain a valid PDF header.")
    return kind


def normalize_text(text: str) -> str:
    text = unicodedata.normalize('NFC', text.replace('\r\n', '\n').replace('\r', '\n'))
    # Preserve Unicode and paragraph boundaries; reject binary control bytes earlier for TXT.
    return ''.join(c for c in text if not unicodedata.category(c).startswith('C') or c in '\n\t').strip()


def extract_document(filename: str, data: bytes, content_type: str, limits: ProcessingLimits | None = None) -> Extraction:
    limits = limits or ProcessingLimits()
    kind = validate_file(filename, data, content_type, limits)
    pages: list[tuple[int | None, str]] = []
    empty_pages: list[int] = []
    page_count = None
    if kind == "txt":
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise DocumentError("invalid_text_encoding", "Save the TXT file as UTF-8 and try again.") from None
        if any(unicodedata.category(c) == 'Cc' and c not in '\n\r\t' for c in text):
            raise DocumentError("binary_text", "The TXT file contains binary control characters.")
        pages.append((None, normalize_text(text)))
    else:
        try:
            reader = PdfReader(BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise DocumentError("encrypted_pdf", "Remove PDF password protection before uploading.")
            page_count = len(reader.pages)
            if not 1 <= page_count <= limits.max_pages:
                raise DocumentError("page_limit", "The PDF has no pages or exceeds the page limit.")
            total = 0
            for number, page in enumerate(reader.pages, start=1):
                stream = page.get_contents()
                if stream is not None and len(stream.get_data()) > limits.max_page_stream_bytes:
                    raise DocumentError("complex_pdf", "A PDF page exceeds the processing limit. Split or simplify the file.")
                text = normalize_text(page.extract_text() or '')
                total += len(text)
                if limits.max_characters is not None and total > limits.max_characters:
                    raise DocumentError("text_limit", "Extracted text exceeds the processing limit. Split the document.")
                if not text:
                    empty_pages.append(number)
                pages.append((number, text))
        except DocumentError:
            raise
        except Exception:
            raise DocumentError("invalid_pdf", "The PDF could not be read. Export a new text-based PDF.") from None
    if limits.max_characters is not None and sum(len(text) for _, text in pages) > limits.max_characters:
        raise DocumentError("text_limit", "Extracted text exceeds the processing limit. Split the document.")
    if not any(text for _, text in pages):
        raise DocumentError("no_readable_text", "No readable text was found. Scanned PDFs need OCR, which is not supported yet.")
    chunks: list[Chunk] = []
    for page_number, text in pages:
        start = 0
        while start < len(text):
            end = min(start + limits.chunk_size, len(text))
            content = text[start:end].strip()
            if content:
                chunks.append(Chunk(len(chunks), page_number, content))
            if end == len(text):
                break
            start = end - limits.chunk_overlap
    return Extraction(filename, kind, 'application/pdf' if kind == 'pdf' else 'text/plain', len(data), page_count, tuple(chunks), tuple(empty_pages))
