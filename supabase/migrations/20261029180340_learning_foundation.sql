-- QuestLearn Day 2. New objects only; no existing data is deleted.
-- Run once through migration history, never repeatedly in the dashboard.
begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema quest_private;
revoke all on schema quest_private from public, anon, authenticated;
grant usage on schema quest_private to service_role;

-- Every user-facing application table is READ ONLY to the browser.
-- Future verified FastAPI endpoints perform all writes, grading and rewards.
create table public.documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null check (char_length(filename) between 1 and 255),
    kind text not null check (kind in ('pdf', 'txt')),
    content_type text not null,
    size_bytes bigint not null check (size_bytes between 1 and 10485760),
    status text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
    failure_reason text,
    page_count integer check (page_count between 1 and 100),
    embedding_model text,
    embedding_dimensions integer check (embedding_dimensions between 1 and 16000),
    storage_bucket text not null default 'study-material' check (storage_bucket = 'study-material'),
    storage_path text generated always as (user_id::text || '/' || id::text || '.' || kind) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, user_id),
    unique (storage_path),
    unique (id, user_id, kind, embedding_model, embedding_dimensions),
    check ((kind='pdf' and content_type='application/pdf') or (kind='txt' and content_type='text/plain')),
    check (kind='pdf' or page_count is null),
    check ((embedding_model is null) = (embedding_dimensions is null)),
    check (status <> 'ready' or embedding_model is not null)
);

-- Kept outside exposed schemas: raw reference text and vectors are server-only.
-- Dimensions are selected with the embedding model in Day 5, not guessed now.
create table quest_private.document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null,
    user_id uuid not null,
    document_kind text not null,
    chunk_index integer not null check (chunk_index >= 0),
    page_number integer,
    content text not null check (char_length(content) between 1 and 6000),
    embedding_model text not null,
    embedding_dimensions integer not null,
    embedding extensions.vector not null,
    created_at timestamptz not null default now(),
    unique (document_id, chunk_index),
    unique (id, document_id, user_id),
    foreign key (document_id,user_id,document_kind,embedding_model,embedding_dimensions)
      references public.documents(id,user_id,kind,embedding_model,embedding_dimensions) on delete cascade,
    check (extensions.vector_dims(embedding) = embedding_dimensions),
    check ((document_kind='pdf' and page_number is not null and page_number between 1 and 100) or (document_kind='txt' and page_number is null))
);

create table public.learning_paths (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    document_id uuid,
    mode text not null check (mode in ('document','topic')),
    topic text not null check (char_length(topic) between 1 and 200),
    goal text not null check (char_length(goal) between 1 and 1000),
    difficulty text not null check (difficulty in ('beginner','intermediate','advanced')),
    created_at timestamptz not null default now(),
    unique (id,user_id),
    unique (id,user_id,mode),
    unique (id,user_id,document_id),
    foreign key (document_id,user_id) references public.documents(id,user_id) on delete cascade,
    check ((mode='document' and document_id is not null) or (mode='topic' and document_id is null))
);
create table public.missions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    learning_path_id uuid not null,
    position integer not null check (position between 0 and 3),
    title text not null check (char_length(title) between 1 and 200),
    objective text not null check (char_length(objective) between 1 and 1000),
    activity_type text not null check (activity_type in ('lesson','quiz')),
    lesson_content text,
    created_at timestamptz not null default now(),
    unique (learning_path_id,position),
    unique (id,user_id),
    unique (id,user_id,learning_path_id),
    foreign key (learning_path_id,user_id) references public.learning_paths(id,user_id) on delete cascade
);
create table public.mission_progress (
    mission_id uuid not null,
    user_id uuid not null,
    status text not null check (status in ('started','completed')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key (mission_id,user_id),
    foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
    check ((status='completed') = (completed_at is not null)),
    check (completed_at is null or completed_at >= started_at)
);

create table public.chats (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    document_id uuid not null,
    created_at timestamptz not null default now(),
    unique (id,user_id),
    unique (id,user_id,document_id),
    foreign key (document_id,user_id) references public.documents(id,user_id) on delete cascade
);
create table public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    chat_id uuid not null,
    role text not null check (role in ('user','assistant')),
    content text not null check (char_length(content) between 1 and 20000),
    created_at timestamptz not null default now(),
    unique (id,user_id,chat_id),
    foreign key (chat_id,user_id) references public.chats(id,user_id) on delete cascade
);
-- Citation links cannot point at another document or another user's chunks.
create table quest_private.message_sources (
    message_id uuid not null,
    user_id uuid not null,
    chat_id uuid not null,
    document_id uuid not null,
    chunk_id uuid not null,
    primary key (message_id,chunk_id),
    foreign key (message_id,user_id,chat_id) references public.chat_messages(id,user_id,chat_id) on delete cascade,
    foreign key (chat_id,user_id,document_id) references public.chats(id,user_id,document_id) on delete cascade,
    foreign key (chunk_id,document_id,user_id) references quest_private.document_chunks(id,document_id,user_id) on delete cascade
);

create table public.quizzes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    learning_path_id uuid not null,
    mission_id uuid not null unique,
    mode text not null check (mode in ('document','topic')),
    document_id uuid,
    topic text not null,
    difficulty text not null check (difficulty in ('beginner','intermediate','advanced')),
    created_at timestamptz not null default now(),
    unique (id,user_id),
    unique (id,user_id,document_id),
    foreign key (learning_path_id,user_id,mode) references public.learning_paths(id,user_id,mode) on delete cascade,
    foreign key (learning_path_id,user_id,document_id) references public.learning_paths(id,user_id,document_id) on delete cascade,
    foreign key (mission_id,user_id,learning_path_id) references public.missions(id,user_id,learning_path_id) on delete cascade,
    check ((mode='document' and document_id is not null) or (mode='topic' and document_id is null))
);
-- Correct answers and explanations are intentionally absent from this table.
create table public.quiz_questions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    quiz_id uuid not null,
    position integer not null check (position between 0 and 4),
    prompt text not null check (char_length(prompt) between 1 and 2000),
    options text[] not null,
    unique (quiz_id,position),
    unique (id,user_id,quiz_id),
    foreign key (quiz_id,user_id) references public.quizzes(id,user_id) on delete cascade,
    check (cardinality(options)=4 and array_ndims(options)=1 and array_lower(options,1)=1 and array_length(options,1)=4),
    check (array_position(options,null) is null),
    check (btrim(options[1]) <> '' and btrim(options[2]) <> '' and btrim(options[3]) <> '' and btrim(options[4]) <> ''),
    check (lower(btrim(options[1])) not in (lower(btrim(options[2])),lower(btrim(options[3])),lower(btrim(options[4])))
      and lower(btrim(options[2])) not in (lower(btrim(options[3])),lower(btrim(options[4])))
      and lower(btrim(options[3])) <> lower(btrim(options[4])))
);
create table quest_private.quiz_answer_keys (
    question_id uuid primary key,
    user_id uuid not null,
    quiz_id uuid not null,
    correct_option integer not null check (correct_option between 0 and 3),
    explanation text not null check (char_length(explanation) between 1 and 4000),
    foreign key (question_id,user_id,quiz_id) references public.quiz_questions(id,user_id,quiz_id) on delete cascade
);
create table quest_private.question_sources (
    question_id uuid not null,
    quiz_id uuid not null,
    user_id uuid not null,
    document_id uuid not null,
    chunk_id uuid not null,
    primary key (question_id,chunk_id),
    foreign key (question_id,user_id,quiz_id) references public.quiz_questions(id,user_id,quiz_id) on delete cascade,
    foreign key (quiz_id,user_id,document_id) references public.quizzes(id,user_id,document_id) on delete cascade,
    foreign key (chunk_id,document_id,user_id) references quest_private.document_chunks(id,document_id,user_id) on delete cascade
);

create table public.quiz_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    quiz_id uuid not null,
    is_first_attempt boolean not null,
    score integer not null check (score between 0 and 5),
    submitted_at timestamptz not null default now(),
    unique (id,user_id,quiz_id),
    unique (id,user_id,quiz_id,is_first_attempt),
    foreign key (quiz_id,user_id) references public.quizzes(id,user_id) on delete cascade
);
create unique index quiz_one_first_attempt on public.quiz_attempts(user_id,quiz_id) where is_first_attempt;
create table public.attempt_answers (
    attempt_id uuid not null,
    user_id uuid not null,
    quiz_id uuid not null,
    question_id uuid not null,
    selected_option integer not null check (selected_option between 0 and 3),
    is_correct boolean not null,
    feedback text not null,
    primary key (attempt_id,question_id),
    unique (attempt_id,question_id,user_id,is_correct),
    foreign key (attempt_id,user_id,quiz_id) references public.quiz_attempts(id,user_id,quiz_id) on delete cascade,
    foreign key (question_id,user_id,quiz_id) references public.quiz_questions(id,user_id,quiz_id) on delete cascade
);
-- Ledger scaffolding. No reward-generating RPC exists in Day 2.
-- Day 11 must atomically submit all five answers, score, complete mission and award XP.
create table public.xp_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    quiz_id uuid not null,
    attempt_id uuid not null,
    question_id uuid,
    kind text not null check (kind in ('correct_answer','mission_completion')),
    amount integer not null,
    eligible_first boolean not null default true check (eligible_first),
    correct_answer boolean,
    created_at timestamptz not null default now(),
    foreign key (attempt_id,user_id,quiz_id,eligible_first)
      references public.quiz_attempts(id,user_id,quiz_id,is_first_attempt) on delete cascade,
    foreign key (attempt_id,question_id,user_id,correct_answer)
      references public.attempt_answers(attempt_id,question_id,user_id,is_correct) on delete cascade,
    check ((kind='correct_answer' and amount=20 and question_id is not null and correct_answer is true)
      or (kind='mission_completion' and amount=50 and question_id is null and correct_answer is null))
);
create unique index xp_once_per_correct_question on public.xp_transactions(user_id,question_id) where kind='correct_answer';
create unique index xp_once_per_quiz_completion on public.xp_transactions(user_id,quiz_id) where kind='mission_completion';
create table public.earned_badges (
    user_id uuid not null references auth.users(id) on delete cascade,
    badge_code text not null check (badge_code in ('first_quiz_completed','five_quizzes_completed')),
    earned_at timestamptz not null default now(),
    primary key (user_id,badge_code)
);

-- Explicit grants + RLS together: no client can write scores, XP, keys, or metadata.
do $$
declare relation text;
begin
 foreach relation in array array['documents','learning_paths','missions','mission_progress','chats','chat_messages',
   'quizzes','quiz_questions','quiz_attempts','attempt_answers','xp_transactions','earned_badges'] loop
  execute format('alter table public.%I enable row level security',relation);
  execute format('revoke all on table public.%I from public,anon,authenticated',relation);
  execute format('grant select on table public.%I to authenticated',relation);
  execute format('grant all on table public.%I to service_role',relation);
  execute format('create policy own_records on public.%I for select to authenticated using ((select auth.uid()) = user_id)',relation);
  execute format('create index %I on public.%I(user_id)',relation || '_owner_idx',relation);
 end loop;
 foreach relation in array array['document_chunks','message_sources','quiz_answer_keys','question_sources'] loop
  execute format('alter table quest_private.%I enable row level security',relation);
  execute format('revoke all on table quest_private.%I from public,anon,authenticated',relation);
  execute format('grant all on table quest_private.%I to service_role',relation);
 end loop;
end $$;

-- No public file URLs. API validates type/size/content before privileged upload.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('study-material','study-material',false,10485760,array['application/pdf','text/plain']);
create policy questlearn_read_owned_file on storage.objects for select to authenticated
using (bucket_id='study-material' and exists (
 select 1 from public.documents d where d.storage_path=name and d.user_id=(select auth.uid())
));
-- Intentionally no browser INSERT/UPDATE/DELETE policies for this bucket.
-- Storage objects must be removed through the Storage API, never SQL DELETE.
commit;
