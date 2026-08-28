/*
 * Profil : les espaces en commun, nommes.
 *
 * `profile_stats` renvoyait des compteurs — messages ecrits, fils ouverts,
 * reactions posees. Un nombre de messages ne dit rien d'utile sur quelqu'un,
 * et affiche a cote d'un visage il se lit comme un score. On le retire.
 *
 * Ce qu'on garde, c'est ce qui repond a la seule question qu'on se pose en
 * ouvrant une fiche : « d'ou est-ce que je connais cette personne ? ». La
 * reponse demande les espaces eux-memes, pas leur nombre.
 *
 * SECURITY INVOKER, comme avant : la jointure sur ses propres appartenances
 * fait que l'on ne peut lister que des espaces dont on est deja membre. On
 * n'apprend donc rien de nouveau sur les autres appartenances de la personne.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),

    'mutual_spaces', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'name', s.name, 'icon_url', s.icon_url)
               order by s.name
             )
        from public.space_members theirs
        join public.space_members mine
          on mine.space_id = theirs.space_id
         and mine.user_id = (select auth.uid())
        join public.spaces s on s.id = theirs.space_id
       where theirs.user_id = p_user_id
         -- Sa propre fiche listerait tous ses espaces : sans interet, et cela
         -- ferait defiler la carte pour rien.
         and p_user_id <> (select auth.uid())
    ), '[]'::jsonb),

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
