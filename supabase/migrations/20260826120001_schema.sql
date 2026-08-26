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
