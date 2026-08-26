-- ===========================================================================
-- Orbit - schema complet, genere par concatenation des migrations.
-- A coller tel quel dans l'editeur SQL de Supabase si vous n'utilisez pas
-- la CLI. Le script est idempotent : le rejouer ne casse rien.
-- ===========================================================================


-- >>> 20260826120001_schema.sql

-- ============================================================================
-- Orbit — schema de base
--
-- Vocabulaire : ce que Discord appelle un "serveur" s'appelle ici un "space".
-- Cela evite la confusion permanente entre le serveur d'infrastructure et la
-- communaute.
--
-- Toutes les tables vivent dans `public` et sont protegees par RLS, activee
-- dans la migration suivante. Aucune table n'est lisible sans politique.
-- ============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- `unaccent` est marquee STABLE et non IMMUTABLE parce qu'elle depend d'un
-- dictionnaire modifiable. En figeant le dictionnaire dans l'appel, la fonction
-- redevient deterministe, ce qui autorise son usage dans une colonne generee.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- Vecteur de recherche : la configuration `french` apporte la racinisation et
-- les mots vides francais, `immutable_unaccent` rend "cafe" et "café"
-- equivalents. Sans cela, une recherche accentuee ne trouverait jamais sa
-- version non accentuee, ce qui est redhibitoire en francais.
create or replace function public.message_search_vector(content text)
returns tsvector
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select to_tsvector('french', public.immutable_unaccent(content))
$$;

-- Couleur d'accent deterministe, pour que chaque personne et chaque espace ait
-- une identite visuelle stable sans avoir a televerser d'image.
create or replace function public.accent_for(seed uuid)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (array[
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
  ])[1 + (abs(hashtext(seed::text)) % 10)]
$$;

create or replace function public.slugify(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(lower(public.immutable_unaccent(input)), '[^a-z0-9]+', '-', 'g')
      ),
      ''
    ),
    'space'
  )
$$;

-- ----------------------------------------------------------------------------
-- Profils
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique
                  check (username ~ '^[a-z0-9_.-]{2,32}$'),
  display_name  text not null
                  check (char_length(display_name) between 1 and 48),
  accent        text not null default '#6366f1',
  avatar_url    text,
  bio           text check (char_length(bio) <= 280),
  status        text not null default 'offline'
                  check (status in ('online', 'idle', 'dnd', 'offline')),
  custom_status text check (char_length(custom_status) <= 128),
  created_at    timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (username);
-- Recherche approximative pour l'autocompletion des mentions.
create index if not exists profiles_display_name_idx
  on public.profiles using gin (public.immutable_unaccent(display_name) extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

create table if not exists public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 64),
  slug        text not null unique,
  description text check (char_length(description) <= 280),
  icon_url    text,
  accent      text not null default '#6366f1',
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  -- Code d'invitation : rejoindre un espace passe uniquement par ce code, via
  -- une fonction dediee. Connaitre l'identifiant d'un espace ne suffit pas.
  --
  -- Le code derive de gen_random_uuid(), qui appartient au coeur de Postgres.
  -- gen_random_bytes() aurait ete plus direct mais vient de pgcrypto, dont le
  -- schema d'installation varie : la valeur par defaut aurait pu ne pas se
  -- resoudre selon le search_path applique a la migration.
  invite_code text not null unique
                default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at  timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  nickname  text check (char_length(nickname) <= 48),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists space_members_user_idx on public.space_members (user_id);

-- ----------------------------------------------------------------------------
-- Categories et salons
-- ----------------------------------------------------------------------------

create table if not exists public.categories (
  id       uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 64),
  position int not null default 0
);

create index if not exists categories_space_idx on public.categories (space_id, position);

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  kind        text not null default 'text' check (kind in ('text', 'voice')),
  name        text not null check (char_length(name) between 1 and 48),
  topic       text check (char_length(topic) <= 512),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists channels_space_idx on public.channels (space_id, position);

-- ----------------------------------------------------------------------------
-- Fils de discussion
--
-- Amelioration nette par rapport a Discord : un fil porte un statut explicite
-- (ouvert / resolu). Tant qu'il est ouvert il remonte dans une barre laterale
-- dediee, donc une question posee dans un salon actif ne se perd plus dans
-- l'historique.
-- ----------------------------------------------------------------------------

create table if not exists public.threads (
  id               uuid primary key default gen_random_uuid(),
  channel_id       uuid not null references public.channels(id) on delete cascade,
  space_id         uuid not null references public.spaces(id) on delete cascade,
  root_message_id  uuid not null unique,
  title            text not null check (char_length(title) between 1 and 120),
  created_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  resolved         boolean not null default false,
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz
);

create index if not exists threads_channel_idx
  on public.threads (channel_id, last_activity_at desc);
create index if not exists threads_space_open_idx
  on public.threads (space_id, last_activity_at desc) where resolved = false;

create table if not exists public.thread_participants (
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (thread_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels(id) on delete cascade,
  thread_id   uuid references public.threads(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(content) <= 4000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  reply_to_id uuid references public.messages(id) on delete set null,
  pinned      boolean not null default false,
  search_vector tsvector
    generated always as (public.message_search_vector(content)) stored
);

-- La cle de tri (created_at, id) est aussi la cle de pagination par curseur :
-- `where (created_at, id) < (?, ?)` se resout par un simple parcours d'index,
-- sans OFFSET qui devient lineaire sur un historique long.
create index if not exists messages_channel_idx
  on public.messages (channel_id, created_at desc, id desc)
  where thread_id is null;
create index if not exists messages_thread_idx
  on public.messages (thread_id, created_at, id) where thread_id is not null;
create index if not exists messages_author_idx on public.messages (author_id);
create index if not exists messages_pinned_idx
  on public.messages (channel_id, created_at desc) where pinned = true;
create index if not exists messages_search_idx
  on public.messages using gin (search_vector);

-- La contrainte d'unicite sur threads.root_message_id est posee ici, une fois
-- la table messages connue.
alter table public.threads
  drop constraint if exists threads_root_message_fk;
alter table public.threads
  add constraint threads_root_message_fk
  foreign key (root_message_id) references public.messages(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- Pieces jointes et reactions
-- ----------------------------------------------------------------------------

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  content_type text not null,
  size         bigint not null check (size >= 0),
  width        int,
  height       int
);

create index if not exists attachments_message_idx on public.attachments (message_id);

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists reactions_message_idx on public.reactions (message_id);

-- ----------------------------------------------------------------------------
-- Etats de lecture
-- ----------------------------------------------------------------------------

create table if not exists public.read_states (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  channel_id    uuid not null references public.channels(id) on delete cascade,
  last_read_at  timestamptz not null default 'epoch',
  mention_count int not null default 0 check (mention_count >= 0),
  primary key (user_id, channel_id)
);

-- ----------------------------------------------------------------------------
-- Declencheurs
-- ----------------------------------------------------------------------------

-- Un fil remonte en tete de liste des qu'il recoit une reponse.
create or replace function public.touch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thread_id is not null then
    update public.threads
       set last_activity_at = new.created_at
     where id = new.thread_id;

    insert into public.thread_participants (thread_id, user_id)
    values (new.thread_id, new.author_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_touch_thread on public.messages;
create trigger messages_touch_thread
  after insert on public.messages
  for each row execute function public.touch_thread();

-- Marque `edited_at` uniquement quand le contenu change reellement, pour ne pas
-- afficher "modifie" apres un simple epinglage.
create or replace function public.mark_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_mark_edited on public.messages;
create trigger messages_mark_edited
  before update on public.messages
  for each row execute function public.mark_edited();

-- Incremente le compteur de mentions des personnes citees. L'auteur n'est
-- jamais notifie de sa propre mention.
create or replace function public.register_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned text[];
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

drop trigger if exists messages_register_mentions on public.messages;
create trigger messages_register_mentions
  after insert on public.messages
  for each row execute function public.register_mentions();

-- ----------------------------------------------------------------------------
-- Creation du profil a l'inscription
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted   text;
  candidate text;
  suffix   int := 0;
  new_space uuid;
begin
  -- Un pseudo valide est derive des metadonnees d'inscription, sinon de la
  -- partie locale de l'adresse e-mail.
  wanted := lower(regexp_replace(
    coalesce(
      new.raw_user_meta_data ->> 'username',
      split_part(coalesce(new.email, ''), '@', 1),
      'membre'
    ),
    '[^a-zA-Z0-9_.-]', '', 'g'
  ));

  if wanted is null or char_length(wanted) < 2 then
    wanted := 'membre';
  end if;
  wanted := left(wanted, 28);

  candidate := wanted;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := wanted || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name, accent)
  values (
    new.id,
    candidate,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate),
    public.accent_for(new.id)
  );

  -- Un compte tout neuf arrive dans un espace deja utilisable plutot que
  -- devant un ecran vide.
  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || candidate,
    public.slugify(candidate) || '-' || substr(new.id::text, 1, 4),
    'Votre premier espace. Renommez-le et invitez du monde.',
    new.id,
    public.accent_for(new.id)
  )
  returning id into new_space;

  insert into public.space_members (space_id, user_id, role)
  values (new_space, new.id, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (new_space, 'general', 'text', 'Le salon principal de votre espace.', 0),
    (new_space, 'idees', 'text', 'Pour ce qui n''est pas encore mur.', 1),
    (new_space, 'Salon vocal', 'voice', null, 2);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- >>> 20260826120002_security.sql

-- ============================================================================
-- Orbit — securite au niveau des lignes
--
-- Le client parle directement a Postgres avec la cle publique. Toute la
-- securite du produit repose donc sur ce fichier : si une politique est trop
-- large, la donnee est publique. Chaque table est verrouillee par defaut, puis
-- ouverte explicitement.
--
-- Piege classique de Postgres a connaitre ici : une politique posee sur
-- `space_members` qui interroge `space_members` provoque une recursion
-- infinie. Les fonctions d'appartenance ci-dessous sont donc SECURITY DEFINER,
-- ce qui les fait s'executer hors RLS et coupe la recursion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fonctions d'autorisation
-- ----------------------------------------------------------------------------

create or replace function public.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = (select auth.uid())
  )
$$;

create or replace function public.can_manage_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = (select auth.uid())
       and role in ('owner', 'admin')
  )
$$;

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
      join public.space_members sm on sm.space_id = c.space_id
     where c.id = p_channel_id
       and sm.user_id = (select auth.uid())
  )
$$;

create or replace function public.can_manage_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      join public.space_members sm on sm.space_id = c.space_id
     where c.id = p_channel_id
       and sm.user_id = (select auth.uid())
       and sm.role in ('owner', 'admin')
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
    select 1
      from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.space_members sm on sm.space_id = c.space_id
     where m.id = p_message_id
       and sm.user_id = (select auth.uid())
  )
$$;

-- Vrai si les deux personnes partagent au moins un espace. Sert a limiter la
-- visibilite des profils : un compte ne peut pas enumerer tout l'annuaire.
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
$$;

-- ----------------------------------------------------------------------------
-- Activation de RLS
-- ----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.spaces              enable row level security;
alter table public.space_members       enable row level security;
alter table public.categories          enable row level security;
alter table public.channels            enable row level security;
alter table public.threads             enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages            enable row level security;
alter table public.attachments         enable row level security;
alter table public.reactions           enable row level security;
alter table public.read_states         enable row level security;

-- ----------------------------------------------------------------------------
-- Profils
-- ----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_space_with(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- L'insertion passe par le declencheur `handle_new_user`, jamais par le client.

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
  for select to authenticated
  using (public.is_space_member(id));

drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces
  for update to authenticated
  using (public.can_manage_space(id))
  with check (public.can_manage_space(id));

drop policy if exists spaces_delete on public.spaces;
create policy spaces_delete on public.spaces
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Membres
--
-- Aucune politique d'insertion : rejoindre un espace passe obligatoirement par
-- `public.join_space(code)`. Connaitre l'identifiant d'un espace ne suffit donc
-- jamais a s'y inviter soi-meme.
-- ----------------------------------------------------------------------------

drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists members_update on public.space_members;
create policy members_update on public.space_members
  for update to authenticated
  using (
    public.can_manage_space(space_id)
    -- Chacun peut changer son propre surnom.
    or user_id = (select auth.uid())
  )
  with check (
    public.can_manage_space(space_id)
    or user_id = (select auth.uid())
  );

drop policy if exists members_delete on public.space_members;
create policy members_delete on public.space_members
  for delete to authenticated
  using (
    -- Quitter un espace soi-meme, ou etre exclu par un administrateur.
    user_id = (select auth.uid())
    or public.can_manage_space(space_id)
  );

-- ----------------------------------------------------------------------------
-- Categories et salons
-- ----------------------------------------------------------------------------

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (public.can_manage_space(space_id));

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (public.can_manage_space(space_id));

-- ----------------------------------------------------------------------------
-- Fils
-- ----------------------------------------------------------------------------

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists threads_insert on public.threads;
create policy threads_insert on public.threads
  for insert to authenticated
  with check (
    public.is_channel_member(channel_id)
    and created_by = (select auth.uid())
  );

-- Marquer un fil comme resolu est un geste collaboratif : tout membre de
-- l'espace peut le faire, pas seulement l'auteur.
drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads
  for update to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

drop policy if exists threads_delete on public.threads;
create policy threads_delete on public.threads
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.can_manage_channel(channel_id));

drop policy if exists thread_participants_select on public.thread_participants;
create policy thread_participants_select on public.thread_participants
  for select to authenticated
  using (
    exists (
      select 1 from public.threads t
       where t.id = thread_id and public.is_space_member(t.space_id)
    )
  );

drop policy if exists thread_participants_insert on public.thread_participants;
create policy thread_participants_insert on public.thread_participants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.threads t
       where t.id = thread_id and public.is_space_member(t.space_id)
    )
  );

drop policy if exists thread_participants_delete on public.thread_participants;
create policy thread_participants_delete on public.thread_participants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

-- Seul l'auteur modifie son texte. L'epinglage, qui touche le message de
-- quelqu'un d'autre, passe par `public.set_message_pinned`.
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.can_manage_channel(channel_id));

-- ----------------------------------------------------------------------------
-- Pieces jointes
-- ----------------------------------------------------------------------------

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
       where m.id = message_id and m.author_id = (select auth.uid())
    )
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_id
         and (m.author_id = (select auth.uid()) or public.can_manage_channel(m.channel_id))
    )
  );

-- ----------------------------------------------------------------------------
-- Reactions
-- ----------------------------------------------------------------------------

drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_see_message(message_id)
  );

drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Etats de lecture : strictement prives
-- ----------------------------------------------------------------------------

drop policy if exists read_states_own on public.read_states;
create policy read_states_own on public.read_states
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- >>> 20260826120003_api.sql

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

-- >>> 20260826120004_storage.sql

-- ============================================================================
-- Orbit — stockage des fichiers
--
-- Deux compartiments aux regles opposees :
--   `avatars`     public en lecture, chacun n'ecrit que dans son dossier ;
--   `attachments` prive, lisible seulement par les membres du salon concerne.
--
-- Le nom du fichier porte l'autorisation : le premier segment du chemin est
-- l'identifiant du proprietaire (avatars) ou du salon (pieces jointes), ce qui
-- permet aux politiques de decider sans consulter d'autre table.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 25 * 1024 * 1024)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ----------------------------------------------------------------------------
-- Avatars : chemin `{user_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- Pieces jointes : chemin `{channel_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_remove on storage.objects;
create policy attachments_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner_id = (select auth.uid())::text
      or public.can_manage_channel(((storage.foldername(name))[1])::uuid)
    )
  );
