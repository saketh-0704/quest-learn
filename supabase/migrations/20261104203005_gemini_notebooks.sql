begin;
create table public.notebooks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 1 and 120),
 deleting boolean not null default false,
 created_at timestamptz not null default now(),
 unique(id,user_id)
);
alter table public.notebooks enable row level security;
revoke all on public.notebooks from public, anon, authenticated;
grant select on public.notebooks to authenticated;
grant all on public.notebooks to service_role;
create policy notebook_owner on public.notebooks for select to authenticated
 using ((select auth.uid())=user_id);
create index notebooks_owner on public.notebooks(user_id);

alter table public.documents
 add column notebook_id uuid,
 add column phase text not null default 'queued',
 add column completed_chunks integer not null default 0,
 add column total_chunks integer,
 add column attempts integer not null default 0,
 add column available_at timestamptz not null default now(),
 add column lease_until timestamptz,
 add column job_token uuid,
 add column error_code text,
 add column warnings jsonb not null default '[]',
 add column materials jsonb,
 add column learned boolean not null default false,
 add foreign key (notebook_id,user_id) references public.notebooks(id,user_id) on delete cascade;
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
 check (status in ('uploaded','processing','ready','failed','cancelled'));
create index documents_notebook on public.documents(notebook_id,user_id);
create index documents_queue on public.documents(available_at) where status in ('uploaded','processing');

create table public.notebook_turns (
 id uuid primary key,
 notebook_id uuid not null,
 user_id uuid not null,
 question text not null check (char_length(question) between 1 and 2000),
 answer text not null check (char_length(answer) between 1 and 24000),
 sources jsonb not null,
 created_at timestamptz not null default now(),
 foreign key (notebook_id,user_id) references public.notebooks(id,user_id) on delete cascade
);
alter table public.notebook_turns enable row level security;
revoke all on public.notebook_turns from public, anon, authenticated;
grant select on public.notebook_turns to authenticated;
grant all on public.notebook_turns to service_role;
create policy turn_owner on public.notebook_turns for select to authenticated using ((select auth.uid())=user_id);
create index notebook_turns_owner on public.notebook_turns(user_id,notebook_id,created_at);
commit;
