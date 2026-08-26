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
