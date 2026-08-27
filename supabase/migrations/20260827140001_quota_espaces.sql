-- ============================================================================
-- Orbit — assouplissement du quota d'espaces, et attente annoncee
--
-- Cinq espaces par heure etait trop serre. Quelqu'un qui decouvre
-- l'application en cree volontiers plusieurs d'affilee — un pour essayer, un
-- pour de vrai, un pour un projet — et se heurtait a un refus au bout de
-- quelques minutes. Le quota existe pour empecher un script d'en creer mille,
-- pas pour rationner l'exploration.
--
-- Le message annonce desormais le temps d'attente reel : « reessayez dans une
-- heure » etait faux des que la premiere creation datait de cinquante minutes.
-- ============================================================================

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
  me         uuid := (select auth.uid());
  base_slug  text;
  candidate  text;
  suffix     int := 0;
  created    public.spaces;
  plus_ancien timestamptz;
  restant    interval;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Le nom de l''espace est obligatoire' using errcode = '22023';
  end if;

  if public.recent_count('spaces', 'owner_id', interval '1 hour') >= 20 then
    -- Le delai reel plutot qu'une phrase toute faite : c'est la seule chose
    -- que la personne peut faire de cette information.
    select min(created_at) into plus_ancien
      from public.spaces
     where owner_id = me and created_at > now() - interval '1 hour';

    restant := (plus_ancien + interval '1 hour') - now();

    raise exception 'Trop d''espaces crees recemment. Reessayez dans % minutes.',
      greatest(1, ceil(extract(epoch from restant) / 60))::int
      using errcode = '53400';
  end if;

  base_slug := public.slugify(p_name);
  candidate := base_slug;
  while exists (select 1 from public.spaces where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    trim(p_name),
    candidate,
    nullif(trim(coalesce(p_description, '')), ''),
    me,
    public.accent_for(gen_random_uuid())
  )
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
