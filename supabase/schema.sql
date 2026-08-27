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

-- >>> 20260826120005_moderation.sql

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

-- >>> 20260826120006_features.sql

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

-- >>> 20260826120007_profiles.sql

-- ============================================================================
-- Orbit — profils enrichis
--
-- Un profil ne se limite plus a un pseudo et un avatar : banniere, pronoms,
-- liens, et des statistiques calculees a la demande.
--
-- Les statistiques ne sont pas stockees dans une colonne qu'il faudrait tenir
-- a jour a chaque message : elles sont comptees au moment ou on les demande.
-- Un profil s'ouvre rarement, un message s'ecrit souvent — c'est le comptage
-- qu'il vaut mieux payer.
-- ============================================================================

alter table public.profiles
  add column if not exists banner_url text,
  add column if not exists pronouns text check (char_length(pronouns) <= 32),
  -- Liens externes, sous la forme [{"label": "...", "url": "https://..."}].
  add column if not exists links jsonb not null default '[]'::jsonb,
  -- Teinte choisie par la personne, appliquee a sa carte de profil.
  add column if not exists theme_hue int check (theme_hue between 0 and 360);

/**
 * Valide la forme du tableau de liens.
 *
 * Le controle vit dans une fonction et non directement dans la contrainte :
 * Postgres refuse toute sous-requete dans un CHECK, et parcourir un tableau
 * JSON en demande une. Une fonction IMMUTABLE contourne la limite sans changer
 * la garantie — la verification reste faite en base, donc un client contourne
 * ne peut pas y echapper.
 *
 * Seuls http et https sont acceptes : un lien `javascript:` deviendrait une
 * faille des qu'il serait rendu cliquable.
 */
create or replace function public.valid_profile_links(links jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select jsonb_typeof(links) = 'array'
     and jsonb_array_length(links) <= 5
     and not exists (
       select 1
         from jsonb_array_elements(links) as entry
        where jsonb_typeof(entry) <> 'object'
           or entry->>'url' is null
           or entry->>'label' is null
           or char_length(entry->>'label') > 40
           or char_length(entry->>'url') > 200
           or entry->>'url' !~ '^https?://'
     )
$$;

alter table public.profiles
  drop constraint if exists profiles_links_shape;

alter table public.profiles
  add constraint profiles_links_shape check (public.valid_profile_links(links));

-- ----------------------------------------------------------------------------
-- Statistiques
-- ----------------------------------------------------------------------------

/**
 * Chiffres affiches sur une carte de profil.
 *
 * SECURITY INVOKER : les politiques RLS s'appliquent, donc on ne compte que
 * les messages des salons que l'on a soi-meme le droit de lire. Deux personnes
 * ne verront pas forcement le meme total, et c'est voulu — l'inverse revelerait
 * l'activite dans des espaces prives.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'messages', (
      select count(*) from public.messages m where m.author_id = p_user_id
    ),
    'threads_opened', (
      select count(*) from public.threads t where t.created_by = p_user_id
    ),
    'reactions_given', (
      select count(*) from public.reactions r where r.user_id = p_user_id
    ),
    'shared_spaces', (
      select count(*)
        from public.space_members theirs
        join public.space_members mine
          on mine.space_id = theirs.space_id
         and mine.user_id = (select auth.uid())
       where theirs.user_id = p_user_id
    ),
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),
    -- Rangs detenus dans les espaces communs, pour afficher des distinctions.
    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select auth.uid())
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Bannieres
--
-- Meme compartiment que les avatars : la politique existante autorise deja
-- chacun a ecrire dans le dossier portant son identifiant, et le chemin
-- `{user_id}/banner-...` la respecte sans qu'il y ait rien a ajouter.
-- ----------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 4 * 1024 * 1024
 where id = 'avatars';

-- ----------------------------------------------------------------------------
-- Amorcage : le profil complet suit les memes colonnes
-- ----------------------------------------------------------------------------

-- `bootstrap()` renvoie deja `to_jsonb(profiles.*)`, donc les nouvelles
-- colonnes y apparaissent sans modification. Rien a redefinir ici.

-- >>> 20260827090001_direct_messages.sql

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

-- >>> 20260827090002_rate_limits.sql

-- ============================================================================
-- Orbit — limitation de debit
--
-- Le mode lent d'un salon protege une conversation ; il ne protege pas le
-- service. Rien n'empechait jusqu'ici un script muni d'un compte valide
-- d'inserer des milliers de messages par seconde, ou de creer des espaces en
-- boucle.
--
-- Choix : les compteurs sont deduits des tables existantes plutot que stockes
-- dans une table d'evenements. Une table dediee grossirait sans fin et
-- demanderait un nettoyage periodique, alors que les messages et les reactions
-- portent deja leur horodatage. Les index partiels ci-dessous rendent ces
-- comptages quasi gratuits, puisqu'ils ne couvrent que la periode recente
-- utile.
--
-- Les seuils sont larges pour un humain et etroits pour un automate : trente
-- messages par minute, c'est deux par seconde soutenues, ce que personne ne
-- tape.
-- ============================================================================

-- Comptages sur fenetre glissante : sans ces index, chaque envoi de message
-- declencherait un parcours de toutes les lignes de l'auteur.
create index if not exists messages_author_recent_idx
  on public.messages (author_id, created_at desc);

create index if not exists reactions_user_recent_idx
  on public.reactions (user_id, created_at desc);

create index if not exists spaces_owner_recent_idx
  on public.spaces (owner_id, created_at desc);

create index if not exists reports_reporter_recent_idx
  on public.message_reports (reporter_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Seuils
-- ----------------------------------------------------------------------------

/**
 * Nombre d'actions restantes avant blocage, pour une table donnee.
 *
 * SECURITY DEFINER : le comptage doit voir toutes les lignes de la personne, y
 * compris celles de salons devenus invisibles depuis. Sinon on pourrait
 * contourner la limite en quittant un espace.
 */
create or replace function public.recent_count(
  p_table  text,
  p_column text,
  p_window interval
)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total int;
begin
  -- `format` avec %I echappe les identifiants : le nom de table et de colonne
  -- vient du code appelant, jamais de l'utilisateur, mais la precaution coute
  -- une ligne et supprime toute possibilite d'injection.
  execute format(
    'select count(*)::int from public.%I where %I = $1 and created_at > now() - $2',
    p_table, p_column
  )
  into total
  using (select auth.uid()), p_window;

  return coalesce(total, 0);
end;
$$;

/** Limites appliquees, exprimees en actions par fenetre. */
create or replace function public.rate_limit_message()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.recent_count('messages', 'author_id', interval '1 minute') < 30
$$;

-- ----------------------------------------------------------------------------
-- Application
-- ----------------------------------------------------------------------------

/**
 * Le droit d'ecrire integre desormais la limite de debit.
 *
 * Elle s'applique a tout le monde, moderateurs compris : un compte
 * d'administration compromis est precisement celui dont on veut brider le
 * debit.
 */
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

  if not public.rate_limit_message() then
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

-- Reactions : soixante par minute. Cliquer plus vite releve du script.
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_see_message(message_id)
    and public.recent_count('reactions', 'user_id', interval '1 minute') < 60
  );

/** Creation d'espace : cinq par heure. */
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

  if public.recent_count('spaces', 'owner_id', interval '1 hour') >= 5 then
    raise exception 'Trop d''espaces crees recemment. Reessayez dans une heure.'
      using errcode = '53400';
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

/** Signalements : vingt par heure, pour eviter le harcelement par signalement. */
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

  if public.recent_count('message_reports', 'reporter_id', interval '1 hour') >= 20 then
    raise exception 'Trop de signalements envoyes recemment. Reessayez plus tard.'
      using errcode = '53400';
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

-- ----------------------------------------------------------------------------
-- Diagnostic cote client
--
-- Sans cela, une insertion refusee par la limite de debit remonterait comme un
-- refus de politique RLS, indiscernable d'un manque de droits. L'interface
-- pourrait alors afficher « acces refuse » a quelqu'un qui a simplement ecrit
-- trop vite.
-- ----------------------------------------------------------------------------

create or replace function public.my_rate_limits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'messages_last_minute', public.recent_count('messages', 'author_id', interval '1 minute'),
    'messages_limit', 30,
    'reactions_last_minute', public.recent_count('reactions', 'user_id', interval '1 minute'),
    'reactions_limit', 60
  );
$$;

-- >>> 20260827100001_oauth_profiles.sql

-- ============================================================================
-- Orbit — comptes ouverts par un fournisseur tiers
--
-- Une inscription par Google arrive sans pseudo choisi, mais avec un nom
-- complet et une photo. La version precedente du declencheur les ignorait :
-- le nouveau venu se retrouvait avec un pseudo derive de son adresse et un
-- avatar en initiales, alors que les deux informations etaient disponibles.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted    text;
  candidate text;
  suffix    int := 0;
  shown     text;
  picture   text;
  new_space uuid;
begin
  -- Pseudo : celui demande a l'inscription, sinon la partie locale de
  -- l'adresse. Les fournisseurs tiers n'en proposent jamais.
  wanted := lower(regexp_replace(
    coalesce(
      meta ->> 'username',
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

  -- Nom affiche : Google renseigne `full_name`, d'autres `name`.
  shown := nullif(trim(coalesce(
    meta ->> 'display_name',
    meta ->> 'full_name',
    meta ->> 'name',
    ''
  )), '');

  -- Photo : Google renseigne `avatar_url`, parfois `picture`.
  picture := nullif(trim(coalesce(
    meta ->> 'avatar_url',
    meta ->> 'picture',
    ''
  )), '');

  -- Une adresse d'image doit rester une adresse d'image : sans ce controle,
  -- une valeur `javascript:` fournie par un fournisseur mal configure
  -- deviendrait une faille des qu'elle serait rendue.
  if picture is not null and picture !~ '^https?://' then
    picture := null;
  end if;

  insert into public.profiles (id, username, display_name, accent, avatar_url)
  values (
    new.id,
    candidate,
    coalesce(shown, candidate),
    public.accent_for(new.id),
    picture
  );

  -- Un compte tout neuf arrive dans un espace deja utilisable plutot que
  -- devant un ecran vide.
  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || coalesce(shown, candidate),
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

-- >>> 20260827110001_username_onboarding.sql

-- ============================================================================
-- Orbit — choix du pseudo apres une connexion par fournisseur tiers
--
-- Une inscription par Google n'apporte aucun pseudo : le declencheur en
-- fabriquait un a partir de l'adresse e-mail. C'est fonctionnel mais subi, et
-- le pseudo est ce par quoi on est mentionne — il merite d'etre choisi.
--
-- On distingue donc un pseudo choisi d'un pseudo attribue. Le second declenche
-- un ecran de bienvenue qui demande de trancher avant d'entrer.
-- ============================================================================

alter table public.profiles
  add column if not exists username_chosen boolean not null default true;

-- Les comptes existants ont tous choisi leur pseudo a l'inscription : la
-- valeur par defaut `true` les laisse tranquilles. Seuls les comptes ouverts
-- par un fournisseur tiers a partir de maintenant partiront a `false`.

comment on column public.profiles.username_chosen is
  'Faux tant que le pseudo a ete deduit de l''adresse plutot que choisi.';

-- ----------------------------------------------------------------------------
-- Le declencheur marque les pseudos deduits
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  asked     text  := nullif(trim(coalesce(meta ->> 'username', '')), '');
  wanted    text;
  candidate text;
  suffix    int := 0;
  shown     text;
  picture   text;
  new_space uuid;
begin
  wanted := lower(regexp_replace(
    coalesce(asked, split_part(coalesce(new.email, ''), '@', 1), 'membre'),
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

  shown := nullif(trim(coalesce(
    meta ->> 'display_name', meta ->> 'full_name', meta ->> 'name', ''
  )), '');

  picture := nullif(trim(coalesce(meta ->> 'avatar_url', meta ->> 'picture', '')), '');
  if picture is not null and picture !~ '^https?://' then
    picture := null;
  end if;

  insert into public.profiles (
    id, username, display_name, accent, avatar_url, username_chosen
  )
  values (
    new.id,
    candidate,
    coalesce(shown, candidate),
    public.accent_for(new.id),
    picture,
    -- Choisi seulement si l'inscription en portait un.
    asked is not null
  );

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || coalesce(shown, candidate),
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

-- ----------------------------------------------------------------------------
-- Verifier puis reserver un pseudo
-- ----------------------------------------------------------------------------

/**
 * Un pseudo est-il libre ?
 *
 * SECURITY DEFINER, parce que la politique de lecture des profils est limitee
 * aux personnes avec qui on partage un espace : sans cela, la verification
 * repondrait « libre » pour un pseudo qui existe hors de vue.
 *
 * Cela expose l'existence d'un pseudo, ce qui est inevitable : un formulaire
 * qui refuse un pseudo pris la revele de toute facon.
 */
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(trim(p_username)) ~ '^[a-z0-9_.-]{2,32}$'
     and not exists (
       select 1 from public.profiles
        where username = lower(trim(p_username))
          and id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
     )
$$;

/**
 * Fixe definitivement son pseudo.
 *
 * L'unicite est garantie par la contrainte de la table et non par la
 * verification prealable : entre le controle et l'ecriture, quelqu'un d'autre
 * peut avoir pris le meme. On rattrape donc la violation pour renvoyer un
 * message comprehensible plutot qu'une erreur de contrainte.
 */
create or replace function public.claim_username(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  wanted  text := lower(trim(p_username));
  updated public.profiles;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  if wanted !~ '^[a-z0-9_.-]{2,32}$' then
    raise exception 'Entre 2 et 32 caracteres : lettres, chiffres, point, tiret, souligne.'
      using errcode = '22023';
  end if;

  begin
    update public.profiles
       set username = wanted,
           username_chosen = true
     where id = me
    returning * into updated;
  exception
    when unique_violation then
      raise exception 'Ce pseudo est deja pris.' using errcode = '23505';
  end;

  return updated;
end;
$$;

-- >>> 20260827120001_friends.sql

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
