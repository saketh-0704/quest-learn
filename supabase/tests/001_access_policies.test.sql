-- Intended for an isolated local Supabase DB, never seed production users.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','quest-test-a@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','quest-test-b@example.invalid');
insert into public.documents(id,user_id,filename,kind,content_type,size_bytes,embedding_model,embedding_dimensions) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a.txt','txt','text/plain',100,'test-embedding',3),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','b.txt','txt','text/plain',100,'test-embedding',3);
insert into quest_private.document_chunks(id,document_id,user_id,document_kind,chunk_index,content,embedding_model,embedding_dimensions,embedding) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','txt',0,'User A passage','test-embedding',3,'[1,0,0]'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','txt',0,'User B passage','test-embedding',3,'[0,1,0]');
insert into public.learning_paths(id,user_id,mode,topic,goal,difficulty) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','topic','Functions','Understand functions','beginner'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','topic','Functions','Understand functions','beginner');
insert into public.missions(id,user_id,learning_path_id,position,title,objective,activity_type) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',3,'Check','Five questions','quiz'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002',3,'Check','Five questions','quiz');
insert into public.quizzes(id,user_id,learning_path_id,mission_id,mode,topic,difficulty) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','topic','Functions','beginner'),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','topic','Functions','beginner');
insert into public.quiz_questions(id,user_id,quiz_id,position,prompt,options) values
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'A question',array['A','B','C','D']),
 ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',0,'B question',array['A','B','C','D']);
insert into quest_private.quiz_answer_keys(question_id,user_id,quiz_id,correct_option,explanation)
 values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'Private answer');
insert into public.quiz_attempts(id,user_id,quiz_id,is_first_attempt,score) values
 ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',true,1),
 ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',true,0);
insert into public.attempt_answers(attempt_id,user_id,quiz_id,question_id,selected_option,is_correct,feedback)
 values ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',0,true,'Correct');
insert into public.xp_transactions(user_id,quiz_id,attempt_id,kind,amount)
 values ('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','mission_completion',50);
insert into public.chats(id,user_id,document_id) values
 ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
insert into public.mission_progress(mission_id,user_id,status) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','started'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','started');
-- Metadata fixtures only. There are no real stored files in this test.
insert into storage.objects(bucket_id,name) select storage_bucket,storage_path from public.documents;

-- Both users must be isolated in both directions.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.documents),1::bigint,'A sees only one document');
select is((select filename from public.documents),'a.txt','A sees own document');
select is((select count(*) from public.quizzes),1::bigint,'A sees only own quiz');
select is((select count(*) from public.quiz_questions),1::bigint,'A sees only own questions');
select is((select count(*) from public.quiz_attempts),1::bigint,'A sees only own attempt');
select is((select count(*) from public.chats),1::bigint,'A sees only own chat');
select is((select count(*) from public.mission_progress),1::bigint,'A sees only own progress');
select is((select count(*) from storage.objects where bucket_id='study-material'),1::bigint,'A sees only own file metadata');
select throws_ok('select * from quest_private.quiz_answer_keys','42501',null,'Answer keys are inaccessible even to their owner');
select throws_ok('select * from quest_private.document_chunks','42501',null,'Raw chunks are server only');
select throws_ok('update public.xp_transactions set amount=999','42501',null,'Browser cannot edit XP');
select throws_ok('update public.quiz_attempts set score=5','42501',null,'Browser cannot edit scores');
select throws_ok('delete from public.documents','42501',null,'Browser cannot bypass Storage API deletion');
select throws_ok($$insert into storage.objects(bucket_id,name) values('study-material','forged.txt')$$,'42501',null,'Browser cannot upload through database');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select filename from public.documents),'b.txt','B sees own document, not A');
select is((select count(*) from public.quizzes),1::bigint,'B sees only own quiz');
select is((select count(*) from public.chats),1::bigint,'B sees only own chat');
select is((select count(*) from public.xp_transactions),0::bigint,'B cannot see A rewards');
select is((select count(*) from storage.objects where bucket_id='study-material'),1::bigint,'B sees only own file metadata');
reset role;
set local role anon;
select throws_ok('select * from public.documents','42501',null,'Anonymous clients cannot read documents');
select throws_ok('select * from public.quiz_questions','42501',null,'Anonymous clients cannot read questions');
reset role;

-- PostgreSQL constraints also defend against inconsistent privileged writes.
select throws_ok($$insert into public.learning_paths(user_id,document_id,mode,topic,goal,difficulty)
 values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','document','x','x','beginner')$$,
 '23503',null,'Cross-owner document links fail');
select throws_ok($$insert into quest_private.document_chunks(document_id,user_id,document_kind,chunk_index,content,embedding_model,embedding_dimensions,embedding)
 values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','txt',0,'duplicate','test-embedding',3,'[1,0,0]')$$,
 '23505',null,'Reprocessing cannot duplicate a chunk index');
select throws_ok($$insert into quest_private.document_chunks(document_id,user_id,document_kind,chunk_index,content,embedding_model,embedding_dimensions,embedding)
 values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','txt',1,'bad dimension','test-embedding',3,'[1,0]')$$,
 '23514',null,'Embedding length must match configured dimensions');
select throws_ok($$insert into public.quiz_questions(user_id,quiz_id,position,prompt,options)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,'duplicate options',array['A',' a ','B','C'])$$,
 '23514',null,'Options must be distinct');
select throws_ok($$insert into public.quiz_questions(user_id,quiz_id,position,prompt,options)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,'empty options',array[]::text[])$$,
 '23514',null,'Empty option array is rejected');
select throws_ok($$insert into public.quiz_attempts(user_id,quiz_id,is_first_attempt,score)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',true,1)$$,
 '23505',null,'Only one first attempt is allowed');
select throws_ok($$insert into public.xp_transactions(user_id,quiz_id,attempt_id,kind,amount)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','mission_completion',50)$$,
 '23505',null,'Completion XP cannot be duplicated');
select is((select public from storage.buckets where id='study-material'),false,'Storage bucket is private');
select is((select count(*) from public.quiz_questions),2::bigint,'Ownership tests did not delete records');
select ok(not exists (
 select 1 from information_schema.columns where table_schema='public' and table_name='quiz_questions'
 and column_name in ('correct_option','correct_answer','explanation')
),'Public quiz questions contain no answer keys');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','quest_private') and c.relname in
 ('documents','learning_paths','missions','mission_progress','chats','chat_messages','quizzes','quiz_questions',
 'quiz_attempts','attempt_answers','xp_transactions','earned_badges','document_chunks','message_sources','quiz_answer_keys','question_sources')),
 'All application tables enable RLS');
select * from finish();
rollback;
