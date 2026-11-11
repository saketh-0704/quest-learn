-- Real PostgreSQL retrieval behavior. Isolated local/test database only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000001','hybrid-a@example.invalid'),
 ('11000000-0000-0000-0000-000000000002','hybrid-b@example.invalid');
insert into public.documents(id,user_id,filename,kind,content_type,size_bytes,status,embedding_model,embedding_dimensions) values
 ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','selected.txt','txt','text/plain',100,'ready','fixture-v1',3),
 ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','other-user.txt','txt','text/plain',100,'ready','fixture-v1',3),
 ('22000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','other-document.txt','txt','text/plain',100,'ready','fixture-v1',3),
 ('22000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000001','waiting.txt','txt','text/plain',100,'uploaded',null,null),
 ('22000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000001','source.pdf','pdf','application/pdf',100,'ready','fixture-v1',3);
insert into quest_private.document_chunks(id,document_id,user_id,document_kind,chunk_index,page_number,content,embedding_model,embedding_dimensions,embedding) values
 ('33000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','txt',0,null,'Named reusable blocks accept inputs.','fixture-v1',3,'[1,0,0]'),
 ('33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','txt',1,null,'quasar quasar quasar is an identifier.','fixture-v1',3,'[0,1,0]'),
 ('33000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','txt',2,null,'quasar groups reusable instructions.','fixture-v1',3,'[0.9,0.1,0]'),
 ('33000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','txt',0,null,'quasar private other-user content.','fixture-v1',3,'[1,0,0]'),
 ('33000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','txt',0,null,'quasar another document.','fixture-v1',3,'[1,0,0]'),
 ('33000000-0000-0000-0000-000000000006','22000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000001','pdf',0,4,'quasar PDF passage.','fixture-v1',3,'[1,0,0]'),
 ('33000000-0000-0000-0000-000000000007','22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','txt',3,null,'zeromarker reference with a legacy zero vector.','fixture-v1',3,'[0,0,0]');
-- Ranks are tested using synthetic vectors only in this SQL test fixture.
create temp table hybrid_result as select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1',6,24,0.8,1,1,60);
select is((select count(*) from hybrid_result),3::bigint,'Hybrid search retains semantic-only and keyword-only matches');
select is((select chunk_id from hybrid_result order by fusion_score desc limit 1),
 '33000000-0000-0000-0000-000000000003'::uuid,'A chunk supported by both branches ranks first');
select ok((select semantic_rank is not null and keyword_rank is null from hybrid_result where chunk_index=0),'Semantic paraphrase survives without a keyword match');
select ok((select semantic_rank is null and keyword_rank is not null from hybrid_result where chunk_index=1),'Exact keyword survives below similarity threshold');
select is((select count(distinct chunk_id) from hybrid_result),3::bigint,'Fusion does not duplicate shared chunks');
select ok((select bool_and(document_id='22000000-0000-0000-0000-000000000001'::uuid) from hybrid_result),'Neither branch returns other documents');
select ok((select bool_and(page_number is null and document_kind='txt') from hybrid_result),'TXT metadata has no fake page numbers');
select ok((select abs(fusion_score-(1.0/(60+semantic_rank)+1.0/(60+keyword_rank)))<0.000000001 from hybrid_result where chunk_index=2),'RRF combines ranks rather than incompatible raw scores');
select is((select count(*) from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'missingtermbeyondreference','[0,0,-1]','fixture-v1',6,24,0.8)),0::bigint,'No keyword or eligible semantic evidence returns an empty set');
select is((select count(*) from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1',1,24,0.8)),1::bigint,'Final result count is bounded');
select is((select count(*) from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1',6,24,0.8,0,1)),2::bigint,'Explicit keyword-only weighting excludes semantic-only candidates');
select is((select page_number from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1')),4,'PDF citations retain the stored page');
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1')$$,'P0002',null,'Caller cannot select another user document');
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1')$$,'55000',null,'Unprocessed documents cannot be searched');
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','different-model')$$,'22023',null,'Same vector dimension with wrong model is rejected');
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0]','fixture-v1')$$,'22023',null,'Wrong vector dimension is rejected');
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[0,0,0]','fixture-v1')$$,'22023',null,'Zero query vectors are rejected');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'quasar','[1,0,0]','fixture-v1')$$,'42501',null,'Browser role cannot call privileged retrieval even for its own document');
reset role;
select ok(not has_function_privilege('anon',
 'quest_private.hybrid_document_search(uuid,uuid,text,extensions.vector,text,integer,integer,double precision,double precision,double precision,integer)','EXECUTE'),
 'Anonymous callers have no retrieval execution grant');
select ok((select semantic_similarity is null and semantic_rank is null and keyword_rank is not null
 from quest_private.hybrid_document_search(
 '22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',
 'zeromarker','[0,0,-1]','fixture-v1',6,24,0.8)),
 'Stored zero vectors can match keywords but never become perfect cosine matches');
select * from finish();
rollback;
