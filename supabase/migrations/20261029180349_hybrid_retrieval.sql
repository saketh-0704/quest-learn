-- Requires the Day 2 foundation. No hosted execution has been authorized/performed.
begin;

alter table quest_private.document_chunks
 add column search_vector tsvector generated always as
 (to_tsvector('pg_catalog.english'::regconfig, content)) stored;
create index document_chunks_keywords_gin on quest_private.document_chunks using gin(search_vector);
-- Exact cosine search within one bounded document for the MVP. A vector ANN
-- index needs a fixed embedding model/dimension strategy; do not guess one here.

create function quest_private.hybrid_document_search(
 p_document_id uuid,
 p_user_id uuid,
 p_query_text text,
 p_query_embedding extensions.vector,
 p_embedding_model text,
 p_match_count integer default 6,
 p_candidate_count integer default 24,
 p_min_similarity double precision default 0.35,
 p_semantic_weight double precision default 1,
 p_keyword_weight double precision default 1,
 p_rrf_k integer default 60
) returns table (
 chunk_id uuid,
 document_id uuid,
 chunk_index integer,
 document_kind text,
 page_number integer,
 content text,
 semantic_similarity double precision,
 semantic_rank bigint,
 keyword_rank bigint,
 fusion_score double precision
)
language plpgsql stable security invoker
set search_path = pg_catalog, extensions
as $$
declare selected_document record;
begin
 if p_document_id is null or p_user_id is null or p_query_text is null
   or char_length(btrim(p_query_text)) not between 1 and 2000
   or p_query_embedding is null or p_embedding_model is null or btrim(p_embedding_model)=''
   or p_match_count is null or p_match_count not between 1 and 12
   or p_candidate_count is null or p_candidate_count not between p_match_count and 50
   or p_min_similarity is null or p_min_similarity not between -1 and 1
   or p_semantic_weight is null or p_semantic_weight not between 0 and 10
   or p_keyword_weight is null or p_keyword_weight not between 0 and 10
   or p_semantic_weight+p_keyword_weight=0
   or p_rrf_k is null or p_rrf_k not between 1 and 1000
   or extensions.vector_norm(p_query_embedding)=0 then
  raise exception using errcode='22023', message='Invalid hybrid search parameters';
 end if;

 -- A privileged caller still must provide the verified token subject. Do not
 -- expose this function as a browser RPC or accept a browser-supplied user ID.
 select d.* into selected_document from public.documents d
 where d.id=p_document_id and d.user_id=p_user_id;
 if not found then
  raise exception using errcode='P0002', message='Document is not available';
 end if;
 if selected_document.status <> 'ready' then
  raise exception using errcode='55000', message='Document is not ready for search';
 end if;
 if selected_document.embedding_model <> p_embedding_model
   or selected_document.embedding_dimensions <> extensions.vector_dims(p_query_embedding) then
  raise exception using errcode='22023', message='Query embedding must match document embedding model and dimensions';
 end if;

 return query
 with scoped as materialized (
  select c.*, case when extensions.vector_norm(c.embedding)>0
    then greatest(-1.0,least(1.0,1-(c.embedding <=> p_query_embedding)))
    else null::double precision end as similarity
  from quest_private.document_chunks c
  where c.document_id=p_document_id and c.user_id=p_user_id
    and c.embedding_model=p_embedding_model
    and c.embedding_dimensions=selected_document.embedding_dimensions
 ), semantic_candidates as (
  select s.id, row_number() over(order by s.similarity desc,s.chunk_index,s.id) as rank
  from scoped s
  where p_semantic_weight>0 and s.similarity>=p_min_similarity
  order by s.similarity desc,s.chunk_index,s.id
  limit p_candidate_count
 ), keyword_candidates as (
  select s.id, row_number() over (
   order by ts_rank_cd(s.search_vector,websearch_to_tsquery('pg_catalog.english',p_query_text)) desc,s.chunk_index,s.id
  ) as rank
  from quest_private.document_chunks s
  where s.document_id=p_document_id and s.user_id=p_user_id
    and s.embedding_model=p_embedding_model
    and s.embedding_dimensions=selected_document.embedding_dimensions
    and p_keyword_weight>0 and s.search_vector @@ websearch_to_tsquery('pg_catalog.english',p_query_text)
  order by ts_rank_cd(s.search_vector,websearch_to_tsquery('pg_catalog.english',p_query_text)) desc,s.chunk_index,s.id
  limit p_candidate_count
 ), fused as (
  select coalesce(v.id,k.id) as id, v.rank as semantic_rank, k.rank as keyword_rank,
   coalesce(p_semantic_weight/(p_rrf_k+v.rank),0.0)
    + coalesce(p_keyword_weight/(p_rrf_k+k.rank),0.0) as score
  from semantic_candidates v full outer join keyword_candidates k on v.id=k.id
 )
 select s.id,s.document_id,s.chunk_index,s.document_kind,s.page_number,s.content,
  s.similarity,f.semantic_rank,f.keyword_rank,f.score
 from fused f join scoped s on s.id=f.id
 order by f.score desc,s.chunk_index,s.id
 limit p_match_count;
end;
$$;

revoke all on function quest_private.hybrid_document_search(uuid,uuid,text,extensions.vector,text,integer,integer,double precision,double precision,double precision,integer)
 from public,anon,authenticated;
grant execute on function quest_private.hybrid_document_search(uuid,uuid,text,extensions.vector,text,integer,integer,double precision,double precision,double precision,integer)
 to service_role;
commit;
