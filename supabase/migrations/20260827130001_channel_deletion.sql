-- ============================================================================
-- Orbit — suppression et renommage d'un salon
--
-- On pouvait creer un salon, jamais s'en debarrasser : un essai malheureux
-- restait dans la liste pour toujours.
--
-- La suppression emporte les messages par cascade. Elle est donc reservee aux
-- administrateurs, et refusee sur le dernier salon textuel d'un espace : sans
-- cette garde, on peut se retrouver dans un espace ou l'on ne peut plus rien
-- ecrire ni rien recreer depuis l'interface.
-- ============================================================================

/**
 * Supprime un salon.
 *
 * Renvoie l'espace concerne : l'appelant doit savoir vers ou se replier, et le
 * lui faire deviner reviendrait a le laisser sur un salon qui n'existe plus.
 */
create or replace function public.delete_channel(p_channel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan       public.channels;
  text_left  int;
begin
  select * into chan from public.channels where id = p_channel_id;

  if not found then
    raise exception 'Salon introuvable.' using errcode = 'P0002';
  end if;

  -- Une conversation privee n'appartient a aucun espace : elle se masque, elle
  -- ne se supprime pas. Les autres participants y perdraient leur historique.
  if chan.space_id is null then
    raise exception 'Une conversation privee ne se supprime pas ; masquez-la.'
      using errcode = '42501';
  end if;

  -- Rang administrateur : la suppression emporte tous les messages, ce qui est
  -- irreversible et depasse ce qu'on confie a un moderateur.
  if public.my_rank(chan.space_id) < 2 then
    raise exception 'Seuls les administrateurs peuvent supprimer un salon.'
      using errcode = '42501';
  end if;

  if chan.kind = 'text' then
    select count(*) into text_left
      from public.channels
     where space_id = chan.space_id and kind = 'text' and id <> p_channel_id;

    if text_left = 0 then
      raise exception 'Gardez au moins un salon textuel dans cet espace.'
        using errcode = '23514';
    end if;
  end if;

  delete from public.channels where id = p_channel_id;

  perform public.log_moderation(
    chan.space_id, null, 'channel_delete', null,
    jsonb_build_object('name', chan.name, 'kind', chan.kind)
  );

  return chan.space_id;
end;
$$;

/**
 * Renomme un salon, et met a jour son sujet.
 *
 * Pouvoir supprimer sans pouvoir corriger un nom pousserait a supprimer pour
 * une faute de frappe, en emportant les messages avec.
 */
create or replace function public.rename_channel(
  p_channel_id uuid,
  p_name       text,
  p_topic      text default null
)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan    public.channels;
  wanted  text;
  updated public.channels;
begin
  select * into chan from public.channels where id = p_channel_id;

  if not found then
    raise exception 'Salon introuvable.' using errcode = 'P0002';
  end if;
  if chan.space_id is null then
    raise exception 'Une conversation privee ne se renomme pas ici.' using errcode = '42501';
  end if;
  if not public.can_moderate_space(chan.space_id) then
    raise exception 'Action reservee a l''equipe de moderation.' using errcode = '42501';
  end if;

  wanted := trim(p_name);
  if char_length(wanted) < 1 or char_length(wanted) > 48 then
    raise exception 'Le nom doit faire entre 1 et 48 caracteres.' using errcode = '22023';
  end if;

  update public.channels
     set name  = wanted,
         topic = coalesce(nullif(trim(coalesce(p_topic, '')), ''), topic)
   where id = p_channel_id
  returning * into updated;

  return updated;
end;
$$;

-- Sans identite de replication complete, un evenement de suppression ne
-- transporte que la cle primaire : la politique RLS ne peut pas etre evaluee,
-- et le salon resterait affiche chez les autres membres jusqu'au rechargement.
alter table public.channels replica identity full;
