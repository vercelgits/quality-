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
