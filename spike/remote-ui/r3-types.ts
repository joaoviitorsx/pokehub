// Contrato R3 (capturas, alertas, push) como o celular o enxerga. Idêntico ao de spike/contracts/remote.ts; deduplicar no merge.
export interface RemoteCaptureBase { profileId: string; name: string; level: number | null; time: string; at: string; potencia: number | null; iv: number | null; quality: number | null; nota: number | null; shiny: boolean; record: boolean }
export interface RemoteCapture extends RemoteCaptureBase { label: string; color: string }
export type AlertKind = 'shiny' | 'p5' | 'recorde' | 'nota' | 'conta_caiu' | 'conta_voltou';
export interface RemoteAlert { id: string; at: string; kind: AlertKind; profileId: string; label: string; text: string }
export interface AlertPrefs { shiny: boolean; p5: boolean; recorde: boolean; notaMin: number | null; contaCaiu: boolean }
export interface PushPayload { kind: AlertKind; label: string; text: string; at: string; url: string }
