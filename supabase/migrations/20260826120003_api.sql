-- ============================================================================
-- Orbit — fonctions applicatives
--
-- Tout ce qui demande plus qu'un INSERT ou un SELECT simple passe par une
-- fonction. Deux raisons : garantir l'atomicite (creer un espace cree aussi son
-- appartenance et ses salons), et permettre des gestes qui touchent la ligne de
-- quelqu'un d'autre (epingler un message) sans ouvrir la politique RLS
-- correspondante a tout le monde.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

create or replace function public.create_space(
  p_name        text,
  p_description text default null
)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  base_slug text;
  candidate text;
  suffix    int := 0;
  created   public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Le nom de l''espace est obligatoire' using errcode = '22023';
  end if;

  base_slug := public.slugify(p_name);
  candidate := base_slug;
  while exists (select 1 from public.spaces where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (trim(p_name), candidate, nullif(trim(coalesce(p_description, '')), ''),
          me, public.accent_for(gen_random_uuid()))
  returning * into created;

  insert into public.space_members (space_id, user_id, role)
  values (created.id, me, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (created.id, 'general', 'text', 'Le salon principal.', 0),
    (created.id, 'Salon vocal', 'voice', null, 1);

  return created;
end;
$$;

-- Rejoindre un espace : uniquement avec le code d'invitation. C'est la seule
-- porte d'entree, puisque `space_members` n'a aucune politique d'insertion.
create or replace function public.join_space(p_invite_code text)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  target public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.spaces
   where invite_code = lower(trim(p_invite_code));

  if not found then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- Regenere le code d'invitation, pour couper l'acces a un lien qui a fuite.
create or replace function public.rotate_invite_code(p_space_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text;
begin
  if not public.can_manage_space(p_space_id) then
    raise exception 'Reserve aux administrateurs de l''espace' using errcode = '42501';
  end if;

  fresh := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  update public.spaces set invite_code = fresh where id = p_space_id;
  return fresh;
end;
$$;

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

-- Epingler touche le message d'autrui : la politique RLS d'UPDATE reste donc
-- limitee a l'auteur, et ce geste passe par ici.
create or replace function public.set_message_pinned(
  p_message_id uuid,
  p_pinned     boolean
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.messages;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  update public.messages
     set pinned = p_pinned
   where id = p_message_id
  returning * into updated;

  return updated;
end;
$$;

-- Ajoute la reaction si elle est absente, la retire sinon, en un aller-retour.
create or replace function public.toggle_reaction(
  p_message_id uuid,
  p_emoji      text
)
returns table (out_emoji text, out_count bigint, out_reacted_by uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  -- GET DIAGNOSTICS ... ROW_COUNT renvoie un entier : le declarer booleen
  -- provoquerait une erreur de type a l'execution.
  removed int;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  delete from public.reactions r
   where r.message_id = p_message_id
     and r.user_id = me
     and r.emoji = p_emoji;

  get diagnostics removed = row_count;

  if removed = 0 then
    insert into public.reactions (message_id, user_id, emoji)
    values (p_message_id, me, p_emoji)
    on conflict do nothing;
  end if;

  return query
    select r.emoji, count(*)::bigint, array_agg(r.user_id)
      from public.reactions r
     where r.message_id = p_message_id
     group by r.emoji
     order by min(r.created_at);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fils
-- ----------------------------------------------------------------------------

create or replace function public.start_thread(
  p_message_id uuid,
  p_title      text
)
returns public.threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  root    public.messages;
  chan    public.channels;
  created public.threads;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select * into root from public.messages where id = p_message_id;

  if root.thread_id is not null then
    raise exception 'On ne peut pas ouvrir un fil depuis une reponse de fil'
      using errcode = '22023';
  end if;

  -- Un message ne porte qu'un seul fil : on renvoie l'existant plutot que
  -- d'echouer, ce qui rend le double-clic inoffensif.
  select * into created from public.threads where root_message_id = p_message_id;
  if found then
    return created;
  end if;

  select * into chan from public.channels where id = root.channel_id;

  insert into public.threads (channel_id, space_id, root_message_id, title, created_by)
  values (root.channel_id, chan.space_id, p_message_id,
          left(coalesce(nullif(trim(p_title), ''), left(root.content, 80)), 120), me)
  returning * into created;

  -- `select distinct` plutot qu'une liste VALUES : quand on ouvre un fil sur
  -- son propre message, les deux identifiants sont les memes.
  insert into public.thread_participants (thread_id, user_id)
  select distinct created.id, candidate
    from unnest(array[root.author_id, me]) as candidate
  on conflict do nothing;

  return created;
end;
$$;

-- ----------------------------------------------------------------------------
-- Lecture
-- ----------------------------------------------------------------------------

create or replace function public.mark_channel_read(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not public.is_channel_member(p_channel_id) then
    return;
  end if;

  insert into public.read_states (user_id, channel_id, last_read_at, mention_count)
  values (me, p_channel_id, now(), 0)
  on conflict (user_id, channel_id)
    do update set last_read_at = now(), mention_count = 0;
end;
$$;

-- ----------------------------------------------------------------------------
-- Recherche
--
-- La fonction est SECURITY INVOKER : les politiques RLS s'appliquent donc
-- normalement et personne ne peut chercher dans un espace dont il n'est pas
-- membre. Le classement combine la pertinence BM25-like de Postgres
-- (`ts_rank_cd`) et la fraicheur, parce qu'un message pertinent d'hier vaut
-- generalement mieux qu'un message pertinent d'il y a trois ans.
-- ----------------------------------------------------------------------------

create or replace function public.search_messages(
  p_query          text,
  p_space_id       uuid    default null,
  p_author_id      uuid    default null,
  p_channel_id     uuid    default null,
  p_has_attachment boolean default false,
  p_pinned_only    boolean default false,
  p_before         timestamptz default null,
  p_after          timestamptz default null,
  p_limit          int     default 25,
  p_offset         int     default 0
)
returns table (
  id           uuid,
  channel_id   uuid,
  channel_name text,
  space_id     uuid,
  thread_id    uuid,
  author_id    uuid,
  content      text,
  created_at   timestamptz,
  pinned       boolean,
  rank         real,
  total_count  bigint
)
language sql
stable
set search_path = ''
as $$
  with query_input as (
    select case
             when coalesce(trim(p_query), '') = '' then null
             else websearch_to_tsquery('french', public.immutable_unaccent(p_query))
           end as tsq
  ),
  matched as (
    select m.id,
           m.channel_id,
           c.name as channel_name,
           c.space_id,
           m.thread_id,
           m.author_id,
           m.content,
           m.created_at,
           m.pinned,
           case
             when q.tsq is null then 0::real
             else ts_rank_cd(m.search_vector, q.tsq, 32)
           end as base_rank
      from public.messages m
      join public.channels c on c.id = m.channel_id
      cross join query_input q
     where (q.tsq is null or m.search_vector @@ q.tsq)
       and (p_space_id is null or c.space_id = p_space_id)
       and (p_author_id is null or m.author_id = p_author_id)
       and (p_channel_id is null or m.channel_id = p_channel_id)
       and (not p_pinned_only or m.pinned)
       and (not p_has_attachment
            or exists (select 1 from public.attachments a where a.message_id = m.id))
       and (p_before is null or m.created_at < p_before)
       and (p_after is null or m.created_at > p_after)
  )
  select id,
         channel_id,
         channel_name,
         space_id,
         thread_id,
         author_id,
         content,
         created_at,
         pinned,
         -- Decroissance douce : un facteur 0.5 environ apres un an.
         -- L'alias evite `rank`, qui est aussi une fonction de fenetrage et
         -- rendrait le ORDER BY ambigu.
         (base_rank * (1.0 / (1.0 + extract(epoch from (now() - created_at)) / 31536000.0)))::real
           + base_rank as final_rank,
         count(*) over () as total_count
    from matched
   order by final_rank desc, created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ----------------------------------------------------------------------------
-- Amorcage
--
-- Un seul aller-retour rend toute l'interface affichable : espaces, salons,
-- membres, profils, fils ouverts et compteurs de non-lus. Sans cela le premier
-- rendu se ferait par morceaux, au rythme de six requetes en cascade.
-- ----------------------------------------------------------------------------

create or replace function public.bootstrap()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (
    select * from public.profiles where id = (select auth.uid())
  ),
  my_spaces as (
    select s.* from public.spaces s
     where public.is_space_member(s.id)
     order by s.created_at
  ),
  my_channels as (
    select c.* from public.channels c
     where c.space_id in (select id from my_spaces)
     order by c.position, c.created_at
  ),
  unread as (
    select c.id as channel_id,
           coalesce(rs.last_read_at, 'epoch'::timestamptz) as last_read_at,
           coalesce(rs.mention_count, 0) as mention_count,
           (select count(*)
              from public.messages m
             where m.channel_id = c.id
               and m.thread_id is null
               and m.author_id <> (select auth.uid())
               and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
           ) as unread_count
      from my_channels c
      left join public.read_states rs
        on rs.channel_id = c.id and rs.user_id = (select auth.uid())
     where c.kind = 'text'
  )
  select jsonb_build_object(
    'profile',    (select to_jsonb(me.*) from me),
    'spaces',     coalesce((select jsonb_agg(to_jsonb(s.*)) from my_spaces s), '[]'::jsonb),
    'channels',   coalesce((select jsonb_agg(to_jsonb(c.*)) from my_channels c), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(cat.*) order by cat.position)
        from public.categories cat
       where cat.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(sm.*))
        from public.space_members sm
       where sm.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p.*))
        from public.profiles p
       where p.id in (
         select sm.user_id from public.space_members sm
          where sm.space_id in (select id from my_spaces)
       )
    ), '[]'::jsonb),
    'open_threads', coalesce((
      select jsonb_agg(to_jsonb(t.*) order by t.last_activity_at desc)
        from public.threads t
       where t.space_id in (select id from my_spaces)
         and t.resolved = false
    ), '[]'::jsonb),
    'read_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id',    u.channel_id,
        'last_read_at',  u.last_read_at,
        'unread_count',  u.unread_count,
        'mention_count', u.mention_count
      )) from unread u
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Diffusion temps reel
--
-- Seules les tables dont un changement doit repeindre l'interface sont
-- publiees. Chaque table publiee a un cout permanent de replication, donc on
-- s'en tient au strict necessaire : la frappe en cours et la presence passent
-- par des canaux ephemeres, pas par la base.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

-- `ALTER PUBLICATION ... ADD TABLE` echoue si la table y figure deja : la
-- boucle garde le script rejouable sans erreur.
do $$
declare
  target text;
begin
  foreach target in array array['messages', 'reactions', 'threads', 'channels', 'profiles']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;

-- `old_record` complet lors des suppressions et modifications, sinon le client
-- ne recoit que la cle primaire et ne sait pas quel salon repeindre.
alter table public.messages  replica identity full;
alter table public.reactions replica identity full;
alter table public.threads   replica identity full;
