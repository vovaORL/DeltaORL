import { Candle, LiveTick, DOMTuple, EngineStats, VolumeProfileLevel } from '../types';

type MessageHandler<T> = (data: T) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string = 'ws://127.0.0.1:9191';
  private reconnectTimer: number | null = null;
  private isConnected: boolean = false;

  private onSnapshotHandlers: MessageHandler<{ symbol: string; tick_size: number; timeframe: number; candles: Candle[] }>[] = [];
  private onCandleUpdateHandlers: MessageHandler<{ symbol: string; timeframe?: number; candles?: Candle[]; candle: Candle }>[] = [];
  private onTickHandlers: MessageHandler<LiveTick>[] = [];
  private onDOMHandlers: MessageHandler<DOMTuple[]>[] = [];
  private onStatsHandlers: MessageHandler<EngineStats>[] = [];
  private onProfileHandlers: MessageHandler<VolumeProfileLevel[]>[] = [];
  private onMT5TerminalsHandlers: MessageHandler<import('../types').MT5TerminalInfo[]>[] = [];
  private onMT5LoadResultHandlers: MessageHandler<{ count: number; symbol: string; msg?: string }>[] = [];
  private onInstallEAResultHandlers: MessageHandler<{ success: boolean; destination: string }>[] = [];
  private onErrorHandlers: MessageHandler<{ msg: string }>[] = [];
  private onConnectionChangeHandlers: ((connected: boolean) => void)[] = [];

  constructor() {
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyConnection(true);
        this.getSnapshot();
        this.getMT5Terminals();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[WSClient] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyConnection(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private notifyConnection(status: boolean) {
    this.onConnectionChangeHandlers.forEach(cb => cb(status));
  }

  private handleMessage(data: any) {
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'error':
        this.onErrorHandlers.forEach(cb => cb(data));
        break;
      case 'snapshot':
        this.onSnapshotHandlers.forEach(cb => cb(data));
        break;
      case 'candle_update':
        this.onCandleUpdateHandlers.forEach(cb => cb(data));
        break;
      case 'tick':
        this.onTickHandlers.forEach(cb => cb(data));
        break;
      case 'dom':
        this.onDOMHandlers.forEach(cb => cb(data.levels));
        break;
      case 'stats':
        this.onStatsHandlers.forEach(cb => cb(data));
        break;
      case 'profile':
        this.onProfileHandlers.forEach(cb => cb(data.levels));
        break;
      case 'mt5_terminals':
        this.onMT5TerminalsHandlers.forEach(cb => cb(data.terminals));
        break;
      case 'mt5_load_result':
        this.onMT5LoadResultHandlers.forEach(cb => cb(data));
        break;
      case 'install_ea_result':
        this.onInstallEAResultHandlers.forEach(cb => cb(data));
        break;
    }
  }

  public send(obj: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  public getSnapshot() {
    this.send({ action: 'get_snapshot' });
  }

  public setSymbol(symbol: string) {
    this.send({ action: 'set_symbol', symbol });
  }

  public setTimeframe(timeframe: number) {
    this.send({ action: 'set_timeframe', timeframe });
  }

  public setImbalance(ratio: number, minVol: number) {
    this.send({ action: 'set_imbalance', ratio, min_vol: minVol });
  }

  public getMT5Terminals() {
    this.send({ action: 'get_mt5_terminals' });
  }

  public loadMT5Path(path: string, symbol: string) {
    this.send({ action: 'load_mt5_path', path, symbol });
  }

  public installEA(path: string) {
    this.send({ action: 'install_ea', path });
  }

  private subscribe<T>(handlers: MessageHandler<T>[], cb: MessageHandler<T>) {
    handlers.push(cb);
    return () => {
      const index = handlers.indexOf(cb);
      if (index >= 0) handlers.splice(index, 1);
    };
  }

  public onError(cb: MessageHandler<{ msg: string }>) {
    return this.subscribe(this.onErrorHandlers, cb);
  }

  // Subscribe methods
  public onSnapshot(cb: MessageHandler<{ symbol: string; tick_size: number; timeframe: number; candles: Candle[] }>) {
    return this.subscribe(this.onSnapshotHandlers, cb);
  }
  public onCandleUpdate(cb: MessageHandler<{ symbol: string; timeframe?: number; candles?: Candle[]; candle: Candle }>) {
    return this.subscribe(this.onCandleUpdateHandlers, cb);
  }
  public onTick(cb: MessageHandler<LiveTick>) {
    return this.subscribe(this.onTickHandlers, cb);
  }
  public onDOM(cb: MessageHandler<DOMTuple[]>) {
    return this.subscribe(this.onDOMHandlers, cb);
  }
  public onStats(cb: MessageHandler<EngineStats>) {
    return this.subscribe(this.onStatsHandlers, cb);
  }
  public onProfile(cb: MessageHandler<VolumeProfileLevel[]>) {
    return this.subscribe(this.onProfileHandlers, cb);
  }
  public onMT5Terminals(cb: MessageHandler<import('../types').MT5TerminalInfo[]>) {
    return this.subscribe(this.onMT5TerminalsHandlers, cb);
  }
  public onMT5LoadResult(cb: MessageHandler<{ count: number; symbol: string; msg?: string }>) {
    return this.subscribe(this.onMT5LoadResultHandlers, cb);
  }
  public onInstallEAResult(cb: MessageHandler<{ success: boolean; destination: string }>) {
    return this.subscribe(this.onInstallEAResultHandlers, cb);
  }
  public onConnectionChange(cb: (connected: boolean) => void) {
    const unsubscribe = this.subscribe(this.onConnectionChangeHandlers, cb);
    cb(this.isConnected);
    return unsubscribe;
  }
}

export const wsService = new WSClient();
