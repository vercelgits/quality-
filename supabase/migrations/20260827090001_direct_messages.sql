-- ============================================================================
-- Orbit — messages prives et groupes
--
-- Choix d'architecture : une conversation privee est un salon sans espace,
-- pas une table separee.
--
-- L'alternative aurait ete un couple `conversations` / `conversation_messages`,
-- ce qui aurait oblige a dupliquer les reactions, les pieces jointes, les fils,
-- les etats de lecture, la recherche plein texte et toute la couche temps reel.
-- En rendant `channels.space_id` nullable, tout cela fonctionne sans une ligne
-- de plus, et l'interface n'a qu'un seul type de conversation a afficher.
--
-- Le prix a payer : les fonctions d'autorisation doivent desormais distinguer
-- deux cas. Elles sont regroupees ici pour que cette bifurcation reste visible
-- au meme endroit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Le salon peut ne plus appartenir a un espace
-- ----------------------------------------------------------------------------

alter table public.channels alter column space_id drop not null;

alter table public.channels drop constraint if exists channels_kind_check;
alter table public.channels
  add constraint channels_kind_check check (kind in ('text', 'voice', 'dm', 'group'));

-- Un salon appartient a un espace, ou bien est une conversation privee : jamais
-- les deux, jamais ni l'un ni l'autre.
alter table public.channels drop constraint if exists channels_space_or_dm;
alter table public.channels
  add constraint channels_space_or_dm check (
    (space_id is not null and kind in ('text', 'voice'))
    or (space_id is null and kind in ('dm', 'group'))
  );

-- Un fil ouvert dans une conversation privee n'a pas d'espace non plus.
alter table public.threads alter column space_id drop not null;

create table if not exists public.dm_participants (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  /** Masque la conversation de la liste sans en effacer l'historique. */
  hidden     boolean not null default false,
  primary key (channel_id, user_id)
);

create index if not exists dm_participants_user_idx
  on public.dm_participants (user_id) where hidden = false;

-- ----------------------------------------------------------------------------
-- Autorisations
-- ----------------------------------------------------------------------------

create or replace function public.is_dm_participant(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id
       and user_id = (select auth.uid())
  )
$$;

/**
 * Appartenance a un salon, quel que soit son type.
 *
 * Remplace la version qui ne connaissait que les espaces : sans cette
 * redefinition, aucune politique ne laisserait lire un message prive, puisque
 * la jointure vers `space_members` ne trouverait rien.
 */
create or replace function public.is_channel_member(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      left join public.space_members sm
        on sm.space_id = c.space_id and sm.user_id = (select auth.uid())
      left join public.dm_participants dp
        on dp.channel_id = c.id and dp.user_id = (select auth.uid())
     where c.id = p_channel_id
       and (sm.user_id is not null or dp.user_id is not null)
  )
$$;

create or replace function public.can_see_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m where m.id = p_message_id
  ) and public.is_channel_member(
    (select m.channel_id from public.messages m where m.id = p_message_id)
  )
$$;

-- Une conversation privee n'a ni moderation, ni verrou, ni mode lent : seule
-- l'appartenance compte.
create or replace function public.can_post_in_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  chan      public.channels;
  rank      int;
  last_post timestamptz;
begin
  if me is null then
    return false;
  end if;

  select * into chan from public.channels where id = p_channel_id;
  if not found then
    return false;
  end if;

  if chan.space_id is null then
    return public.is_dm_participant(p_channel_id);
  end if;

  rank := public.my_rank(chan.space_id);
  if rank < 0 then
    return false;
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = chan.space_id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.space_timeouts t
     where t.space_id = chan.space_id
       and t.user_id = me
       and t.expires_at > now()
  ) then
    return false;
  end if;

  if rank >= 1 then
    return true;
  end if;

  if chan.locked then
    return false;
  end if;

  if chan.slowmode_seconds > 0 then
    select max(created_at) into last_post
      from public.messages
     where channel_id = p_channel_id and author_id = me;

    if last_post is not null
       and last_post > now() - make_interval(secs => chan.slowmode_seconds) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- Politiques
-- ----------------------------------------------------------------------------

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select to authenticated
  using (
    (space_id is not null and public.is_space_member(space_id))
    or (space_id is null and public.is_dm_participant(id))
  );

-- L'ecriture d'un salon d'espace reste reservee aux administrateurs ; les
-- conversations privees sont creees par fonction, jamais directement.
drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (space_id is not null and public.can_manage_space(space_id))
  with check (space_id is not null and public.can_manage_space(space_id));

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads
  for update to authenticated
  using (public.is_channel_member(channel_id))
  with check (public.is_channel_member(channel_id));

alter table public.dm_participants enable row level security;

-- On voit les participants des conversations dont on fait partie.
drop policy if exists dm_participants_select on public.dm_participants;
create policy dm_participants_select on public.dm_participants
  for select to authenticated
  using (public.is_dm_participant(channel_id));

-- Chacun peut masquer sa propre conversation, rien d'autre.
drop policy if exists dm_participants_update on public.dm_participants;
create policy dm_participants_update on public.dm_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Ouvrir une conversation
-- ----------------------------------------------------------------------------

/**
 * Conversation a deux avec quelqu'un.
 *
 * Rouvre celle qui existe deja plutot que d'en creer une seconde : sans cette
 * recherche prealable, chaque clic sur un profil creerait un fil parallele et
 * l'historique se disperserait.
 */
create or replace function public.open_dm(p_other_user_id uuid)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := (select auth.uid());
  existing uuid;
  created  public.channels;
  other    public.profiles;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_other_user_id = me then
    raise exception 'On ne peut pas ouvrir une conversation avec soi-meme'
      using errcode = '22023';
  end if;

  select * into other from public.profiles where id = p_other_user_id;
  if not found then
    raise exception 'Cette personne n''existe pas' using errcode = 'P0002';
  end if;

  -- On n'ecrit qu'a des personnes avec qui on partage un espace : sans cette
  -- regle, n'importe qui pourrait envoyer un message a n'importe qui.
  if not public.shares_space_with(p_other_user_id) then
    raise exception 'Vous ne partagez aucun espace avec cette personne'
      using errcode = '42501';
  end if;

  select c.id into existing
    from public.channels c
    join public.dm_participants a on a.channel_id = c.id and a.user_id = me
    join public.dm_participants b on b.channel_id = c.id and b.user_id = p_other_user_id
   where c.kind = 'dm'
     and (select count(*) from public.dm_participants d where d.channel_id = c.id) = 2
   limit 1;

  if existing is not null then
    -- Rouvrir une conversation masquee la fait reapparaitre dans la liste.
    update public.dm_participants
       set hidden = false
     where channel_id = existing and user_id = me;

    select * into created from public.channels where id = existing;
    return created;
  end if;

  insert into public.channels (space_id, kind, name, position)
  values (null, 'dm', other.username, 0)
  returning * into created;

  insert into public.dm_participants (channel_id, user_id)
  values (created.id, me), (created.id, p_other_user_id);

  return created;
end;
$$;

/** Conversation de groupe, entre trois personnes et plus. */
create or replace function public.create_group_dm(p_user_ids uuid[], p_name text default null)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  target  uuid;
  members uuid[];
  created public.channels;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  members := array(select distinct unnest(p_user_ids) except select me);

  if array_length(members, 1) is null or array_length(members, 1) < 2 then
    raise exception 'Un groupe demande au moins deux autres personnes'
      using errcode = '22023';
  end if;
  if array_length(members, 1) > 9 then
    raise exception 'Neuf personnes au maximum, en plus de vous'
      using errcode = '22023';
  end if;

  foreach target in array members loop
    if not public.shares_space_with(target) then
      raise exception 'Vous ne partagez aucun espace avec l''une des personnes choisies'
        using errcode = '42501';
    end if;
  end loop;

  insert into public.channels (space_id, kind, name, position)
  values (null, 'group', coalesce(nullif(trim(p_name), ''), 'Groupe'), 0)
  returning * into created;

  insert into public.dm_participants (channel_id, user_id)
  select created.id, unnest(members || me);

  return created;
end;
$$;

/** Retire la conversation de sa liste sans effacer l'historique. */
create or replace function public.hide_dm(p_channel_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dm_participants
     set hidden = true
   where channel_id = p_channel_id
     and user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- Amorcage : les conversations privees rejoignent la charge utile
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
  my_dms as (
    select c.* from public.channels c
     join public.dm_participants dp
       on dp.channel_id = c.id
      and dp.user_id = (select auth.uid())
      and dp.hidden = false
     where c.space_id is null
  ),
  my_channels as (
    select c.* from public.channels c
     where c.space_id in (select id from my_spaces)
     union all
     select * from my_dms
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
     where c.kind <> 'voice'
  ),
  -- Toutes les personnes a connaitre : membres des espaces communs, et
  -- interlocuteurs des conversations privees.
  known_people as (
    select sm.user_id from public.space_members sm
     where sm.space_id in (select id from my_spaces)
    union
    select dp.user_id from public.dm_participants dp
     where dp.channel_id in (select id from my_dms)
  )
  select jsonb_build_object(
    'profile',    (select to_jsonb(me.*) from me),
    'spaces',     coalesce((select jsonb_agg(to_jsonb(s.*)) from my_spaces s), '[]'::jsonb),
    'channels',   coalesce((select jsonb_agg(to_jsonb(c.*)) from my_channels c), '[]'::jsonb),
    'dm_participants', coalesce((
      select jsonb_agg(to_jsonb(dp.*))
        from public.dm_participants dp
       where dp.channel_id in (select id from my_dms)
    ), '[]'::jsonb),
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
       where p.id in (select user_id from known_people)
    ), '[]'::jsonb),
    'open_threads', coalesce((
      select jsonb_agg(to_jsonb(t.*) order by t.last_activity_at desc)
        from public.threads t
       where t.channel_id in (select id from my_channels)
         and t.resolved = false
    ), '[]'::jsonb),
    'read_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id',    u.channel_id,
        'last_read_at',  u.last_read_at,
        'unread_count',  u.unread_count,
        'mention_count', u.mention_count
      )) from unread u
    ), '[]'::jsonb),
    'ranks', coalesce((
      select jsonb_object_agg(s.id::text, public.my_rank(s.id)) from my_spaces s
    ), '{}'::jsonb),
    'timeouts', coalesce((
      select jsonb_agg(to_jsonb(t.*))
        from public.space_timeouts t
       where t.user_id = (select auth.uid())
         and t.expires_at > now()
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b.*) order by b.created_at desc)
        from public.bookmarks b
       where b.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Recherche : elle doit couvrir les conversations privees
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
       -- Sans filtre d'espace, la recherche couvre aussi les conversations
       -- privees ; avec un filtre, elle s'y limite strictement.
       and (p_space_id is null or c.space_id = p_space_id)
       and (p_author_id is null or m.author_id = p_author_id)
       and (p_channel_id is null or m.channel_id = p_channel_id)
       and (not p_pinned_only or m.pinned)
       and (not p_has_attachment
            or exists (select 1 from public.attachments a where a.message_id = m.id))
       and (p_before is null or m.created_at < p_before)
       and (p_after is null or m.created_at > p_after)
  )
  select id, channel_id, channel_name, space_id, thread_id, author_id, content,
         created_at, pinned,
         (base_rank * (1.0 / (1.0 + extract(epoch from (now() - created_at)) / 31536000.0)))::real
           + base_rank as final_rank,
         count(*) over () as total_count
    from matched
   order by final_rank desc, created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ----------------------------------------------------------------------------
-- Temps reel
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'dm_participants'
  ) then
    alter publication supabase_realtime add table public.dm_participants;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Mentions dans les conversations privees
--
-- La version precedente resolvait les personnes citees via `space_members`.
-- Dans un salon sans espace cette jointure ne renvoie rien, donc une mention
-- en message prive n'incrementait aucun compteur et ne declenchait aucune
-- notification. On distingue desormais les deux cas.
-- ----------------------------------------------------------------------------

create or replace function public.register_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned    text[];
  target_space uuid;
begin
  mentioned := array(
    select distinct lower(m[1])
    from regexp_matches(new.content, '@([a-zA-Z0-9_.-]{2,32})', 'g') as m
  );

  if array_length(mentioned, 1) is null then
    return new;
  end if;

  select space_id into target_space from public.channels where id = new.channel_id;

  if target_space is null then
    -- Conversation privee : les destinataires sont les participants.
    insert into public.read_states (user_id, channel_id, mention_count)
    select dp.user_id, new.channel_id, 1
      from public.dm_participants dp
      join public.profiles p on p.id = dp.user_id
     where dp.channel_id = new.channel_id
       and dp.user_id <> new.author_id
       and (mentioned && array['everyone', 'here', 'tous'] or p.username = any(mentioned))
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;

    return new;
  end if;

  if mentioned && array['everyone', 'here', 'tous'] then
    insert into public.read_states (user_id, channel_id, mention_count)
    select sm.user_id, new.channel_id, 1
      from public.space_members sm
     where sm.space_id = target_space
       and sm.user_id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  else
    insert into public.read_states (user_id, channel_id, mention_count)
    select p.id, new.channel_id, 1
      from public.profiles p
      join public.space_members sm
        on sm.user_id = p.id and sm.space_id = target_space
     where p.username = any(mentioned)
       and p.id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  end if;

  return new;
end;
$$;
