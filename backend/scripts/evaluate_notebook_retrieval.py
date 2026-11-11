"""Bounded live comparison: one legacy request (24-call ceiling) and three direct calls.

This is a fixture regression check, not proof of equivalence on arbitrary documents.
"""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings
from app.documents.processing import extract_document
from app.notebooks.gemini import embed, grounded_answer
from app.schemas.learning import UnderstandText
from app.services.text_learning import understand_text


def run():
    settings=Settings()
    root=Path(__file__).resolve().parents[1]
    extraction=extract_document('cedar.pdf',(root/'tests/fixtures/cedar.pdf').read_bytes(),'application/pdf')
    text='\n'.join(chunk.content for chunk in extraction.chunks)
    question='According to these sources, how many books can a member borrow, for how long, and what is the late return charge? Also say whether the source names the mayor.'
    legacy=asyncio.run(understand_text(UnderstandText(text=text,question=question),settings))
    vectors=embed(settings,[chunk.content for chunk in extraction.chunks])
    query=embed(settings,[question],query=True)[0]
    ranked=sorted(zip(extraction.chunks,vectors),key=lambda pair:sum(a*b for a,b in zip(pair[1],query)),reverse=True)
    evidence=[{'chunk_id':str(chunk.index),'document_id':'fixture','filename':'cedar.pdf','page_number':chunk.page_number,'content':chunk.content} for chunk,_ in ranked[:6]]
    direct=grounded_answer(settings,question,evidence)
    def facts(answer):
        value=answer.lower()
        return {'books': 'three' in value or '3' in value,'days':'fourteen' in value or '14' in value,
                'late_fee':'two' in value or '2' in value,'unknown_mayor': 'mayor' in value and any(x in value for x in ('not','no ','doesn','insufficient'))}
    result={'fixture':'cedar.pdf (two pages)', 'legacy_naive_mode':facts(legacy.answer), 'chunk_vector_retrieval':facts(direct['answer']),
            'source_pages': sorted({row['page_number'] for row in direct['sources']}),
            'limitation':'One controlled fixture. Does not establish general retrieval equivalence; legacy RAGAnything retained.'}
    (root.parent/'docs/notebook-retrieval-evaluation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
    assert all(result['legacy_naive_mode'].values()) and all(result['chunk_vector_retrieval'].values())


if __name__=='__main__': run()
