import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, useContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { UserContextMenu } from '@/features/profile/UserContextMenu';
import { useVoice } from './useVoice';
import { useDevices, applySink } from '@/store/devices';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { SharePanel } from './SharePanel';
import { SourcePicker } from './SourcePicker';

/** Le selecteur natif n'existe que dans l'application de bureau. */
const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { formatDuration } from '@/lib/time';
import type { Channel, UUID, VoiceParticipant } from '@/types/db';

/** Tableau vide partage : une nouvelle instance casserait la memoisation. */
const EMPTY_PARTICIPANTS: VoiceParticipant[] = [];

/** Vue principale d'un salon vocal : les participants et leurs partages. */
export function VoiceStage({ channel }: { channel: Channel }) {
  const profile = useSession((state) => state.profile);
  const profiles = useChat((state) => state.profiles);
  const openModal = useUI((state) => state.openModal);
  const [panneauPartage, setPanneauPartage] = useState(false);

  const channelId = useVoice((state) => state.channelId);
  const connecting = useVoice((state) => state.connecting);
  const error = useVoice((state) => state.error);
  // Le selecteur renvoie la reference telle quelle : ecrire `?? []` a
  // l'interieur fabriquerait un tableau neuf a chaque appel, et zustand,
  // comparant les references, redeclencherait un rendu sans fin.
  const rawParticipants = useVoice((state) => state.participantsByChannel[channel.id]);
  const participants = rawParticipants ?? EMPTY_PARTICIPANTS;
  const remoteAudio = useVoice((state) => state.remoteAudio);
  const remoteScreens = useVoice((state) => state.remoteScreens);
  const localScreen = useVoice((state) => state.localScreen);
  const localCamera = useVoice((state) => state.localCamera);
  const remoteCameras = useVoice((state) => state.remoteCameras);
  const cameraOn = useVoice((state) => state.cameraOn);
  const focusedShare = useVoice((state) => state.focusedShare);
  const watchedShares = useVoice((state) => state.watchedShares);
  const toggleWatch = useVoice((state) => state.toggleWatch);
  const focusShare = useVoice((state) => state.focusShare);
  const toggleCamera = useVoice((state) => state.toggleCamera);
  const speaking = useVoice((state) => state.speaking);
  const muted = useVoice((state) => state.muted);
  const deafened = useVoice((state) => state.deafened);
  const sharing = useVoice((state) => state.sharing);
  const stats = useVoice((state) => state.outboundStats);
  const qualite = useContextMenu();

  const join = useVoice((state) => state.join);
  const leave = useVoice((state) => state.leave);
  const toggleMute = useVoice((state) => state.toggleMute);
  const toggleDeafen = useVoice((state) => state.toggleDeafen);
  const toggleScreenShare = useVoice((state) => state.toggleScreenShare);

  const connected = channelId === channel.id;
  const [joinedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - joinedAt), 1000);
    return () => window.clearInterval(timer);
  }, [connected, joinedAt]);

  /*
   * Seuls les partages qu'on a ouverts sont affiches.
   *
   * Les partages distants arrivent par WebRTC ; le sien vient de la capture
   * locale, qui ne fait pas l'aller-retour reseau. Tant qu'on n'a pas clique
   * « Regarder », la vignette n'est pas montee du tout : pas de balise video,
   * donc pas de decodage — c'est la que se joue le cout, pas dans la
   * reception.
   */
  const screenShares = participants
    .filter((participant) => participant.sharing && watchedShares[participant.user_id])
    .map((participant) => ({
      userId: participant.user_id,
      stream:
        participant.user_id === profile?.id
          ? (localScreen ?? undefined)
          : remoteScreens[participant.user_id],
    }))
    .filter((entry) => entry.stream !== undefined);

  // Un partage mis en avant occupe seul la zone : les autres passent en
  // vignettes sous les participants.
  const focused = focusedShare
    ? screenShares.find((entry) => entry.userId === focusedShare)
    : undefined;

  if (!connected) {
    return (
      <div className="voice-stage voice-stage--idle">
        <span className="voice-stage__mark" aria-hidden="true">
          <Icon name="volume" size={30} />
        </span>
        <h2 className="voice-stage__title">{channel.name}</h2>

        {participants.length > 0 ? (
          <>
            <p className="voice-stage__sub">
              {participants.length} personne{participants.length > 1 ? 's' : ''} en ligne
            </p>
            <ul className="voice-stage__preview">
              {participants.map((participant) => (
                <li key={participant.user_id}>
                  <Avatar profile={profiles[participant.user_id]} size={34} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="voice-stage__sub">Personne pour l’instant.</p>
        )}

        {error ? (
          <p className="voice-stage__error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--primary"
          onClick={() => profile && void join(channel.id, profile.id)}
          // Sans `profile`, le clic ne declenchait rien du tout : le bouton
          // restait actif et paraissait ignore.
          disabled={connecting || !profile}
        >
          {connecting ? <span className="spinner" /> : <Icon name="volume" size={15} />}
          Rejoindre le salon vocal
        </button>
      </div>
    );
  }

  return (
    <div className="voice-stage">
      {focused ? (
        <div className="voice-stage__focus">
          <ScreenTile
            stream={focused.stream}
            label={
              focused.userId === profile?.id
                ? 'Votre ecran'
                : (profiles[focused.userId]?.display_name ?? 'Partage')
            }
            focused
            onToggleFocus={() => focusShare(null)}
          />
        </div>
      ) : screenShares.length > 0 ? (
        <div className="voice-stage__screens">
          {screenShares.map((entry) => (
            <ScreenTile
              key={entry.userId}
              stream={entry.stream}
              label={
                entry.userId === profile?.id
                  ? 'Votre ecran'
                  : (profiles[entry.userId]?.display_name ?? 'Partage')
              }
              onToggleFocus={() => focusShare(entry.userId)}
            />
          ))}
        </div>
      ) : null}

      <ul className="voice-grid">
        {participants.map((participant) => {
          const person = profiles[participant.user_id];
          const isMe = participant.user_id === profile?.id;
          const isSpeaking = speaking[participant.user_id] ?? false;

          /*
           * Son propre etat est lu localement, jamais dans la presence.
           *
           * La presence est un echo : elle repart au serveur et revient. Tant
           * qu'elle n'est pas revenue, l'anneau restait sur l'ancienne couleur
           * — et si un envoi se perdait, il y restait pour de bon. On sait
           * pourtant de source sure si l'on vient de couper son micro : c'est
           * nous qui l'avons fait.
           */
          const etat = isMe
            ? {
                muted,
                deafened,
                sharing,
                video: cameraOn,
              }
            : participant;

          return (
            <VoiceTile
              key={participant.user_id}
              userId={participant.user_id}
              // Sa propre tuile est reperable. Une presence perimee — quelqu'un
              // dont le navigateur s'est ferme sans prevenir — laisse une tuile
              // fantome dans la grille, et rien ne permettait plus de dire
              // laquelle etait la sienne.
              isMe={isMe}
              // Un seul etat porte l'anneau a la fois, du plus grave au plus
              // anodin : sourd, puis micro coupe, puis en train de parler.
              // Les cumuler donnerait deux couleurs sur le meme bord.
              className={
                'voice-tile' +
                (etat.deafened
                  ? ' is-deafened'
                  : etat.muted
                    ? ' is-muted'
                    : isSpeaking
                      ? ' is-speaking'
                      : '')
              }
            >
              {etat.video ? (
                <CameraTile
                  stream={isMe ? (localCamera ?? undefined) : remoteCameras[participant.user_id]}
                  mirrored={isMe}
                />
              ) : (
                // Comme dans la conversation : le visage et le nom mènent au
                // profil, le clic droit aux actions.
                <button
                  type="button"
                  className="voice-tile__face"
                  onClick={() => openModal({ kind: 'profile', userId: participant.user_id })}
                  aria-label={
                    person ? `Voir le profil de ${person.display_name}` : 'Voir le profil'
                  }
                >
                  <Avatar profile={person} size={64} />
                </button>
              )}
              <button
                type="button"
                className="voice-tile__name truncate"
                onClick={() => openModal({ kind: 'profile', userId: participant.user_id })}
              >
                {person?.display_name ?? 'Quelqu’un'}
                {isMe ? ' (vous)' : ''}
              </button>
              <span className="voice-tile__icons">
                {etat.muted ? <Icon name="mic-off" size={14} /> : null}
                {etat.deafened ? <Icon name="headphones-off" size={14} /> : null}
              </span>

              {/*
                Un partage en cours s'annonce sur la tuile de la personne, avec
                de quoi l'ouvrir. Sans ce bouton, il fallait deviner que la
                vignette du bas etait cliquable — et sur une grille chargee elle
                passe inapercue.
              */}
              {etat.sharing ? (
                <div className="voice-tile__live">
                  <span className="voice-tile__badge">
                    <span className="voice-tile__pulse" aria-hidden="true" />
                    EN DIRECT
                  </span>

                  <button
                    type="button"
                    className="voice-tile__watch"
                    onClick={() => toggleWatch(participant.user_id)}
                  >
                    <Icon name="screen" size={14} />
                    {watchedShares[participant.user_id]
                      ? 'Masquer'
                      : isMe
                        ? 'Voir mon partage'
                        : 'Regarder'}
                  </button>
                </div>
              ) : null}
              {!isMe ? (
                <RemoteAudio stream={remoteAudio[participant.user_id]} muted={deafened} />
              ) : null}
            </VoiceTile>
          );
        })}
      </ul>

      <div className="voice-controls surface">
        <span className="voice-controls__timer" title="Duree de connexion">
          <span className="voice-controls__pulse" aria-hidden="true" />
          {formatDuration(elapsed)}
        </span>

        {/*
          Ce qui part reellement, releve par WebRTC — pas ce qu'on a demande.
          Un partage annonce en 1080p60 qui sort a deux megabits se voit ici ;
          a l'oeil, on hesite entre le reseau et le code.
        */}
        {stats ? (
          <span
            className="voice-controls__stats"
            title={`Ce qui est reellement emis : ${stats.width}x${stats.height}, ${stats.fps} images par seconde, ${stats.kbps} kb/s`}
          >
            {stats.height}p{stats.fps} · {(stats.kbps / 1000).toFixed(1)} Mb/s
          </span>
        ) : null}

        <button
          type="button"
          className={'icon-btn voice-controls__mic' + (muted ? ' is-active' : '')}
          onClick={toggleMute}
          aria-pressed={muted}
          title={muted ? 'Reactiver le micro' : 'Couper le micro'}
        >
          <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
        </button>

        <button
          type="button"
          className={'icon-btn' + (deafened ? ' is-active' : '')}
          onClick={toggleDeafen}
          aria-pressed={deafened}
          title={deafened ? 'Reactiver le son' : 'Couper le son'}
        >
          <Icon name={deafened ? 'headphones-off' : 'headphones'} size={18} />
        </button>

        <button
          type="button"
          className={'icon-btn' + (cameraOn ? ' is-broadcasting' : '')}
          onClick={() => void toggleCamera()}
          aria-pressed={cameraOn}
          title={cameraOn ? 'Couper la camera' : 'Activer la camera'}
        >
          <Icon name="video" size={18} />
        </button>

        {/*
          Demarrer passe par notre panneau ; arreter est immediat.
          La definition et la cadence se fixent a l'ouverture du flux : les
          demander apres coup imposerait de relancer la capture, et donc de
          couper le partage devant ceux qui regardent.
        */}
        <button
          type="button"
          className={'icon-btn' + (sharing ? ' is-broadcasting' : '')}
          onClick={() => (sharing ? void toggleScreenShare() : setPanneauPartage(true))}
          aria-pressed={sharing}
          title={sharing ? 'Arreter le partage' : 'Partager l’ecran'}
        >
          <Icon name="screen" size={18} />
        </button>

        {/*
          Sur le bureau, notre propre selecteur : les sources viennent du
          systeme, avec leurs vignettes. Dans un navigateur, ces sources
          n'existent pas — c'est lui qui les demande — et le panneau de
          reglages fait office d'etape prealable.
        */}
        {DANS_TAURI ? (
          <SourcePicker
            open={panneauPartage}
            onClose={() => setPanneauPartage(false)}
            onStart={() => {
              setPanneauPartage(false);
              void toggleScreenShare();
            }}
          />
        ) : (
          <SharePanel
            open={panneauPartage}
            onClose={() => setPanneauPartage(false)}
            onStart={() => {
              setPanneauPartage(false);
              void toggleScreenShare();
            }}
          />
        )}

        {/*
          Reglages de qualite, atteignables pendant le partage.
          Les changer en cours exige de relancer la capture : la definition et
          la cadence sont fixees a l'ouverture du flux, et rien ne permet de
          les modifier ensuite sans rouvrir.
        */}
        <button
          type="button"
          className="icon-btn voice-controls__more"
          onClick={(event) => qualite.openAt(event.currentTarget)}
          title="Qualite du partage"
          aria-label="Qualite du partage"
        >
          <Icon name="chevron-down" size={16} />
        </button>

        {qualite.position ? (
          <ShareQualityMenu position={qualite.position} onClose={qualite.close} sharing={sharing} />
        ) : null}

        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => void leave()}
        >
          <Icon name="phone-off" size={14} />
          Quitter
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Element audio invisible qui joue le flux d'un pair.
 *
 * React ne sait pas assigner un `MediaStream` par attribut : il faut passer par
 * la propriete `srcObject`, donc par une reference.
 */
function RemoteAudio({ stream, muted }: { stream: MediaStream | undefined; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const speakerId = useDevices((state) => state.media.speakerId);
  const outputVolume = useDevices((state) => state.media.outputVolume);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    void node.play().catch(() => {
      // La lecture automatique peut etre refusee tant que l'utilisateur n'a pas
      // interagi avec la page ; le prochain clic la debloquera.
    });
  }, [stream]);

  // Volume et sortie sont des proprietes et non des attributs : React ne les
  // ecrit pas depuis le rendu.
  useEffect(() => {
    if (ref.current) ref.current.volume = outputVolume;
  }, [outputVolume]);

  useEffect(() => {
    if (ref.current) void applySink(ref.current, speakerId);
  }, [speakerId]);

  return <audio ref={ref} autoPlay muted={muted} />;
}

function ScreenTile({
  stream,
  label,
  focused = false,
  onToggleFocus,
}: {
  stream: MediaStream | undefined;
  label: string;
  focused?: boolean;
  onToggleFocus?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }, [stream]);

  /*
   * Le plein ecran porte sur la vignette entiere, pas sur la video.
   *
   * Mettre la balise video en plein ecran rend la main au lecteur du
   * navigateur : on perd le nom de la personne, le bouton de sortie et le
   * reste de l'interface. En agrandissant le cadre, tout reste a sa place.
   */
  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;

    if (document.fullscreenElement === frame) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void frame.requestFullscreen?.().catch(() => undefined);
    }
  };

  // La sortie peut venir d'Echap ou du systeme : suivre l'evenement evite de
  // garder un bouton qui annonce le contraire de l'etat reel.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <figure
      ref={frameRef}
      className={
        'screen-tile' + (focused ? ' is-focused' : '') + (fullscreen ? ' is-fullscreen' : '')
      }
    >
      {/*
        L'image elle-meme agrandit et reduit.
        C'est le geste qu'on tente d'abord devant une video trop petite ; viser
        un bouton de trente pixels dans un coin ne vient qu'ensuite. Le bouton
        reste, pour le clavier et pour qui prefere une cible nommee.
      */}
      <button
        type="button"
        className="screen-tile__surface"
        onClick={onToggleFocus}
        disabled={!onToggleFocus}
        aria-label={focused ? 'Reduire le partage' : 'Agrandir le partage'}
      >
        <video ref={ref} className="screen-tile__video" autoPlay playsInline muted />
      </button>

      <figcaption className="screen-tile__label">
        <Icon name="screen" size={13} />
        {label}
      </figcaption>

      <div className="screen-tile__actions">
        {onToggleFocus ? (
          <button
            type="button"
            className="screen-tile__action"
            onClick={onToggleFocus}
            title={focused ? 'Reduire' : 'Agrandir'}
            aria-label={focused ? 'Reduire le partage' : 'Agrandir le partage'}
          >
            <Icon name={focused ? 'minus' : 'plus'} size={15} />
          </button>
        ) : null}

        <button
          type="button"
          className="screen-tile__action"
          onClick={toggleFullscreen}
          title={fullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}
          aria-label={fullscreen ? 'Quitter le plein ecran' : 'Afficher en plein ecran'}
        >
          <Icon name={fullscreen ? 'minus' : 'monitor'} size={15} />
        </button>
      </div>
    </figure>
  );
}

/**
 * Vignette de camera.
 *
 * Le flux local est renverse horizontalement : on s'attend a se voir comme
 * dans un miroir, et l'image non inversee desoriente.
 */
function CameraTile({ stream, mirrored }: { stream: MediaStream | undefined; mirrored: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }, [stream]);

  if (!stream) {
    return <span className="camera-tile camera-tile--empty" aria-hidden="true" />;
  }

  return (
    <video
      ref={ref}
      className={'camera-tile' + (mirrored ? ' is-mirrored' : '')}
      autoPlay
      playsInline
      muted
    />
  );
}


/**
 * Tuile d'un participant.
 *
 * Extraite pour que chaque tuile porte son propre menu : un etat unique
 * partage par la grille ouvrirait le menu de la derniere personne survolee,
 * pas de celle sur laquelle on a clique.
 */
function VoiceTile({
  userId,
  className,
  isMe = false,
  children,
}: {
  userId: UUID;
  className: string;
  isMe?: boolean;
  children: ReactNode;
}) {
  const menu = useContextMenu();

  return (
    <li className={className} data-me={isMe ? 'true' : undefined} onContextMenu={menu.open}>
      {children}
      {menu.position ? (
        <UserContextMenu userId={userId} position={menu.position} onClose={menu.close} />
      ) : null}
    </li>
  );
}


/**
 * Choix rapide de la qualite du partage.
 *
 * Les memes reglages existent dans les parametres, mais on ne va pas les
 * chercher au milieu d'un appel : ce sont justement les moments ou l'on veut
 * baisser la definition parce que ca rame.
 *
 * Un changement pendant un partage relance la capture — le selecteur de source
 * reapparait. C'est annonce dans l'intitule plutot que subi.
 */
function ShareQualityMenu({
  position,
  onClose,
  sharing,
}: {
  position: MenuPosition;
  onClose: () => void;
  sharing: boolean;
}) {
  const media = useDevices((state) => state.media);
  const setMedia = useDevices((state) => state.setMedia);
  const toggleScreenShare = useVoice((state) => state.toggleScreenShare);

  /** Applique un reglage, en relancant la capture si un partage est en cours. */
  const appliquer = (action: () => void) => {
    action();
    if (!sharing) return;

    void toggleScreenShare().then(() => void toggleScreenShare());
  };

  const coche = (actif: boolean) => (actif ? <Icon name="check" size={15} /> : undefined);

  const entrees: MenuEntry[] = [
    ...(['720p', '1080p', 'source'] as const).map((valeur) => ({
      id: `def-${valeur}`,
      label: valeur === 'source' ? 'Definition de la source' : valeur,
      icon: coche(media.screenQuality === valeur),
      onSelect: () => appliquer(() => setMedia('screenQuality', valeur)),
    })),

    { id: 'sep-fps', separator: true },

    ...([30, 60] as const).map((valeur) => ({
      id: `fps-${valeur}`,
      label: `${valeur} images par seconde`,
      icon: coche(media.screenFrameRate === valeur),
      onSelect: () => appliquer(() => setMedia('screenFrameRate', valeur)),
    })),

    { id: 'sep-prio', separator: true },

    {
      id: 'motion',
      label: 'Privilegier la fluidite',
      icon: coche(media.screenPriority === 'motion'),
      onSelect: () => appliquer(() => setMedia('screenPriority', 'motion')),
    },
    {
      id: 'detail',
      label: 'Privilegier la nettete',
      icon: coche(media.screenPriority === 'detail'),
      onSelect: () => appliquer(() => setMedia('screenPriority', 'detail')),
    },

    { id: 'sep-son', separator: true },

    {
      id: 'son',
      label: media.shareSystemAudio ? 'Partager le son : oui' : 'Partager le son : non',
      icon: <Icon name={media.shareSystemAudio ? 'volume' : 'mic-off'} size={15} />,
      onSelect: () => appliquer(() => setMedia('shareSystemAudio', !media.shareSystemAudio)),
    },
  ];

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label="Qualite du partage"
    />
  );
}
