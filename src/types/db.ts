/**
 * Formes exactes des lignes Postgres.
 *
 * Les noms restent en `snake_case`, identiques a ceux des colonnes. Traduire en
 * `camelCase` imposerait une couche de conversion a chaque lecture et a chaque
 * ecriture, pour un benefice cosmetique : la moindre faute de frappe dans le
 * mapping produirait un `undefined` silencieux au lieu d'une erreur de
 * compilation. On garde donc la forme de la base de bout en bout.
 */

export type UUID = string;
/** Horodatage ISO 8601 renvoye par Postgres pour un `timestamptz`. */
export type ISODate = string;

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type SpaceRole = 'owner' | 'admin' | 'member';
export type ChannelKind = 'text' | 'voice';

export interface Profile {
  id: UUID;
  username: string;
  display_name: string;
  accent: string;
  avatar_url: string | null;
  bio: string | null;
  status: PresenceStatus;
  custom_status: string | null;
  created_at: ISODate;
}

export interface Space {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  accent: string;
  owner_id: UUID;
  invite_code: string;
  created_at: ISODate;
}

export interface SpaceMember {
  space_id: UUID;
  user_id: UUID;
  role: SpaceRole;
  nickname: string | null;
  joined_at: ISODate;
}

export interface Category {
  id: UUID;
  space_id: UUID;
  name: string;
  position: number;
}

export interface Channel {
  id: UUID;
  space_id: UUID;
  category_id: UUID | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
  created_at: ISODate;
}

export interface Thread {
  id: UUID;
  channel_id: UUID;
  space_id: UUID;
  root_message_id: UUID;
  title: string;
  created_by: UUID;
  created_at: ISODate;
  last_activity_at: ISODate;
  resolved: boolean;
  resolved_by: UUID | null;
  resolved_at: ISODate | null;
}

export interface MessageRow {
  id: UUID;
  channel_id: UUID;
  thread_id: UUID | null;
  author_id: UUID;
  content: string;
  created_at: ISODate;
  edited_at: ISODate | null;
  reply_to_id: UUID | null;
  pinned: boolean;
}

export interface Attachment {
  id: UUID;
  message_id: UUID;
  storage_path: string;
  filename: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ReactionRow {
  message_id: UUID;
  user_id: UUID;
  emoji: string;
  created_at: ISODate;
}

export interface ReadState {
  channel_id: UUID;
  last_read_at: ISODate;
  unread_count: number;
  mention_count: number;
}

/** Reactions d'un message, regroupees par emoji pour l'affichage. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  reacted_by: UUID[];
}

/**
 * Message tel que manipule par l'interface : la ligne brute enrichie de ce qui
 * l'accompagne toujours a l'ecran.
 */
export interface Message extends MessageRow {
  reactions: ReactionGroup[];
  attachments: Attachment[];
  /** Renseigne quand un fil a ete ouvert depuis ce message. */
  thread: Thread | null;
  /**
   * Vrai tant que le serveur n'a pas confirme l'envoi. Le message est affiche
   * immediatement et se materialise une fois accuse.
   */
  pending?: boolean;
  /** Renseigne si l'envoi a echoue, pour proposer un renvoi. */
  failed?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Retours des fonctions RPC                                                   */
/* -------------------------------------------------------------------------- */

export interface BootstrapPayload {
  profile: Profile | null;
  spaces: Space[];
  channels: Channel[];
  categories: Category[];
  members: SpaceMember[];
  profiles: Profile[];
  open_threads: Thread[];
  read_states: ReadState[];
}

export interface SearchRow {
  id: UUID;
  channel_id: UUID;
  channel_name: string;
  space_id: UUID;
  thread_id: UUID | null;
  author_id: UUID;
  content: string;
  created_at: ISODate;
  pinned: boolean;
  rank: number;
  total_count: number;
}

/* -------------------------------------------------------------------------- */
/* Etats ephemeres, transportes par les canaux temps reel et non par la base    */
/* -------------------------------------------------------------------------- */

export interface TypingSignal {
  user_id: UUID;
  channel_id: UUID;
  thread_id: UUID | null;
  at: number;
}

export interface VoiceParticipant {
  user_id: UUID;
  channel_id: UUID;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  video: boolean;
  joined_at: number;
}

/** Signalisation WebRTC echangee entre deux pairs d'un salon vocal. */
export type VoiceSignal =
  | { kind: 'offer'; from: UUID; to: UUID; sdp: string }
  | { kind: 'answer'; from: UUID; to: UUID; sdp: string }
  | { kind: 'ice'; from: UUID; to: UUID; candidate: RTCIceCandidateInit };
