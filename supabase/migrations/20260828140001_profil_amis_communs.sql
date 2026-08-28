/*
 * Profil : les amis en commun.
 *
 * La fiche repondait a « d'ou est-ce que je connais cette personne ? » par les
 * espaces partages. L'autre moitie de la reponse, c'est qui l'on connait tous
 * les deux — souvent plus parlant qu'un nom de serveur.
 *
 * SECURITY INVOKER : la jointure passe par ses propres amities acceptees, donc
 * on ne peut voir que des personnes que l'on connait deja. On n'apprend rien
 * du carnet d'adresses de l'autre au-dela de l'intersection avec le sien.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with moi as (select (select auth.uid()) as id),

  -- Amis acceptes de quelqu'un, dans un sens comme dans l'autre : la table
  -- range la paire mais ne dit pas qui a demande.
  amis as (
    select f.requester_id as a, f.addressee_id as b
      from public.friendships f
     where f.status = 'accepted'
  ),

  mes_amis as (
    select case when a.a = (select id from moi) then a.b else a.a end as ami
      from amis a
     where (select id from moi) in (a.a, a.b)
  ),

  ses_amis as (
    select case when a.a = p_user_id then a.b else a.a end as ami
      from amis a
     where p_user_id in (a.a, a.b)
  )

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
         and mine.user_id = (select id from moi)
        join public.spaces s on s.id = theirs.space_id
       where theirs.user_id = p_user_id
         -- Sa propre fiche listerait tous ses espaces : sans interet, et cela
         -- ferait defiler la carte pour rien.
         and p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    'mutual_friends', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'username', p.username,
                 'display_name', p.display_name,
                 'avatar_url', p.avatar_url
               )
               order by p.display_name
             )
        from mes_amis m
        join ses_amis t on t.ami = m.ami
        join public.profiles p on p.id = m.ami
       where p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    -- Rangs detenus dans les espaces communs, pour afficher des distinctions.
    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select id from moi)
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;
