/** Loose simulation event: sims push these, presentation (view/audio/HUD/haptics) consumes them. */
export interface SimEvent { type: string; [k: string]: any }
type Handler = (payload: any) => void;
export class Bus {
  private map = new Map<string, Set<Handler>>();
  on(type: string, fn: Handler) { let s = this.map.get(type); if (!s) this.map.set(type, (s = new Set())); s.add(fn); return () => s!.delete(fn); }
  emit(type: string, payload?: any) { this.map.get(type)?.forEach((fn) => fn(payload)); }
}
