// Twitch em segundo plano: uma conta da Twitch por conta do PokéIdle, assistindo o canal escolhido para acumular pontos do canal.
/**
 * off: desligado pelo usuário · login: falta entrar na Twitch · starting: abrindo o canal · watching: ao vivo e contando
 * offline: canal fora do ar · attention: o player pede um clique (aviso de conteúdo, erro) · duplicate: a mesma conta da Twitch
 * já está ligada em outro perfil · no_channel: nenhum canal definido · error: a página falhou
 */
export type TwitchState = 'off' | 'login' | 'starting' | 'watching' | 'offline' | 'attention' | 'duplicate' | 'no_channel' | 'error';
export interface TwitchAccount {
  profileId: string;
  /** Assistir em segundo plano (persistido). */
  enabled: boolean;
  /** Coletar o baú de bônus sozinho (persistido; desligado por padrão). */
  autoClaim: boolean;
  /** Som quando a janela da Twitch está à vista (persistido; escondida ela é sempre muda). */
  sound: boolean;
  /** Nome de usuário da Twitch lido do cookie de sessão; null = não entrou. */
  login: string | null;
  state: TwitchState;
  /** Saldo de pontos do canal na última leitura; null = ainda não lido. */
  balance: number | null;
  /** Pontos ganhos desde que o PokéHub abriu o canal nesta conta. */
  earned: number;
  /** Baús coletados automaticamente nesta execução. */
  claimed: number;
  /** Desde quando está assistindo ao vivo (ISO); null se não está. */
  since: string | null;
  /** A janela da Twitch desta conta está à vista. */
  visible: boolean;
}
export interface TwitchInfo { channel: string; accounts: TwitchAccount[] }
