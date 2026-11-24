import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Profile } from '../domain/profiles';
import type { StreamPlatform, TwitchAccount, TwitchInfo, TwitchState } from '../contracts/twitch';
import { El, Icon, icons } from './icons';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const fail = 'Falha de comunicação com o aplicativo.';
const stateText: Record<TwitchState, [string, string]> = {
  off: ['Pausado', 'off'],
  login: ['Entrar na Twitch', 'auth_required'],
  starting: ['Abrindo o canal', 'loading'],
  watching: ['Assistindo', 'ready'],
  offline: ['Canal offline', 'offline'],
  attention: ['Precisa de um clique', 'auth_required'],
  duplicate: ['Conta repetida', 'error'],
  no_channel: ['Sem canal', 'off'],
  error: ['Erro na página', 'error'],
};
const NOMES: Record<StreamPlatform, string> = {twitch: 'Twitch', kick: 'Kick'};
const hints = (nome: string): Partial<Record<TwitchState, string>> => ({
  login: `Entre na sua conta da ${nome} na janela que abrir. A senha fica só na ${nome}.`,
  attention: 'O player pede uma confirmação (aviso de conteúdo). Abra a janela e clique no player.',
  duplicate: `Esta conta da ${nome} já está em outro perfil. Use uma conta da ${nome} por conta do jogo.`,
  offline: 'Os pontos voltam a contar sozinhos quando a live começar.',
  error: 'A página falhou. O PokéHub tenta de novo em 1 minuto.',
});
function since(iso: string | null, now: number) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Aba "Lives": Twitch e Kick lado a lado (uma conta de cada por conta do jogo), escolhidas pelo seletor. */
export function LivesPanel({profiles, active}: {profiles: Profile[]; active: boolean}) {
  const [platform, setPlatform] = useState<StreamPlatform>(() => { try { return localStorage.getItem('pokehub.lives') === 'kick' ? 'kick' : 'twitch'; } catch { return 'twitch'; } });
  useEffect(() => { try { localStorage.setItem('pokehub.lives', platform); } catch { /* só não persiste */ } }, [platform]);
  return <div className="side-body tw" hidden={!active}>
    <div className="seg tw-plat" role="group" aria-label="Plataforma" style={{'--n': 2, '--i': platform === 'kick' ? 1 : 0} as CSSProperties}>
      <button aria-pressed={platform === 'twitch'} onClick={() => setPlatform('twitch')}><span className="tw-dot" data-p="twitch"/>Twitch</button>
      <button aria-pressed={platform === 'kick'} onClick={() => setPlatform('kick')}><span className="tw-dot" data-p="kick"/>Kick</button>
    </div>
    <StreamPanel key={platform} platform={platform} profiles={profiles} active={active}/>
  </div>;
}

function StreamPanel({platform, profiles, active}: {platform: StreamPlatform; profiles: Profile[]; active: boolean}) {
  const nome = NOMES[platform];
  const hint = hints(nome);
  const [info, setInfo] = useState<TwitchInfo | null>(null);
  const [channel, setChannel] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    void window.pokehub.streams.get(platform).then(result => { if (!alive) return; if (result.ok) { setInfo(result.data); setChannel(result.data.channel); } else setMessage(result.error); }).catch(() => alive && setMessage(fail));
    const off = window.pokehub.streams.onChanged(next => { if (next.platform === platform) setInfo(next); });
    return () => { alive = false; off(); };
  }, [platform]);
  // relógio do "assistindo há": só com a aba à vista
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);

  async function act(key: string, action: () => Promise<Result<TwitchInfo>>) {
    if (busy) return;
    setBusy(key); setMessage('');
    try { const result = await action(); if (result.ok) setInfo(result.data); else setMessage(result.error); }
    catch { setMessage(fail); }
    finally { setBusy(null); }
  }
  async function saveChannel(event: FormEvent) {
    event.preventDefault();
    await act('channel', async () => {
      const result = await window.pokehub.streams.setChannel(platform, channel);
      if (result.ok) { setChannel(result.data.channel); setEditing(false); }
      return result;
    });
  }
  const unlink = (profile: Profile) => {
    if (!window.confirm(`Desvincular a ${nome} de “${profile.label}”? O PokéHub sai da conta da ${nome} nesta sessão e para de assistir. Seus pontos continuam na ${nome}.`)) return;
    void act(`unlink-${profile.id}`, () => window.pokehub.streams.unlink(platform, profile.id));
  };

  const accounts = new Map((info?.accounts ?? []).map(account => [account.profileId, account]));
  const watching = info?.accounts.filter(account => account.state === 'watching').length ?? 0;
  const earned = info?.accounts.reduce((sum, account) => sum + account.earned, 0) ?? 0;
  const hasChannel = Boolean(info?.channel);
  const showForm = !hasChannel || editing;

  return <div className="tw-inner" aria-busy={info === null}>
    <section className="tw-channel" aria-label="Canal">
      {showForm ? <form onSubmit={event => void saveChannel(event)}>
        <label htmlFor="tw-channel-input">Canal da live</label>
        <div className="tw-input"><span aria-hidden="true">{platform === 'kick' ? 'kick.com/' : 'twitch.tv/'}</span><input id="tw-channel-input" value={channel} maxLength={80} placeholder="nome_do_canal" autoComplete="off" spellCheck={false} onChange={event => setChannel(event.target.value)}/></div>
        <div className="tw-row"><button className="primary" type="submit" disabled={busy !== null || channel.trim() === (info?.channel ?? '')}><Icon d={icons.check}/>Salvar</button>{hasChannel && <button type="button" onClick={() => { setChannel(info?.channel ?? ''); setEditing(false); }}>Cancelar</button>}</div>
        <p className="tw-hint">O canal oficial na {nome} que dá os pontos para os boosters. Pode colar o link do canal.</p>
      </form>
      : <div className="tw-channel-now"><Icon d={icons.tv}/><div><small>Canal</small><strong title={`${platform === 'kick' ? 'kick.com' : 'twitch.tv'}/${info?.channel}`}>{info?.channel}</strong></div><button className="icon" aria-label="Trocar canal" title="Trocar canal" onClick={() => setEditing(true)}><Icon d={icons.edit}/></button></div>}
      {hasChannel && !showForm && <div className="tw-browser">
        <button className={platform === 'twitch' ? 'primary' : undefined} disabled={busy !== null} title={`Abre ${platform === 'kick' ? 'kick.com' : 'twitch.tv'}/${info?.channel} no seu navegador padrão, onde você já está logado`} onClick={() => void act('browser', () => window.pokehub.streams.browser(platform))}><Icon d={icons.link}/>Assistir no navegador</button>
        {platform === 'twitch' && <p className="tw-hint">A Twitch está bloqueando o login dentro do PokéHub. Assista pelo seu navegador (logado na sua conta): os pontos contam do mesmo jeito. Deixe a aba aberta, pode ser minimizada e sem som.</p>}
      </div>}
    </section>

    {hasChannel && (info?.accounts.length ?? 0) > 0 && <div className="tw-summary" role="status">
      <span><b data-on={watching > 0 || undefined}/>{watching} de {info?.accounts.length} assistindo</span>
      <span className="tw-earned">+{full.format(earned)} <small>pts nesta sessão</small></span>
    </div>}

    {message && <p className="tw-error" role="alert">{message}</p>}

    <ul className="tw-list" aria-label="Contas">
      {profiles.map((profile, index) => {
        const account = accounts.get(profile.id);
        return <TwitchCard key={profile.id} index={index} profile={profile} account={account} now={now} busy={busy} hasChannel={hasChannel} nome={nome} hint={hint} canClaim={platform === 'twitch'}
          onLink={() => void act(`link-${profile.id}`, () => window.pokehub.streams.link(platform, profile.id))}
          onShow={() => void act(`show-${profile.id}`, () => account?.visible ? window.pokehub.streams.hide(platform, profile.id) : window.pokehub.streams.show(platform, profile.id))}
          onRewards={() => void act(`rewards-${profile.id}`, () => window.pokehub.streams.rewards(platform, profile.id))}
          onPatch={patch => void act(`patch-${profile.id}`, () => window.pokehub.streams.update(platform, profile.id, patch))}
          onUnlink={() => unlink(profile)}/>;
      })}
    </ul>

    <p className="side-foot">A janela da {nome} fica oculta, muda e em {platform === 'kick' ? 'qualidade baixa (banda limitada)' : '160p'}; fechar só a esconde. Os pontos contam com o PokéHub aberto (pode ficar na bandeja). O resgate dos boosters é sempre seu, em <b>Recompensas</b>.</p>
  </div>;
}

function TwitchCard({profile, account, index, now, busy, hasChannel, nome, hint, canClaim, onLink, onShow, onRewards, onPatch, onUnlink}: {profile: Profile; account: TwitchAccount | undefined; index: number; now: number; busy: string | null; hasChannel: boolean; nome: string; hint: Partial<Record<TwitchState, string>>; canClaim: boolean; onLink: () => void; onShow: () => void; onRewards: () => void; onPatch: (patch: Partial<Pick<TwitchAccount, 'enabled' | 'autoClaim' | 'sound'>>) => void; onUnlink: () => void}) {
  const style = {'--c': profile.colorToken, '--i': index} as CSSProperties;
  const locked = busy !== null;
  if (!account) return <li className="tw-card" data-empty="" style={style}>
    <div className="tw-head"><El color={profile.colorToken}/><strong title={profile.label}>{profile.label}</strong><span className="tw-who">Sem {nome}</span></div>
    <p className="tw-note">Vincule uma conta da {nome} a esta conta do jogo para ganhar pontos do canal.</p>
    <button className="primary" disabled={locked} onClick={onLink}><Icon d={icons.link}/>Vincular {nome}</button>
  </li>;
  const [text, dot] = stateText[account.state];
  const watching = account.state === 'watching';
  const showRewards = hasChannel && account.login !== null;
  return <li className="tw-card" data-state={account.state} style={style}>
    <div className="tw-head"><El color={profile.colorToken}/><strong title={profile.label}>{profile.label}</strong><span className="tw-who" title={account.login ? `Conta da ${nome}: ${account.login}` : `Ainda não entrou na ${nome}`}>{account.login ? (account.login === 'conta' ? 'logada' : `@${account.login}`) : 'não logada'}</span></div>
    <div className="tw-stat">
      <div className="tw-balance"><small>Pontos do canal</small><span>{account.balance === null ? '—' : full.format(account.balance)}</span>{account.earned > 0 && <em>+{full.format(account.earned)}</em>}</div>
      <div className="tw-status"><span className="st" data-state={dot}><b/></span><span>{text}</span>{watching && account.since && <small>há {since(account.since, now)}</small>}{watching && <span className="tw-live">AO VIVO</span>}</div>
    </div>
    {hint[account.state] && <p className="tw-note">{hint[account.state]}</p>}
    <div className="tw-opts" role="group" aria-label={`Opções da ${nome} de ${profile.label}`}>
      <button className="opt" aria-pressed={account.enabled} disabled={locked} title={account.enabled ? 'Assistindo em segundo plano' : 'Pausado: não abre o canal nesta conta'} onClick={() => onPatch({enabled: !account.enabled})}><Icon d={account.enabled ? icons.check : icons.minus}/>Assistir</button>
      {canClaim && <button className="opt" aria-pressed={account.autoClaim} disabled={locked} title="Coleta o baú de bônus do canal quando ele aparecer" onClick={() => onPatch({autoClaim: !account.autoClaim})}><Icon d={icons.gift}/>Baú{account.claimed > 0 ? ` · ${account.claimed}` : ''}</button>}
      <button className="opt" aria-pressed={account.sound} disabled={locked} title={`Som quando a janela da ${nome} estiver à vista (oculta é sempre muda)`} onClick={() => onPatch({sound: !account.sound})}><Icon d={account.sound ? icons.sound : icons.mute}/>Som</button>
    </div>
    <div className="tw-actions">
      {account.login === null ? <button className="secondary" disabled={locked} onClick={onShow}><Icon d={icons.link}/><span>Entrar na {nome}</span></button>
        : <button disabled={locked} aria-pressed={account.visible} onClick={onShow}><Icon d={icons.tv}/><span>{account.visible ? 'Esconder' : 'Ver'}</span></button>}
      {showRewards && <button className="primary" disabled={locked} title="Abre a janela no painel de recompensas do canal; você escolhe o booster" onClick={onRewards}><Icon d={icons.gift}/><span>Recompensas</span></button>}
      <button className="icon" disabled={locked} aria-label={`Desvincular a ${nome} de ${profile.label}`} title="Desvincular" onClick={onUnlink}><Icon d={icons.unlink}/></button>
    </div>
  </li>;
}
