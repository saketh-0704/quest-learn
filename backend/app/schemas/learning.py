from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal


class UnderstandText(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=40)
    question: str = Field(min_length=3, max_length=1000)

    @field_validator("text", "question")
    @classmethod
    def no_null(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("Text cannot contain null characters")
        return value


class TextAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=24000)
    source: str = "Your supplied study text"


class DocumentUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    filename: str = Field(min_length=1, max_length=255)
    data: str = Field(min_length=4, max_length=13981016)
    goal: str = Field(min_length=1, max_length=1000)
    difficulty: Literal['Beginner', 'Intermediate', 'Advanced']

    @field_validator('filename')
    @classmethod
    def valid_filename(cls, value):
        if any(c in value for c in '/\\:') or any(ord(c) < 32 for c in value) or not value.lower().endswith(('.pdf', '.txt')):
            raise ValueError('Use a PDF or TXT filename without path separators.')
        return value


class Lesson(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=150)
    content: str = Field(min_length=40, max_length=8000)


class GeneratedLessons(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lessons: list[Lesson] = Field(min_length=3, max_length=3)


class DocumentLearning(GeneratedLessons):
    text: str = Field(min_length=40)
    source: str = Field(min_length=1, max_length=255)
    warnings: list[str] = Field(default_factory=list)
