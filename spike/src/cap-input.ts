// Entrada do teto diário (ouro) no painel do PC: aceita "150.000" ou "150000"; qualquer outra coisa é inválida.
export const CAP_INPUT_MAX = 1_000_000_000; // espelha MAX_CAP_GOLD (remote/store.ts; o renderer não importa o banco)
/** Só dígitos e pontos de milhar; 0 é válido (zera o teto). Devolve null se vazio, não numérico ou acima do máximo. */
export function parseCapInput(text: string): number | null {
  const digits = text.replace(/\./g, '');
  if (!/^\d{1,10}$/.test(digits)) return null;
  const n = Number(digits);
  return n <= CAP_INPUT_MAX ? n : null;
}
/** Tira do que foi digitado tudo que não é dígito ou ponto. */
export const cleanCapInput = (text: string): string => text.replace(/[^\d.]/g, '');
