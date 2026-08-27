import { useEffect, useRef, useState } from 'react';
import { useVoice } from './useVoice';
import { useDevices, applySink } from '@/store/devices';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { formatDuration } from '@/lib/time';
import type { Channel, VoiceParticipant } from '@/types/db';

/** Tableau vide partage : une nouvelle instance casserait la memoisation. */
const EMPTY_PARTICIPANTS: VoiceParticipant[] = [];

/** Vue principale d'un salon vocal : les participants et leurs partages. */
export function VoiceStage({ channel }: { channel: Channel }) {
  const profile = useSession((state) => state.profile);
  const profiles = useChat((state) => state.profiles);

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
  const focusShare = useVoice((state) => state.focusShare);
  const toggleCamera = useVoice((state) => state.toggleCamera);
  const speaking = useVoice((state) => state.speaking);
  const muted = useVoice((state) => state.muted);
  const deafened = useVoice((state) => state.deafened);
  const sharing = useVoice((state) => state.sharing);

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

  // Les partages distants arrivent par WebRTC ; le sien vient de la capture
  // locale, qui ne fait pas l'aller-retour reseau.
  const screenShares = participants
    .filter((participant) => participant.sharing)
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

          return (
            <li
              key={participant.user_id}
              // Un seul etat porte l'anneau a la fois, du plus grave au plus
              // anodin : sourd, puis micro coupe, puis en train de parler.
              // Les cumuler donnerait deux couleurs sur le meme bord.
              className={
                'voice-tile' +
                (participant.deafened
                  ? ' is-deafened'
                  : participant.muted
                    ? ' is-muted'
                    : isSpeaking
                      ? ' is-speaking'
                      : '')
              }
            >
              {participant.video ? (
                <CameraTile
                  stream={isMe ? (localCamera ?? undefined) : remoteCameras[participant.user_id]}
                  mirrored={isMe}
                />
              ) : (
                <Avatar profile={person} size={64} />
              )}
              <span className="voice-tile__name truncate">
                {person?.display_name ?? 'Quelqu’un'}
                {isMe ? ' (vous)' : ''}
              </span>
              <span className="voice-tile__icons">
                {participant.muted ? <Icon name="mic-off" size={14} /> : null}
                {participant.deafened ? <Icon name="headphones-off" size={14} /> : null}
                {participant.sharing ? <Icon name="screen" size={14} /> : null}
              </span>
              {!isMe ? (
                <RemoteAudio stream={remoteAudio[participant.user_id]} muted={deafened} />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="voice-controls surface">
        <span className="voice-controls__timer" title="Duree de connexion">
          <span className="voice-controls__pulse" aria-hidden="true" />
          {formatDuration(elapsed)}
        </span>

        <button
          type="button"
          className={'icon-btn' + (muted ? ' is-active' : '')}
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
          className={'icon-btn' + (cameraOn ? ' is-active' : '')}
          onClick={() => void toggleCamera()}
          aria-pressed={cameraOn}
          title={cameraOn ? 'Couper la camera' : 'Activer la camera'}
        >
          <Icon name="video" size={18} />
        </button>

        <button
          type="button"
          className={'icon-btn' + (sharing ? ' is-active' : '')}
          onClick={() => void toggleScreenShare()}
          aria-pressed={sharing}
          title={sharing ? 'Arreter le partage' : 'Partager l’ecran'}
        >
          <Icon name="screen" size={18} />
        </button>

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
      <video ref={ref} className="screen-tile__video" autoPlay playsInline muted />

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
