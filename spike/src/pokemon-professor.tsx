import { useState, type FormEvent } from 'react';
import { assessPokemon } from '../domain/pokemon-assessment';
import type { Profile } from '../domain/profiles';
import { Professor, type Mood } from './icons';
import { PokemonTeam } from './pokemon-team';

const stats = ['HP', 'Ataque', 'Defesa', 'Ataque especial', 'Defesa especial', 'Velocidade'] as const;

export function PokemonProfessor({onClose,profiles,states}:{onClose:()=>void; profiles?:Profile[]; states?:Record<string,string>}) {
 const hasTeam = Boolean(profiles?.length);
 const [view,setView] = useState<'team'|'manual'>(hasTeam ? 'team' : 'manual');
 const [name,setName] = useState('');
 const [power,setPower] = useState('');
 const [ivs,setIvs] = useState<string[]>(() => stats.map(() => ''));
 const [submitted,setSubmitted] = useState(false);
 const result = assessPokemon(ivs.map(value => value.trim() === '' ? NaN : Number(value)));
 const validPower = /^[1-5]$/.test(power);
 const submit = (event:FormEvent) => {event.preventDefault();setSubmitted(true);};
 const manual = view === 'manual' || !profiles;
 const head = (mood:Mood, say:string, busy = false) => <header className="grind-head prof-head"><Professor mood={mood} busy={busy}/>
  <div aria-live="polite"><h1>Professor Grindolino</h1><p key={say} className="quote" data-mood={mood}>{say}</p></div>
  <div className="head-actions">{hasTeam && <div className="seg" role="group" aria-label="Visão"><button aria-pressed={!manual} onClick={() => setView('team')}>Equipe</button><button aria-pressed={manual} onClick={() => setView('manual')}>Informar IVs</button></div>}
   <button onClick={onClose}>Voltar</button></div></header>;
 return <section className={`panel pokemon-professor${hasTeam ? ' grind' : ''}`}>
  {manual ? head('happy','Vamos conhecer seu Pokémon?') : <PokemonTeam profiles={profiles} states={states ?? {}} head={head}/>}
  {manual && <div className="pokemon-manual">
  <p>Informe os dados mostrados pelo jogo. O Professor compara a soma dos IVs com o máximo possível e apresenta a potência separadamente.</p>
  <form onSubmit={submit} noValidate>
   <div className="pokemon-fields"><label>Nome do Pokémon (opcional)<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Ex.: Charizard"/></label>
    <label>Potência<select value={power} onChange={event => setPower(event.target.value)}><option value="">Selecione</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>P{n}</option>)}</select></label></div>
   <fieldset><legend>IVs por atributo</legend><p>Digite um número inteiro de 1 a 32 em cada campo.</p><div className="pokemon-ivs">{stats.map((stat,index) => <label key={stat}>{stat}<input type="number" inputMode="numeric" min={1} max={32} step={1} value={ivs[index]} onChange={event => {const value=event.target.value;setIvs(old => old.map((item,i) => i === index ? value : item));}}/></label>)}</div></fieldset>
   <button className="primary">Avaliar Pokémon</button>
  </form>
  {submitted && (!result || !validPower) && <p role="alert">Selecione a potência e preencha os seis IVs com valores inteiros de 1 a 32.</p>}
  {submitted && result && validPower && <section className="pokemon-result" aria-live="polite"><h2>{name.trim() || 'Seu Pokémon'}</h2><p><strong>IV total: {result.total} / 192</strong> · {new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(result.percent)}% do máximo</p><p>Potência: <strong>P{power}</strong> de P1 a P5.</p><p>Esse resultado descreve os IVs e a potência informados. A força em combate também depende de espécie, nível, golpes e outros fatores; ele não prevê dano nem valor de mercado.</p></section>}
  <p className="note">Fonte dos limites: informações públicas do PokéIdle. Os dados digitados nesta tela não são salvos.</p>
  </div>}
 </section>;
}
