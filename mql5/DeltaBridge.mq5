// DeltaORL MT5 bridge: tick history, live quotes, commands and real market depth.
#property copyright "DeltaORL"
#property version "1.10"
input string InpServerIP = "127.0.0.1";
input int InpServerPort = 9190;
input int InpHistoryDays = 2;
input bool InpSendBook = false;

int g_socket = INVALID_HANDLE;
ulong g_lastConnectAttempt = 0;
ulong g_cursorMs = 0;
int g_cursorCount = 0;
double g_previousPrice = 0;
int g_previousSide = 1;
string g_commands = "";
bool g_ready = false;

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
      if(sent <= 0)
      {
         SocketClose(g_socket);
         g_socket = INVALID_HANDLE;
         g_ready = false;
         return false;
      }
      offset += sent;
   }
   return true;
}

double ClusterStep()
{
   string symbol = _Symbol;
   StringToUpper(symbol);
   if(StringFind(symbol, "JPY") >= 0) return 0.01;
   if(StringFind(symbol, "XAU") >= 0 || StringFind(symbol, "GOLD") >= 0) return 0.10;
   if(StringFind(symbol, "XAG") >= 0 || StringFind(symbol, "SILVER") >= 0) return 0.01;
   if(StringFind(symbol, "BTC") >= 0) return 1.0;
   if(StringFind(symbol, "ETH") >= 0) return 0.10;
   if(StringFind(symbol, "SOL") >= 0 || StringFind(symbol, "BNB") >= 0) return 0.05;
   if(StringFind(symbol, "US30") >= 0 || StringFind(symbol, "DJI") >= 0 || StringFind(symbol, "DJ30") >= 0 || StringFind(symbol, "DOW") >= 0 || StringFind(symbol, "WALLSTREET") >= 0) return 1.0;
   if(StringFind(symbol, "NAS100") >= 0 || StringFind(symbol, "US100") >= 0 || StringFind(symbol, "USTEC") >= 0 || StringFind(symbol, "NDX") >= 0 || StringFind(symbol, "TECH") >= 0) return 0.25;
   if(StringFind(symbol, "US500") >= 0 || StringFind(symbol, "SPX") >= 0 || StringFind(symbol, "SP500") >= 0) return 0.10;
   if(StringFind(symbol, "GER40") >= 0 || StringFind(symbol, "DAX") >= 0) return 0.50;
   if(StringFind(symbol, "OIL") >= 0 || StringFind(symbol, "WTI") >= 0 || StringFind(symbol, "BRENT") >= 0) return 0.01;
   if(StringFind(symbol, "GAS") >= 0) return 0.005;
   if(_Digits == 4 || _Digits == 5) return 0.0001;
   if(_Digits == 2 || _Digits == 3) return 0.01;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   return step > 0 ? step : _Point;
}

string TickLine(const MqlTick &tick)
{
   if((ulong)tick.time_msc > g_cursorMs)
   {
      g_cursorMs = (ulong)tick.time_msc;
      g_cursorCount = 0;
   }
   g_cursorCount++;
   double price = tick.last > 0 ? tick.last : (tick.bid > 0 && tick.ask > 0 ? (tick.bid + tick.ask) / 2 : MathMax(tick.bid, tick.ask));
   if(price <= 0) return "";
   int side = g_previousSide;
   if((tick.flags & TICK_FLAG_BUY) != 0) side = 1;
   else if((tick.flags & TICK_FLAG_SELL) != 0) side = -1;
   else if(tick.last > 0 && tick.ask > 0 && tick.last >= tick.ask) side = 1;
   else if(tick.last > 0 && tick.bid > 0 && tick.last <= tick.bid) side = -1;
   else if(price > g_previousPrice) side = 1;
   else if(price < g_previousPrice) side = -1;
   g_previousPrice = price;
   g_previousSide = side;
   double volume = tick.volume_real > 0 ? tick.volume_real : (double)tick.volume;
   if(volume <= 0) volume = 1;
   return StringFormat("TICK;%s;%I64d;%.12f;%.8f;%d;%.12f;%.12f\n", _Symbol, tick.time_msc, price, volume, side, tick.bid, tick.ask);
}

bool SendHistoricalTicks()
{
   g_ready = false;
   g_cursorMs = 0;
   g_cursorCount = 0;
   g_previousPrice = 0;
   g_previousSide = 1;
   if(!SendText(StringFormat("HELLO;%s;%.12f;%d\n", _Symbol, ClusterStep(), _Digits))) return false;
   MqlTick ticks[];
   int count = 0;
   if(InpHistoryDays > 0)
   {
      count = CopyTicksRange(_Symbol, ticks, COPY_TICKS_ALL, (ulong)(TimeCurrent() - InpHistoryDays * 86400) * 1000, 0);
      if(count <= 0) count = CopyTicks(_Symbol, ticks, COPY_TICKS_ALL, 0, 50000);
   }
   string batch = "";
   int start = MathMax(0, count - 200000);
   for(int i = start; i < count; i++)
   {
      batch += TickLine(ticks[i]);
      if((i - start + 1) % 500 == 0)
      {
         if(!SendText(batch)) return false;
         batch = "";
      }
   }
   if(StringLen(batch) > 0 && !SendText(batch)) return false;
   // READY is mandatory even with disabled/unavailable history.
   g_ready = SendText("READY\n");
   return g_ready;
}

bool ConnectToEngine()
{
   if(g_socket != INVALID_HANDLE) SocketClose(g_socket);
   g_socket = SocketCreate();
   g_commands = "";
   if(g_socket == INVALID_HANDLE) return false;
   if(!SocketConnect(g_socket, InpServerIP, InpServerPort, 1000))
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
      return false;
   }
   SendText("INFO;" + AccountInfoString(ACCOUNT_COMPANY) + " (DeltaBridge)\n");
   return SendHistoricalTicks();
}

void SendLiveTicks()
{
   if(!g_ready || g_socket == INVALID_HANDLE) return;
   MqlTick ticks[];
   int count = CopyTicksRange(_Symbol, ticks, COPY_TICKS_ALL, g_cursorMs > 0 ? g_cursorMs : (ulong)(TimeCurrent() - 5) * 1000, 0);
   ulong boundary = g_cursorMs;
   int skip = g_cursorCount;
   string batch = "";
   for(int i = 0; i < count; i++)
   {
      if((ulong)ticks[i].time_msc < boundary) continue;
      if((ulong)ticks[i].time_msc == boundary && skip > 0) { skip--; continue; }
      batch += TickLine(ticks[i]);
      if(StringLen(batch) > 32000) { if(!SendText(batch)) return; batch = ""; }
   }
   if(StringLen(batch) > 0) SendText(batch);
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
         else if(symbol == _Symbol) SendHistoricalTicks();
         else if(!ChartSetSymbolPeriod(0, symbol, _Period)) SendText("ERROR;" + symbol + ";Не вдалося змінити символ графіка MT5.\n");
      }
      else if(StringFind(line, "RELOAD") == 0) SendHistoricalTicks();
      else if(StringFind(line, "PATH;") == 0)
         SendText("ERROR;" + _Symbol + ";DeltaBridge працює в поточному MT5. Для зміни термінала від'єднайте радника та використайте Python feeder.\n");
   }
}

int OnInit()
{
   ConnectToEngine();
   if(InpSendBook) MarketBookAdd(_Symbol);
   EventSetMillisecondTimer(250);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(InpSendBook) MarketBookRelease(_Symbol);
   if(g_socket != INVALID_HANDLE) SocketClose(g_socket);
   g_socket = INVALID_HANDLE;
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
