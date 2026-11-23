// Texto da confirmação NATIVA da permissão "Pode controlar a tela" (R5): precisa dizer, sem rodeio, o que isto libera.
export const controlDialog = (name: string, value: boolean) => ({
  title: 'PokéHub — permissão de controlar a tela',
  message: `${value ? 'Permitir' : 'Bloquear'} que “${name}” CONTROLE a tela das suas contas?`,
  detail: value ? 'Com esta permissão o celular terá controle total: poderá fazer TUDO o que o jogo permite naquela conta, em tempo real, inclusive gastar gemas e ouro SEM o teto diário, usar o Community Market, vender e trocar. Nenhum limite do PokéHub vale nesse modo (só o PIN é pedido). Ver a tela ao vivo continua funcionando sem esta permissão. Só permita para um aparelho seu.' : 'O celular continua podendo ver a tela (se tiver permissão), mas não controla mais. O controle em andamento termina agora.',
  confirmLabel: value ? 'Permitir controle total' : 'Bloquear',
});
