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
