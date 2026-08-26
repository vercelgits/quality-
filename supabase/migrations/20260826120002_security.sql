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
