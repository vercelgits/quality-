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
