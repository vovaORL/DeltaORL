// Bid chart transport; legacy 1.00 historical/live side classifiers are preserved.
#property copyright "DeltaORL"
#property version "1.20"
#include "DeltaBridgeCore.mqh"
input string InpServerIP = "127.0.0.1";
input int InpServerPort = 9190;
input int InpHistoryDays = 2;
input bool InpSendBook = false;
input bool InpAudit = true;

const int HISTORY_LIMIT = 200000;
const ulong COPY_WINDOW_MS = 3600000;
int g_socket = INVALID_HANDLE;
ulong g_lastConnectAttempt = 0;
long g_cursorMs = 0, g_readThrough = 0;
MqlTick g_boundary[];
LegacySideState g_historySide, g_liveSide;
string g_commands = "", g_session = "";
bool g_ready = false;
int g_audit = INVALID_HANDLE, g_events = INVALID_HANDLE;
long g_sequence = 0, g_sourceSequence = 0, g_sent = 0, g_invalid = 0;

void CloseSocket()
{
   if(g_socket != INVALID_HANDLE) SocketClose(g_socket);
   g_socket = INVALID_HANDLE;
   g_ready = false;
}
bool AuditEvent(const string event, const string detail)
{
   Print("DeltaBridge ", g_session, " ", event, " ", detail);
   if(g_events != INVALID_HANDLE)
   {
      if(FileWrite(g_events, g_session, event, detail) == 0)
      {
         Print("DeltaBridge: event audit write failed; closing session");
         CloseSocket();
         return false;
      }
      FileFlush(g_events);
   }
   return true;
}
bool FailSession(const string detail)
{
   AuditEvent("session_failed", detail);
   CloseSocket();
   return false;
}
bool SendText(const string text)
{
   if(g_socket == INVALID_HANDLE) return false;
   uchar data[];
   int length = StringToCharArray(text, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   int offset = 0;
   while(offset < length)
   {
      uchar part[];
      ArrayCopy(part, data, 0, offset, length - offset);
      int sent = SocketSend(g_socket, part, ArraySize(part));
      if(sent <= 0) return FailSession("send_failed; full replay required; delivery unconfirmed");
      offset += sent;
   }
   return true;
}
string SideSource(const MqlTick &tick, const int side)
{
   if((tick.flags & (TICK_FLAG_BUY | TICK_FLAG_SELL)) != 0) return "trade_flag";
   return side == 0 ? "unknown" : "heuristic";
}
string FormatTickLine(const MqlTick &tick, const int side)
{
   return StringFormat("TICK;%s;%I64d;%.12f;%.8f;%d;%.12f;%.12f\n", _Symbol,
                       tick.time_msc, ChartPrice(tick), LegacyVolume(tick), side, tick.bid, tick.ask);
}
bool AuditTick(const MqlTick &tick, const int side, const string phase, const bool valid)
{
   g_sequence++; g_sourceSequence++;
   if(valid) g_sent++; else g_invalid++;
   if(g_audit == INVALID_HANDLE) return true;
   if(FileWrite(g_audit, g_session, g_sequence, g_sourceSequence, phase, tick.time_msc,
             DoubleToString(tick.bid, 12), DoubleToString(tick.ask, 12), DoubleToString(tick.last, 12),
             tick.volume, DoubleToString(tick.volume_real, 8), tick.flags,
             DoubleToString(ChartPrice(tick), 12), DoubleToString(LegacyVolume(tick), 8),
             side, SideSource(tick, side), valid ? "sent" : "invalid", InvalidBidReason(tick)) == 0)
      return FailSession("tick_audit_write_failed");
   return true;
}
bool CommitCursor(const MqlTick &tick)
{
   if(tick.time_msc < g_cursorMs) return FailSession("cursor_regression");
   if(tick.time_msc > g_cursorMs)
   {
      g_cursorMs = tick.time_msc;
      ArrayResize(g_boundary, 0);
   }
   int n = ArraySize(g_boundary);
   if(ArrayResize(g_boundary, n + 1, 256) != n + 1) return FailSession("boundary_allocation_failed");
   g_boundary[n] = tick;
   return true;
}
bool OpenAudit()
{
   if(g_audit != INVALID_HANDLE) FileClose(g_audit);
   if(g_events != INVALID_HANDLE) FileClose(g_events);
   g_audit = INVALID_HANDLE; g_events = INVALID_HANDLE;
   if(!InpAudit) return true;
   string root = "DeltaBridge\\" + g_session;
   g_audit = FileOpen(root + "-ticks.csv", FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',', CP_UTF8);
   g_events = FileOpen(root + "-events.csv", FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',', CP_UTF8);
   if(g_audit == INVALID_HANDLE || g_events == INVALID_HANDLE) return FailSession("audit_open_failed");
   FileWrite(g_audit, "session", "sequence", "source_sequence", "phase", "time_msc", "bid", "ask", "last", "raw_volume",
             "volume_real", "flags", "chart_price", "volume", "side", "side_source", "disposition", "invalid_reason");
   FileWrite(g_events, "session", "event", "detail");
   return true;
}
// Keep the complete last-millisecond source prefix, including records outside the retained history.
bool LoadBoundary(const MqlTick &expected[])
{
   int expectedCount = ArraySize(expected);
   long boundaryMs = expected[0].time_msc;
   MqlTick boundary[];
   ResetLastError();
   int count = CopyTicksRange(_Symbol, boundary, COPY_TICKS_ALL, (ulong)boundaryMs, (ulong)boundaryMs);
   int error = GetLastError();
   if(count < expectedCount || error != 0) return FailSession(StringFormat("boundary_copy_failed;count=%d;error=%d", count, error));
   for(int i = 0; i < expectedCount; i++)
      if(!SameSourceTick(expected[i], boundary[i])) return FailSession("history_boundary_changed");
   // Only this verified prefix belongs to the snapshot; appended records remain live.
   if(ArrayCopy(g_boundary, expected) != expectedCount) return FailSession("boundary_allocation_failed");
   g_cursorMs = boundaryMs;
   return true;
}
bool SendHistoricalTicks()
{
   MqlTick latest;
   if(!SymbolInfoTick(_Symbol, latest) || latest.time_msc <= 0) return FailSession("no_source_tick");
   long end = latest.time_msc;
   long start = InpHistoryDays > 0 ? ((end / 1000 - (long)InpHistoryDays * 86400) / 900) * 900000 : end;
   if(start <= 0) return FailSession("invalid_history_start");
   MqlTick history[];
   int sides[];
   if(ArrayResize(history, HISTORY_LIMIT) != HISTORY_LIMIT || ArrayResize(sides, HISTORY_LIMIT) != HISTORY_LIMIT)
      return FailSession("history_allocation_failed");
   long total = 0, lastTime = 0, sourceInvalid = 0;
   MqlTick snapshotBoundary[];
   for(long from = start; from <= end;)
   {
      long to = MathMin(from + (long)COPY_WINDOW_MS - 1, end);
      MqlTick chunk[];
      ResetLastError();
      int count = CopyTicksRange(_Symbol, chunk, COPY_TICKS_ALL, (ulong)from, (ulong)to);
      int error = GetLastError();
      if(count < 0 || error != 0)
         return FailSession(StringFormat("history_copy_failed;from=%I64d;to=%I64d;count=%d;error=%d;coverage=unverified", from, to, count, error));
      for(int i = 0; i < count; i++)
      {
         if(chunk[i].time_msc < from || chunk[i].time_msc > to || chunk[i].time_msc < lastTime)
            return FailSession(StringFormat("history_order_or_range_error;time_msc=%I64d;previous=%I64d", chunk[i].time_msc, lastTime));
         if(chunk[i].time_msc != lastTime) ArrayResize(snapshotBoundary, 0);
         int boundaryCount = ArraySize(snapshotBoundary);
         if(ArrayResize(snapshotBoundary, boundaryCount + 1, 256) != boundaryCount + 1) return FailSession("boundary_allocation_failed");
         snapshotBoundary[boundaryCount] = chunk[i];
         lastTime = chunk[i].time_msc;
         if(!ValidBidTick(chunk[i])) sourceInvalid++;
         int index = (int)(total % HISTORY_LIMIT);
         history[index] = chunk[i];
         // Invalid records are audited but cannot poison the price/side state of valid records.
         sides[index] = ValidBidTick(chunk[i]) ? DetermineHistoricalSideLegacy(chunk[i], g_historySide) : 0;
         total++;
      }
      from = to + 1;
      if(IsStopped()) return FailSession("stopped_during_history");
   }
   if(total == 0) return FailSession("empty_history;coverage=unverified");
   if(!LoadBoundary(snapshotBoundary)) return false;
   int retained = (int)MathMin(total, (long)HISTORY_LIMIT);
   long dropped = total - retained;
   g_sourceSequence = dropped;
   for(int offset = 0; offset < retained;)
   {
      int size = MathMin(500, retained - offset);
      string batch = "";
      for(int j = 0; j < size; j++)
      {
         int index = (int)((dropped + offset + j) % HISTORY_LIMIT);
         if(ValidBidTick(history[index])) batch += FormatTickLine(history[index], sides[index]);
      }
      if(!SendText(batch)) return false;
      for(int j = 0; j < size; j++)
      {
         int index = (int)((dropped + offset + j) % HISTORY_LIMIT);
         if(!AuditTick(history[index], sides[index], "history", ValidBidTick(history[index]))) return false;
      }
      offset += size;
   }
   if(g_audit != INVALID_HANDLE) FileFlush(g_audit);
   if(!AuditEvent("history", StringFormat("request_ok=1;coverage=unverified;requested_from=%I64d;requested_to=%I64d;source_count=%I64d;retained=%d;dropped=%I64d;first_retained=%I64d;sent=%I64d;invalid=%I64d;source_invalid=%I64d;history_enabled=%d",
              start, end, total, retained, dropped, history[(int)(dropped % HISTORY_LIMIT)].time_msc, g_sent, g_invalid, sourceInvalid, InpHistoryDays > 0 ? 1 : 0))) return false;
   // READY is transport readiness, never a claim of complete broker history.
   g_ready = SendText("READY\n");
   if(g_ready && !AuditEvent("ready", "coverage=unverified;side_without_flags=heuristic;price=Bid")) return false;
   return g_ready;
}
bool BeginSession()
{
   g_ready = false;
   g_cursorMs = 0; g_readThrough = 0; ArrayResize(g_boundary, 0);
   ResetLegacySide(g_historySide); ResetLegacySide(g_liveSide);
   g_sequence = 0; g_sourceSequence = 0; g_sent = 0; g_invalid = 0;
   g_session = StringFormat("%I64d-%I64u-%I64d", (long)TimeLocal(), GetMicrosecondCount(), ChartID());
   if(!OpenAudit()) return false;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(SymbolInfoInteger(_Symbol, SYMBOL_CHART_MODE) != SYMBOL_CHART_MODE_BID || !MathIsValidNumber(step) || step <= 0)
      return FailSession("requires_Bid_chart_and_valid_broker_tick_size");
   if(!AuditEvent("session", StringFormat("symbol=%s;digits=%d;point=%.12f;tick_size=%.12f;chart=Bid", _Symbol, _Digits, _Point, step))) return false;
   if(!SendText("INFO;" + AccountInfoString(ACCOUNT_COMPANY) + " (DeltaBridge 1.20 Bid;session=" + g_session + ")\n")) return false;
   if(!SendText(StringFormat("HELLO;%s;%.12f;%d\n", _Symbol, step, _Digits))) return false;
   return SendHistoricalTicks();
}
bool ConnectToEngine()
{
   CloseSocket(); g_commands = "";
   g_socket = SocketCreate();
   if(g_socket == INVALID_HANDLE) return false;
   if(!SocketConnect(g_socket, InpServerIP, InpServerPort, 1000)) { CloseSocket(); return false; }
   return BeginSession();
}
void SendLiveTicks()
{
   if(!g_ready || g_socket == INVALID_HANDLE) return;
   MqlTick latest;
   if(!SymbolInfoTick(_Symbol, latest) || latest.time_msc < g_cursorMs) { FailSession("live_source_regressed"); return; }
   // Bound each read in time; backlog is drained by the timer without skipping records.
   long to = MathMin(latest.time_msc, (long)MathMax(g_cursorMs, g_readThrough) + (long)COPY_WINDOW_MS);
   MqlTick ticks[];
   ResetLastError();
   int count = CopyTicksRange(_Symbol, ticks, COPY_TICKS_ALL, (ulong)g_cursorMs, (ulong)to);
   int error = GetLastError();
   if(count < 0 || error != 0) { FailSession(StringFormat("live_copy_failed;count=%d;error=%d", count, error)); return; }
   int boundarySize = ArraySize(g_boundary);
   if(count < boundarySize) { FailSession("live_boundary_missing"); return; }
   for(int i = 0; i < boundarySize; i++)
      if(!SameSourceTick(ticks[i], g_boundary[i])) { FailSession("live_boundary_changed"); return; }
   long previous = g_cursorMs;
   for(int i = boundarySize; i < count; i++)
   {
      if(ticks[i].time_msc < previous || ticks[i].time_msc > to) { FailSession("live_order_or_range_error"); return; }
      previous = ticks[i].time_msc;
   }
   for(int offset = boundarySize; offset < count;)
   {
      int size = MathMin(500, count - offset);
      string batch = "";
      int sides[];
      if(ArrayResize(sides, size) != size) { FailSession("live_allocation_failed"); return; }
      for(int j = 0; j < size; j++)
      {
         bool valid = ValidBidTick(ticks[offset + j]);
         sides[j] = valid ? DetermineLiveSideLegacy(ticks[offset + j], g_liveSide) : 0;
         if(valid) batch += FormatTickLine(ticks[offset + j], sides[j]);
      }
      if(!SendText(batch)) return;
      for(int j = 0; j < size; j++)
      {
         if(!CommitCursor(ticks[offset + j])) return;
         if(!AuditTick(ticks[offset + j], sides[j], "live", ValidBidTick(ticks[offset + j]))) return;
      }
      offset += size;
   }
   g_readThrough = to;
   if(g_audit != INVALID_HANDLE) FileFlush(g_audit);
}
void ReadCommands()
{
   uint available = SocketIsReadable(g_socket);
   if(available == 0) return;
   uchar bytes[];
   int n = SocketRead(g_socket, bytes, MathMin(available, 16384), 10);
   if(n <= 0) return;
   g_commands += CharArrayToString(bytes, 0, n, CP_UTF8);
   if(StringLen(g_commands) > 65536) { g_commands = ""; return; }
   int end;
   while((end = StringFind(g_commands, "\n")) >= 0)
   {
      string line = StringSubstr(g_commands, 0, end);
      g_commands = StringSubstr(g_commands, end + 1);
      if(StringFind(line, "SWITCH;") == 0)
      {
         string symbol = StringSubstr(line, 7);
         if(!SymbolSelect(symbol, true)) SendText("ERROR;" + symbol + ";Символ недоступний у MT5.\n");
         else if(symbol == _Symbol) BeginSession();
         else if(!ChartSetSymbolPeriod(0, symbol, _Period)) SendText("ERROR;" + symbol + ";Не вдалося змінити символ графіка MT5.\n");
      }
      else if(StringFind(line, "RELOAD") == 0) BeginSession();
      else if(StringFind(line, "PATH;") == 0)
         SendText("ERROR;" + _Symbol + ";DeltaBridge працює в поточному MT5. Для зміни термінала від'єднайте радника та використайте Python feeder.\n");
   }
}

void OnBookEvent(const string &symbol)
{
   if(!InpSendBook || symbol != _Symbol || !g_ready) return;
   MqlBookInfo book[];
   if(!MarketBookGet(symbol, book)) return;
   string rows = "";
   int count = 0;
   for(int i = 0; i < ArraySize(book) && count < 200; i++)
   {
      if(book[i].type != BOOK_TYPE_BUY && book[i].type != BOOK_TYPE_SELL) continue;
      double volume = book[i].volume_real > 0 ? book[i].volume_real : (double)book[i].volume;
      rows += StringFormat(";%.12f,%.8f,%d", book[i].price, volume, book[i].type == BOOK_TYPE_BUY ? 1 : 2);
      count++;
   }
   SendText(StringFormat("DOM;%s;%d", symbol, count) + rows + "\n");
}
int OnInit()
{
   if(InpHistoryDays < 0 || InpHistoryDays > 365 || InpServerPort < 1 || InpServerPort > 65535)
      return INIT_PARAMETERS_INCORRECT;
   ConnectToEngine();
   if(InpSendBook) MarketBookAdd(_Symbol);
   EventSetMillisecondTimer(250);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(InpSendBook) MarketBookRelease(_Symbol);
   AuditEvent("closed", StringFormat("reason=%d;sent=%I64d;invalid=%I64d", reason, g_sent, g_invalid));
   CloseSocket();
   if(g_audit != INVALID_HANDLE) FileClose(g_audit);
   if(g_events != INVALID_HANDLE) FileClose(g_events);
}
void OnTimer()
{
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
   {
      if(GetTickCount64() - g_lastConnectAttempt >= 2000)
      {
         g_lastConnectAttempt = GetTickCount64();
         ConnectToEngine();
      }
      return;
   }
   ReadCommands();
   SendLiveTicks();
}
void OnTick() { SendLiveTicks(); }
