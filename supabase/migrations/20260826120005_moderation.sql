-- ============================================================================
-- Orbit — moderation
--
-- Quatre rangs, du plus fort au plus faible : owner, admin, moderator, member.
--
-- Regle qui gouverne tout ce fichier : on n'agit jamais sur quelqu'un d'un rang
-- superieur ou egal au sien. Sans cette regle, deux moderateurs pourraient
-- s'exclure mutuellement, et un moderateur pourrait bannir le proprietaire de
-- son propre espace. La comparaison passe par `role_rank()`, seule source de
-- verite sur la hierarchie.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Le rang moderateur
-- ----------------------------------------------------------------------------

alter table public.space_members
  drop constraint if exists space_members_role_check;

alter table public.space_members
  add constraint space_members_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

create or replace function public.role_rank(role_name text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case role_name
           when 'owner'     then 3
           when 'admin'     then 2
           when 'moderator' then 1
           else 0
         end
$$;

create or replace function public.my_rank(p_space_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.role_rank(role)
       from public.space_members
      where space_id = p_space_id and user_id = (select auth.uid())),
    -1
  )
$$;

-- Peut moderer : moderateur ou au-dessus.
create or replace function public.can_moderate_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_rank(p_space_id) >= 1
$$;

-- ----------------------------------------------------------------------------
-- Sanctions
-- ----------------------------------------------------------------------------

create table if not exists public.space_bans (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  banned_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Null vaut bannissement definitif ; une date rend la sanction temporaire.
  expires_at timestamptz,
  primary key (space_id, user_id)
);

create index if not exists space_bans_user_idx on public.space_bans (user_id);

-- Exclusion temporaire de la parole : la personne reste membre et continue de
-- lire, mais ne peut plus ecrire. C'est la sanction la plus utile au quotidien,
-- et la seule qui ne detruit rien.
create table if not exists public.space_timeouts (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  issued_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (space_id, user_id)
);

create index if not exists space_timeouts_expiry_idx
  on public.space_timeouts (space_id, expires_at);

-- Mode lent : intervalle minimal entre deux messages d'une meme personne.
alter table public.channels
  add column if not exists slowmode_seconds int not null default 0
  check (slowmode_seconds between 0 and 21600);

-- Salon verrouille : plus personne n'ecrit, sauf l'equipe de moderation.
alter table public.channels
  add column if not exists locked boolean not null default false;

-- ----------------------------------------------------------------------------
-- Journal et signalements
-- ----------------------------------------------------------------------------

create table if not exists public.moderation_log (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  target_id  uuid references public.profiles(id) on delete set null,
  action     text not null,
  reason     text check (char_length(reason) <= 500),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_log_space_idx
  on public.moderation_log (space_id, created_at desc);

create table if not exists public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'open'
                check (status in ('open', 'resolved', 'dismissed')),
  handled_by  uuid references public.profiles(id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- Un signalement par personne et par message : au-dela, c'est du bruit.
  unique (message_id, reporter_id)
);

create index if not exists message_reports_open_idx
  on public.message_reports (space_id, created_at desc) where status = 'open';

-- ----------------------------------------------------------------------------
-- Droit d'ecrire
-- ----------------------------------------------------------------------------

/**
 * Reunit toutes les conditions pour publier dans un salon : appartenance,
 * absence de bannissement, absence d'exclusion de parole, salon deverrouille,
 * et respect du mode lent.
 *
 * La verification vit dans la base et non dans le client, parce qu'un client
 * peut toujours etre contourne : sans cette fonction, une personne exclue
 * pourrait continuer a publier avec une simple requete directe.
 */
create or replace function public.can_post_in_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me         uuid := (select auth.uid());
  chan       public.channels;
  rank       int;
  last_post  timestamptz;
begin
  if me is null then
    return false;
  end if;

  select * into chan from public.channels where id = p_channel_id;
  if not found then
    return false;
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

  -- Verrou et mode lent ne s'appliquent pas a l'equipe de moderation, qui doit
  -- pouvoir intervenir precisement quand un salon est verrouille.
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

-- La politique d'insertion des messages tient compte des sanctions.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_post_in_channel(channel_id)
  );

-- La suppression revient a l'auteur ou a l'equipe de moderation.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.channels c
       where c.id = channel_id and public.can_moderate_space(c.space_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Actions de moderation
-- ----------------------------------------------------------------------------

/** Refuse l'action si l'acteur ne domine pas strictement sa cible. */
create or replace function public.assert_outranks(p_space_id uuid, p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  mine   int := public.my_rank(p_space_id);
  theirs int;
begin
  if mine < 1 then
    raise exception 'Action reservee a l''equipe de moderation'
      using errcode = '42501';
  end if;

  if p_target = (select auth.uid()) then
    raise exception 'On ne peut pas appliquer cette action a soi-meme'
      using errcode = '42501';
  end if;

  select coalesce(public.role_rank(role), -1) into theirs
    from public.space_members
   where space_id = p_space_id and user_id = p_target;

  if theirs is null then
    theirs := -1;
  end if;

  if theirs >= mine then
    raise exception 'Cette personne a un rang egal ou superieur au votre'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.log_moderation(
  p_space_id uuid,
  p_target   uuid,
  p_action   text,
  p_reason   text default null,
  p_details  jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_log (space_id, actor_id, target_id, action, reason, details)
  values (p_space_id, (select auth.uid()), p_target, p_action, p_reason, p_details);
$$;

/** Change le rang d'un membre. Seul le proprietaire nomme des administrateurs. */
create or replace function public.set_member_role(
  p_space_id uuid,
  p_user_id  uuid,
  p_role     text
)
returns public.space_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine    int := public.my_rank(p_space_id);
  wanted  int := public.role_rank(p_role);
  updated public.space_members;
begin
  if p_role not in ('admin', 'moderator', 'member') then
    raise exception 'Rang inconnu ou non attribuable' using errcode = '22023';
  end if;

  perform public.assert_outranks(p_space_id, p_user_id);

  -- On ne peut pas nommer quelqu'un a un rang que l'on n'a pas soi-meme
  -- depasse : un administrateur ne fabrique donc pas un autre administrateur.
  if wanted >= mine then
    raise exception 'Vous ne pouvez pas attribuer un rang egal ou superieur au votre'
      using errcode = '42501';
  end if;

  update public.space_members
     set role = p_role
   where space_id = p_space_id and user_id = p_user_id
  returning * into updated;

  if not found then
    raise exception 'Cette personne n''est pas membre de l''espace' using errcode = 'P0002';
  end if;

  perform public.log_moderation(
    p_space_id, p_user_id, 'role_change', null, jsonb_build_object('role', p_role)
  );

  return updated;
end;
$$;

/** Exclut sans bannir : la personne peut revenir avec une nouvelle invitation. */
create or replace function public.kick_member(
  p_space_id uuid,
  p_user_id  uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  delete from public.space_members
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'kick', p_reason);
end;
$$;

/** Bannit, definitivement ou jusqu'a une date. */
create or replace function public.ban_member(
  p_space_id   uuid,
  p_user_id    uuid,
  p_reason     text default null,
  p_expires_at timestamptz default null
)
returns public.space_bans
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.space_bans;
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  insert into public.space_bans (space_id, user_id, reason, banned_by, expires_at)
  values (p_space_id, p_user_id, p_reason, (select auth.uid()), p_expires_at)
  on conflict (space_id, user_id) do update
    set reason = excluded.reason,
        banned_by = excluded.banned_by,
        expires_at = excluded.expires_at,
        created_at = now()
  returning * into created;

  -- Bannir implique de sortir de l'espace, sinon la personne resterait listee
  -- parmi les membres sans pouvoir rien faire.
  delete from public.space_members
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(
    p_space_id, p_user_id, 'ban', p_reason,
    jsonb_build_object('expires_at', p_expires_at)
  );

  return created;
end;
$$;

create or replace function public.unban_member(p_space_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_moderate_space(p_space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  delete from public.space_bans
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'unban');
end;
$$;

/** Retire la parole pour une duree donnee, en minutes. */
create or replace function public.timeout_member(
  p_space_id uuid,
  p_user_id  uuid,
  p_minutes  int,
  p_reason   text default null
)
returns public.space_timeouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.space_timeouts;
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  if p_minutes is null or p_minutes < 1 or p_minutes > 40320 then
    raise exception 'La duree doit tenir entre 1 minute et 28 jours'
      using errcode = '22023';
  end if;

  insert into public.space_timeouts (space_id, user_id, reason, issued_by, expires_at)
  values (p_space_id, p_user_id, p_reason, (select auth.uid()),
          now() + make_interval(mins => p_minutes))
  on conflict (space_id, user_id) do update
    set reason = excluded.reason,
        issued_by = excluded.issued_by,
        expires_at = excluded.expires_at,
        created_at = now()
  returning * into created;

  perform public.log_moderation(
    p_space_id, p_user_id, 'timeout', p_reason,
    jsonb_build_object('minutes', p_minutes)
  );

  return created;
end;
$$;

create or replace function public.clear_timeout(p_space_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_moderate_space(p_space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  delete from public.space_timeouts
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'timeout_cleared');
end;
$$;

/** Verrouille ou deverrouille un salon, et regle son mode lent. */
create or replace function public.set_channel_moderation(
  p_channel_id uuid,
  p_locked     boolean default null,
  p_slowmode   int default null
)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan    public.channels;
  updated public.channels;
begin
  select * into chan from public.channels where id = p_channel_id;
  if not found then
    raise exception 'Salon introuvable' using errcode = 'P0002';
  end if;

  if not public.can_moderate_space(chan.space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  update public.channels
     set locked = coalesce(p_locked, locked),
         slowmode_seconds = coalesce(p_slowmode, slowmode_seconds)
   where id = p_channel_id
  returning * into updated;

  perform public.log_moderation(
    chan.space_id, null, 'channel_moderation', null,
    jsonb_build_object(
      'channel_id', p_channel_id,
      'locked', updated.locked,
      'slowmode', updated.slowmode_seconds
    )
  );

  return updated;
end;
$$;

/** Supprime un message au titre de la moderation, en gardant une trace. */
create or replace function public.moderate_delete_message(
  p_message_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target   public.messages;
  space    uuid;
begin
  select * into target from public.messages where id = p_message_id;
  if not found then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select space_id into space from public.channels where id = target.channel_id;

  if not public.can_moderate_space(space) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  -- Le contenu est copie dans le journal avant suppression : sans cela, la
  -- trace ne dirait pas ce qui a ete retire, et serait inexploitable en cas de
  -- contestation.
  perform public.log_moderation(
    space, target.author_id, 'message_delete', p_reason,
    jsonb_build_object(
      'channel_id', target.channel_id,
      'content', left(target.content, 500),
      'sent_at', target.created_at
    )
  );

  delete from public.messages where id = p_message_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Signalements
-- ----------------------------------------------------------------------------

create or replace function public.report_message(p_message_id uuid, p_reason text)
returns public.message_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  space   uuid;
  created public.message_reports;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select c.space_id into space
    from public.messages m
    join public.channels c on c.id = m.channel_id
   where m.id = p_message_id;

  insert into public.message_reports (message_id, space_id, reporter_id, reason)
  values (p_message_id, space, (select auth.uid()), p_reason)
  on conflict (message_id, reporter_id) do update set reason = excluded.reason
  returning * into created;

  return created;
end;
$$;

create or replace function public.resolve_report(p_report_id uuid, p_status text)
returns public.message_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  target  public.message_reports;
  updated public.message_reports;
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Statut invalide' using errcode = '22023';
  end if;

  select * into target from public.message_reports where id = p_report_id;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  if not public.can_moderate_space(target.space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  update public.message_reports
     set status = p_status,
         handled_by = (select auth.uid()),
         handled_at = now()
   where id = p_report_id
  returning * into updated;

  return updated;
end;
$$;

-- ----------------------------------------------------------------------------
-- Un espace ne se rejoint pas quand on en a ete banni
-- ----------------------------------------------------------------------------

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

  if exists (
    select 1 from public.space_bans b
     where b.space_id = target.id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    raise exception 'Vous ne pouvez pas rejoindre cet espace' using errcode = '42501';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- ----------------------------------------------------------------------------
-- Securite des nouvelles tables
-- ----------------------------------------------------------------------------

alter table public.space_bans      enable row level security;
alter table public.space_timeouts  enable row level security;
alter table public.moderation_log  enable row level security;
alter table public.message_reports enable row level security;

-- Les bannissements ne sont visibles que par l'equipe de moderation.
drop policy if exists bans_read on public.space_bans;
create policy bans_read on public.space_bans
  for select to authenticated
  using (public.can_moderate_space(space_id));

-- Chacun doit pouvoir constater qu'il est reduit au silence, et jusqu'a quand.
drop policy if exists timeouts_read on public.space_timeouts;
create policy timeouts_read on public.space_timeouts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_moderate_space(space_id)
  );

drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select to authenticated
  using (public.can_moderate_space(space_id));

-- Un signalement est lisible par son auteur et par l'equipe de moderation,
-- jamais par la personne signalee.
drop policy if exists reports_read on public.message_reports;
create policy reports_read on public.message_reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or public.can_moderate_space(space_id)
  );

-- Aucune politique d'ecriture : bans, exclusions, journal et signalements ne se
-- modifient que par les fonctions ci-dessus, qui verifient la hierarchie.

-- ----------------------------------------------------------------------------
-- Diffusion temps reel des nouvelles tables
-- ----------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['space_members', 'space_timeouts', 'message_reports']
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
