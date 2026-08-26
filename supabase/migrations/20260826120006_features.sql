-- ============================================================================
-- Orbit — sondages, messages sauvegardes, historique des modifications
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sondages
--
-- Attaches a un message plutot qu'a un type de message a part : un sondage
-- s'epingle, se cite, se cherche et vit dans un fil comme n'importe quel autre
-- message, sans code d'affichage separe.
-- ----------------------------------------------------------------------------

create table if not exists public.polls (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null unique references public.messages(id) on delete cascade,
  question     text not null check (char_length(question) between 1 and 300),
  -- Un sondage a choix multiple accepte plusieurs reponses par personne.
  multi_choice boolean not null default false,
  -- Masque les resultats jusqu'a la cloture, pour ne pas influencer les votes.
  hide_results boolean not null default false,
  closes_at    timestamptz,
  closed       boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls(id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 120),
  position int not null default 0
);

create index if not exists poll_options_poll_idx on public.poll_options (poll_id, position);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);

/** Vrai si le sondage n'accepte plus de vote. */
create or replace function public.poll_is_closed(p_poll public.polls)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select p_poll.closed
      or (p_poll.closes_at is not null and p_poll.closes_at <= now())
$$;

create or replace function public.create_poll(
  p_message_id   uuid,
  p_question     text,
  p_options      text[],
  p_multi_choice boolean default false,
  p_hide_results boolean default false,
  p_closes_at    timestamptz default null
)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  created public.polls;
  label   text;
  index   int := 0;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.messages where id = p_message_id and author_id = me
  ) then
    raise exception 'Un sondage ne s''attache qu''a son propre message'
      using errcode = '42501';
  end if;

  if array_length(p_options, 1) is null or array_length(p_options, 1) < 2 then
    raise exception 'Un sondage demande au moins deux reponses' using errcode = '22023';
  end if;

  if array_length(p_options, 1) > 12 then
    raise exception 'Douze reponses au maximum' using errcode = '22023';
  end if;

  insert into public.polls (message_id, question, multi_choice, hide_results, closes_at, created_by)
  values (p_message_id, p_question, p_multi_choice, p_hide_results, p_closes_at, me)
  returning * into created;

  foreach label in array p_options loop
    if char_length(trim(label)) > 0 then
      insert into public.poll_options (poll_id, label, position)
      values (created.id, trim(label), index);
      index := index + 1;
    end if;
  end loop;

  return created;
end;
$$;

create or replace function public.cast_vote(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  poll   public.polls;
  target public.poll_options;
begin
  select * into target from public.poll_options where id = p_option_id;
  if not found then
    raise exception 'Reponse introuvable' using errcode = 'P0002';
  end if;

  select * into poll from public.polls where id = target.poll_id;

  if not public.can_see_message(poll.message_id) then
    raise exception 'Sondage introuvable' using errcode = 'P0002';
  end if;

  if public.poll_is_closed(poll) then
    raise exception 'Ce sondage est clos' using errcode = '22023';
  end if;

  -- Un second clic sur la meme reponse retire le vote : c'est le geste que
  -- tout le monde tente, autant qu'il fasse ce qu'on attend.
  if exists (
    select 1 from public.poll_votes
     where option_id = p_option_id and user_id = me
  ) then
    delete from public.poll_votes where option_id = p_option_id and user_id = me;
    return;
  end if;

  -- En choix unique, voter ailleurs deplace le vote au lieu d'en ajouter un.
  if not poll.multi_choice then
    delete from public.poll_votes where poll_id = poll.id and user_id = me;
  end if;

  insert into public.poll_votes (poll_id, option_id, user_id)
  values (poll.id, p_option_id, me)
  on conflict do nothing;
end;
$$;

create or replace function public.close_poll(p_poll_id uuid)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll    public.polls;
  space   uuid;
  updated public.polls;
begin
  select * into poll from public.polls where id = p_poll_id;
  if not found then
    raise exception 'Sondage introuvable' using errcode = 'P0002';
  end if;

  select c.space_id into space
    from public.messages m
    join public.channels c on c.id = m.channel_id
   where m.id = poll.message_id;

  if poll.created_by <> (select auth.uid()) and not public.can_moderate_space(space) then
    raise exception 'Seul l''auteur ou l''equipe de moderation peut clore un sondage'
      using errcode = '42501';
  end if;

  update public.polls set closed = true where id = p_poll_id returning * into updated;
  return updated;
end;
$$;

/**
 * Resultats d'un sondage.
 *
 * Tant que les resultats sont masques et le sondage ouvert, les decomptes sont
 * renvoyes a zero pour tout le monde sauf pour son auteur. Filtrer cote client
 * ne servirait a rien : les chiffres auraient deja quitte le serveur.
 */
create or replace function public.poll_results(p_poll_id uuid)
-- `position` est un mot-cle de Postgres : accepte comme nom de colonne dans un
-- CREATE TABLE, mais refuse comme nom de parametre de sortie ici. D'ou le
-- prefixe, qui evite d'avoir a le mettre entre guillemets partout.
returns table (
  option_id       uuid,
  label           text,
  option_position int,
  votes           bigint,
  voted           boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with poll as (
    select * from public.polls where id = p_poll_id
  ),
  visible as (
    select (not p.hide_results)
        or public.poll_is_closed(p)
        or p.created_by = (select auth.uid()) as show_counts
      from poll p
  )
  select o.id,
         o.label,
         o.position,
         case when v.show_counts
              then (select count(*) from public.poll_votes pv where pv.option_id = o.id)
              else 0::bigint
         end,
         exists (
           select 1 from public.poll_votes pv
            where pv.option_id = o.id and pv.user_id = (select auth.uid())
         )
    from public.poll_options o
    cross join visible v
   where o.poll_id = p_poll_id
   order by o.position;
$$;

-- ----------------------------------------------------------------------------
-- Messages sauvegardes
--
-- Discord n'offre que l'epinglage, qui est collectif : impossible de mettre un
-- message de cote pour soi. C'est pourtant le geste le plus courant.
-- ----------------------------------------------------------------------------

create table if not exists public.bookmarks (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  note       text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Historique des modifications
--
-- Discord affiche « modifie » sans jamais dire ce qui a change. Conserver les
-- versions precedentes rend la correction honnete : on voit qu'un message a
-- ete reecrit, et en quoi.
-- ----------------------------------------------------------------------------

create table if not exists public.message_edits (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  previous     text not null,
  edited_at    timestamptz not null default now()
);

create index if not exists message_edits_message_idx
  on public.message_edits (message_id, edited_at desc);

create or replace function public.record_message_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    insert into public.message_edits (message_id, previous, edited_at)
    values (old.id, old.content, now());
  end if;
  return new;
end;
$$;

drop trigger if exists messages_record_edit on public.messages;
create trigger messages_record_edit
  after update of content on public.messages
  for each row execute function public.record_message_edit();

-- ----------------------------------------------------------------------------
-- Securite
-- ----------------------------------------------------------------------------

alter table public.polls         enable row level security;
alter table public.poll_options  enable row level security;
alter table public.poll_votes    enable row level security;
alter table public.bookmarks     enable row level security;
alter table public.message_edits enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options
  for select to authenticated
  using (
    exists (
      select 1 from public.polls p
       where p.id = poll_id and public.can_see_message(p.message_id)
    )
  );

-- Les votes bruts ne sont jamais exposes : seul `poll_results` les agrege, ce
-- qui empeche de savoir qui a vote quoi dans un sondage a resultats masques.
drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists bookmarks_own on public.bookmarks;
create policy bookmarks_own on public.bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists message_edits_read on public.message_edits;
create policy message_edits_read on public.message_edits
  for select to authenticated
  using (public.can_see_message(message_id));

-- ----------------------------------------------------------------------------
-- Amorcage enrichi
--
-- Le client a besoin de connaitre son propre rang et ses sanctions eventuelles
-- pour afficher les bons outils. Sans cela, l'interface montrerait des boutons
-- de moderation que la base refuserait ensuite.
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
    ), '[]'::jsonb),
    -- Rang par espace, pour n'afficher que les outils reellement utilisables.
    'ranks', coalesce((
      select jsonb_object_agg(s.id::text, public.my_rank(s.id)) from my_spaces s
    ), '{}'::jsonb),
    -- Exclusions de parole en cours, pour expliquer un compositeur desactive.
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
-- Diffusion temps reel
-- ----------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['polls', 'poll_votes']
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
