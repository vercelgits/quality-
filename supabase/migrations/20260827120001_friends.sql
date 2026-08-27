-- ============================================================================
-- Orbit — relations d'amitie
--
-- Une demande est dirigee : quelqu'un demande, quelqu'un repond. Une fois
-- acceptee, la relation devient symetrique mais la ligne reste unique — la
-- dupliquer dans les deux sens obligerait a les maintenir en accord, et une
-- desynchronisation donnerait un ami d'un cote seulement.
--
-- L'unicite porte donc sur la paire ordonnee (le plus petit identifiant
-- d'abord), ce qui empeche deux demandes croisees de coexister.
-- ============================================================================

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'blocked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,

  -- On ne devient pas son propre ami.
  constraint friendships_distinct check (requester_id <> addressee_id),

  -- Paire normalisee : le plus petit identifiant d'abord. L'index unique porte
  -- dessus, ce qui rend impossible une seconde demande en sens inverse.
  -- Remplie par le declencheur ci-dessous.
  pair_low  uuid,
  pair_high uuid
);

/**
 * Range la paire avant ecriture.
 *
 * Un declencheur plutot qu'une colonne generee : les deux conviendraient, mais
 * la colonne generee impose une expression immuable, condition qu'il vaut mieux
 * ne pas avoir a supposer.
 */
create or replace function public.normalise_friend_pair()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.pair_low  := least(new.requester_id, new.addressee_id);
  new.pair_high := greatest(new.requester_id, new.addressee_id);
  return new;
end;
$$;

drop trigger if exists friendships_normalise on public.friendships;
create trigger friendships_normalise
  before insert or update of requester_id, addressee_id on public.friendships
  for each row execute function public.normalise_friend_pair();

-- Rattrape les lignes deja presentes si la migration est rejouee apres coup.
update public.friendships
   set pair_low  = least(requester_id, addressee_id),
       pair_high = greatest(requester_id, addressee_id)
 where pair_low is null or pair_high is null;

create unique index if not exists friendships_pair_idx
  on public.friendships (pair_low, pair_high);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

-- ----------------------------------------------------------------------------
-- Lecture
-- ----------------------------------------------------------------------------

alter table public.friendships enable row level security;

-- On ne voit que les relations qui nous concernent.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or addressee_id = (select auth.uid())
  );

-- Aucune politique d'ecriture : tout passe par les fonctions ci-dessous, qui
-- verifient le sens de la relation et les blocages.

/** Vrai si les deux personnes sont amies. */
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and pair_low = least(p_a, p_b)
       and pair_high = greatest(p_a, p_b)
  )
$$;

/** Vrai si l'un des deux a bloque l'autre. */
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'blocked'
       and pair_low = least(p_a, p_b)
       and pair_high = greatest(p_a, p_b)
  )
$$;

-- ----------------------------------------------------------------------------
-- Demander
-- ----------------------------------------------------------------------------

/**
 * Envoie une demande a partir d'un pseudo.
 *
 * Le pseudo plutot que l'identifiant : c'est ce qu'on se communique de vive
 * voix, et cela evite d'exposer un annuaire d'identifiants.
 *
 * Si la personne nous a deja demande en ami, la demande est acceptee au lieu
 * d'echouer sur le doublon — c'est ce que l'on veut dans les deux cas.
 */
create or replace function public.send_friend_request(p_username text)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := (select auth.uid());
  target   public.profiles;
  existing public.friendships;
  created  public.friendships;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.profiles
   where username = lower(trim(p_username));

  if not found then
    raise exception 'Aucun compte ne porte ce pseudo.' using errcode = 'P0002';
  end if;

  if target.id = me then
    raise exception 'Vous ne pouvez pas vous ajouter vous-meme.' using errcode = '22023';
  end if;

  if public.recent_count('friendships', 'requester_id', interval '1 hour') >= 20 then
    raise exception 'Trop de demandes envoyees recemment. Reessayez plus tard.'
      using errcode = '53400';
  end if;

  select * into existing
    from public.friendships
   where pair_low = least(me, target.id)
     and pair_high = greatest(me, target.id);

  if found then
    if existing.status = 'accepted' then
      raise exception 'Vous etes deja amis.' using errcode = '23505';
    end if;
    if existing.status = 'blocked' then
      raise exception 'Cette demande ne peut pas aboutir.' using errcode = '42501';
    end if;

    -- Demande croisee : les deux se sont ajoutes, on conclut directement.
    if existing.addressee_id = me then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = existing.id
      returning * into created;
      return created;
    end if;

    raise exception 'Demande deja envoyee.' using errcode = '23505';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (me, target.id)
  returning * into created;

  return created;
end;
$$;

/** Accepte ou refuse une demande recue. */
create or replace function public.respond_friend_request(
  p_id     uuid,
  p_accept boolean
)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  target  public.friendships;
  updated public.friendships;
begin
  select * into target from public.friendships where id = p_id;

  if not found or target.addressee_id <> me or target.status <> 'pending' then
    raise exception 'Cette demande n''est plus disponible.' using errcode = 'P0002';
  end if;

  if not p_accept then
    delete from public.friendships where id = p_id;
    return target;
  end if;

  update public.friendships
     set status = 'accepted', responded_at = now()
   where id = p_id
  returning * into updated;

  return updated;
end;
$$;

/** Retire un ami, ou annule une demande envoyee. */
create or replace function public.remove_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  delete from public.friendships
   where pair_low = least(me, p_user_id)
     and pair_high = greatest(me, p_user_id)
     and status <> 'blocked';
end;
$$;

/**
 * Bloque quelqu'un.
 *
 * Le blocage remplace toute relation existante et retient qui l'a pose : sans
 * cette information, la personne bloquee pourrait lever le blocage elle-meme.
 */
create or replace function public.block_user(p_user_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  created public.friendships;
begin
  if me is null or p_user_id = me then
    raise exception 'Action impossible.' using errcode = '22023';
  end if;

  delete from public.friendships
   where pair_low = least(me, p_user_id)
     and pair_high = greatest(me, p_user_id);

  insert into public.friendships (requester_id, addressee_id, status, responded_at)
  values (me, p_user_id, 'blocked', now())
  returning * into created;

  return created;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  -- Seul l'auteur du blocage peut le lever.
  delete from public.friendships
   where status = 'blocked'
     and requester_id = me
     and addressee_id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Ecrire a un ami
--
-- On pouvait deja ecrire aux membres d'un espace commun. L'amitie devient une
-- seconde porte : sans cela, ajouter quelqu'un en ami ne servirait a rien.
-- ----------------------------------------------------------------------------

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

  if public.is_blocked_between(me, p_other_user_id) then
    raise exception 'Cette conversation ne peut pas etre ouverte.' using errcode = '42501';
  end if;

  if not public.shares_space_with(p_other_user_id)
     and not public.are_friends(me, p_other_user_id) then
    raise exception 'Ajoutez cette personne en ami, ou rejoignez un espace commun.'
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

-- ----------------------------------------------------------------------------
-- Charge utile
-- ----------------------------------------------------------------------------

/**
 * Amis, demandes en cours et personnes bloquees, avec leur profil.
 *
 * Une seule fonction plutot que trois requetes : la page des amis affiche les
 * trois listes en meme temps, et les profils sont communs aux trois.
 */
create or replace function public.friends_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  mine as (
    select f.*,
           case when f.requester_id = (select id from me)
                then f.addressee_id else f.requester_id end as other_id,
           f.requester_id = (select id from me) as outgoing
      from public.friendships f
     where f.requester_id = (select id from me)
        or f.addressee_id = (select id from me)
  )
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'since', m.responded_at))
        from mine m where m.status = 'accepted'
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'created_at', m.created_at))
        from mine m where m.status = 'pending' and not m.outgoing
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'created_at', m.created_at))
        from mine m where m.status = 'pending' and m.outgoing
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id))
        from mine m
       where m.status = 'blocked' and m.requester_id = (select id from me)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p))
        from public.profiles p
       where p.id in (select other_id from mine)
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Un ami est visible, meme sans espace commun
-- ----------------------------------------------------------------------------

create or replace function public.shares_space_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.space_members mine
      join public.space_members theirs on theirs.space_id = mine.space_id
     where mine.user_id = (select auth.uid())
       and theirs.user_id = p_user_id
  )
  -- Sans cette seconde condition, la politique de lecture des profils
  -- masquerait un ami tant qu'aucun espace n'est partage : son nom
  -- n'apparaitrait nulle part, pas meme dans la liste d'amis.
  or public.are_friends((select auth.uid()), p_user_id)
$$;

-- ----------------------------------------------------------------------------
-- Temps reel
-- ----------------------------------------------------------------------------

-- Sans cela, un evenement de suppression ne transporte que la cle primaire :
-- RLS ne peut pas evaluer la politique, et le client ne recoit rien.
alter table public.friendships replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end;
$$;
