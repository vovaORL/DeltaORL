//+------------------------------------------------------------------+
//|                                                  DeltaBridge.mq5 |
//|                                  Copyright 2026, DeltaORL Engine |
//|                     High-Speed Order Flow & Cluster Streamer     |
//+------------------------------------------------------------------+
#property copyright "DeltaORL High-Speed Volume Cluster Analyzer"
#property link      "https://github.com/DeltaORL"
#property version   "1.00"

// Input Parameters
input string   InpServerIP     = "127.0.0.1";  // DeltaORL Engine IP
input int      InpServerPort   = 9190;         // DeltaORL Engine TCP Port
input int      InpHistoryDays  = 2;            // Days of tick history to upload on start
input bool     InpSendBook     = false;        // Send L2 Depth of Market events

// Global Variables
int      g_socket = INVALID_HANDLE;
bool     g_connected = false;
ulong    g_lastConnectAttempt = 0;
ulong    g_lastTickTimeMsc = 0;

//+------------------------------------------------------------------+
//| Helper: Connect to DeltaORL C++ Engine via TCP Socket            |
//+------------------------------------------------------------------+
bool ConnectToEngine()
{
   if(g_socket != INVALID_HANDLE)
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
   }
   
   g_socket = SocketCreate();
   if(g_socket == INVALID_HANDLE)
   {
      Print("DeltaBridge: Failed to create socket! Error: ", GetLastError());
      return false;
   }
   
   if(!SocketConnect(g_socket, InpServerIP, InpServerPort, 1000))
   {
      int err = GetLastError();
      Print("DeltaBridge: SocketConnect to ", InpServerIP, ":", InpServerPort, " failed (Error: ", err, ")");
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
      return false;
   }
   
   Print("DeltaBridge: Successfully connected to DeltaORL Engine at ", InpServerIP, ":", InpServerPort);
   
   // Send Handshake
   string symbol = _Symbol;
   double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick_size <= 0.0) tick_size = _Point;
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   string helloMsg = StringFormat("HELLO;%s;%.8f;%d\n", symbol, tick_size, digits);
   uchar buffer[];
   StringToCharArray(helloMsg, buffer, 0, StringLen(helloMsg));
   SocketSend(g_socket, buffer, ArraySize(buffer));
   
   return true;
}

//+------------------------------------------------------------------+
//| Upload Historical Ticks to DeltaORL Engine                       |
//+------------------------------------------------------------------+
void SendHistoricalTicks()
{
   if(InpHistoryDays <= 0 || g_socket == INVALID_HANDLE) return;
   
   Print("DeltaBridge: Fetching ", InpHistoryDays, " days of tick history...");
   datetime from = TimeCurrent() - (InpHistoryDays * 86400);
   MqlTick ticks[];
   
   int copied = CopyTicksRange(_Symbol, ticks, COPY_TICKS_ALL, from * 1000, 0);
   if(copied <= 0)
   {
      Print("DeltaBridge: CopyTicksRange returned 0, fetching recent 50,000 cached ticks from MT5...");
      copied = CopyTicks(_Symbol, ticks, COPY_TICKS_ALL, 0, 50000);
   }

   if(copied > 0)
   {
      Print("DeltaBridge: Streaming ", copied, " historical ticks to DeltaORL...");
      string batch = "";
      int count = 0;
      int prevHistSide = 1;
      
      for(int i = 0; i < copied; i++)
      {
         int side = 0;
         if((ticks[i].flags & TICK_FLAG_BUY) != 0) side = 1;
         else if((ticks[i].flags & TICK_FLAG_SELL) != 0) side = -1;
         else if(ticks[i].last > 0.0)
         {
            if(ticks[i].ask > 0.0 && ticks[i].last >= ticks[i].ask) side = 1;
            else if(ticks[i].bid > 0.0 && ticks[i].last <= ticks[i].bid) side = -1;
            else if(i > 0 && ticks[i-1].last > 0.0)
            {
               if(ticks[i].last > ticks[i-1].last) side = 1;
               else if(ticks[i].last < ticks[i-1].last) side = -1;
               else side = prevHistSide;
            }
         }
         else if(i > 0)
         {
            // Forex / CFD Tick Rule: analyze Bid / Ask quote changes
            if(ticks[i].bid > ticks[i-1].bid || ticks[i].ask > ticks[i-1].ask) side = 1;
            else if(ticks[i].bid < ticks[i-1].bid || ticks[i].ask < ticks[i-1].ask) side = -1;
            else side = prevHistSide;
         }
         else
         {
            side = 1;
         }
         
         if(side != 0) prevHistSide = side;
         
         double vol = (ticks[i].volume_real > 0.0) ? ticks[i].volume_real : (double)ticks[i].volume;
         if(vol <= 0.0) vol = 1.0;
         
         double tradePrice = (ticks[i].last > 0.0) ? ticks[i].last : ((side > 0) ? ticks[i].ask : ticks[i].bid);
         
         string line = StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
            _Symbol, ticks[i].time_msc, tradePrice, vol, side, ticks[i].bid, ticks[i].ask);
            
         batch += line;
         count++;
         
         // Send in chunks of 50 ticks for socket efficiency
         if(count % 50 == 0)
         {
            uchar buf[];
            StringToCharArray(batch, buf, 0, StringLen(batch));
            SocketSend(g_socket, buf, ArraySize(buf));
            batch = "";
         }
      }
      
      if(StringLen(batch) > 0)
      {
         uchar buf[];
         StringToCharArray(batch, buf, 0, StringLen(batch));
         SocketSend(g_socket, buf, ArraySize(buf));
      }
      
      Print("DeltaBridge: Historical ticks streaming completed (", copied, " ticks).");
   }
   else
   {
      // Fallback: If broker doesn't have ticks cached, stream M1 bars
      Print("DeltaBridge: No cached tick history, streaming 500 historical M1 bars from broker...");
      MqlRates rates[];
      ArraySetAsSeries(rates, false);
      int rates_count = CopyRates(_Symbol, PERIOD_M1, 0, 500, rates);
      if(rates_count > 0)
      {
         string batch = "";
         for(int i = 0; i < rates_count; i++)
         {
            long time_msc = (long)rates[i].time * 1000;
            double vol = (double)rates[i].tick_volume;
            if(vol <= 0.0) vol = 10.0;
            
            // Distribute into Open, High, Low, Close ticks
            double quarter = vol * 0.25;
            batch += StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
               _Symbol, time_msc, rates[i].open, quarter, 1, rates[i].open, rates[i].open);
            batch += StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
               _Symbol, time_msc + 15000, rates[i].high, quarter, 1, rates[i].high, rates[i].high);
            batch += StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
               _Symbol, time_msc + 30000, rates[i].low, quarter, -1, rates[i].low, rates[i].low);
            batch += StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
               _Symbol, time_msc + 45000, rates[i].close, quarter, (rates[i].close >= rates[i].open) ? 1 : -1, rates[i].close, rates[i].close);
               
            if(i % 25 == 0)
            {
               uchar buf[];
               StringToCharArray(batch, buf, 0, StringLen(batch));
               SocketSend(g_socket, buf, ArraySize(buf));
               batch = "";
            }
         }
         if(StringLen(batch) > 0)
         {
            uchar buf[];
            StringToCharArray(batch, buf, 0, StringLen(batch));
            SocketSend(g_socket, buf, ArraySize(buf));
         }
         Print("DeltaBridge: Historical M1 bars streaming completed (", rates_count, " bars).");
      }
   }
}

//+------------------------------------------------------------------+
//| Initialization                                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("DeltaBridge: Initializing for symbol ", _Symbol, "...");
   g_connected = ConnectToEngine();
   if(g_connected)
   {
      SendHistoricalTicks();
   }
   
   if(InpSendBook)
   {
      MarketBookAdd(_Symbol);
   }
   
   EventSetMillisecondTimer(500); // Check socket health every 500ms
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Deinitialization                                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(InpSendBook)
   {
      MarketBookRelease(_Symbol);
   }
   if(g_socket != INVALID_HANDLE)
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
   }
   Print("DeltaBridge: Stopped.");
}

//+------------------------------------------------------------------+
//| Timer Event: Auto-reconnect if connection lost                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
   {
      ulong now = GetTickCount64();
      if(now - g_lastConnectAttempt >= 2000)
      {
         g_lastConnectAttempt = now;
         g_connected = ConnectToEngine();
         if(g_connected)
         {
            SendHistoricalTicks();
         }
      }
   }
}

//+------------------------------------------------------------------+
//| OnTick: Real-time high-speed tick processing                     |
//+------------------------------------------------------------------+
void OnTick()
{
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
      return;
      
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return;
      
   if(tick.time_msc == g_lastTickTimeMsc)
      return;
   g_lastTickTimeMsc = tick.time_msc;
   
   static double g_prevBid = 0.0;
   static double g_prevAsk = 0.0;
   static int    g_prevSide = 1;

   // Determine Trade Side: 1 = Buy (Ask Hit), -1 = Sell (Bid Hit)
   int side = 0;
   if((tick.flags & TICK_FLAG_BUY) != 0) 
   {
      side = 1;
   }
   else if((tick.flags & TICK_FLAG_SELL) != 0) 
   {
      side = -1;
   }
   else if(tick.last > 0.0)
   {
      if(tick.ask > 0.0 && tick.last >= tick.ask) side = 1;
      else if(tick.bid > 0.0 && tick.last <= tick.bid) side = -1;
      else if(g_prevBid > 0.0)
      {
         if(tick.last > g_prevBid) side = 1;
         else if(tick.last < g_prevBid) side = -1;
         else side = g_prevSide;
      }
      else side = 1;
   }
   else
   {
      // Forex / CFD: Quote dynamics (Tick Rule on Bid/Ask)
      if(g_prevBid > 0.0 && g_prevAsk > 0.0)
      {
         if(tick.bid > g_prevBid || tick.ask > g_prevAsk)
            side = 1; // Uptick -> Buy market aggression
         else if(tick.bid < g_prevBid || tick.ask < g_prevAsk)
            side = -1; // Downtick -> Sell market aggression
         else
            side = g_prevSide; // Unchanged quote -> follow previous momentum
      }
      else
      {
         side = 1;
      }
   }
   
   if(side != 0) g_prevSide = side;
   g_prevBid = tick.bid;
   g_prevAsk = tick.ask;
   
   double vol = (tick.volume_real > 0.0) ? tick.volume_real : (double)tick.volume;
   if(vol <= 0.0) vol = 1.0;
   
   double tradePrice = (tick.last > 0.0) ? tick.last : ((side > 0) ? tick.ask : tick.bid);
   
   string msg = StringFormat("TICK;%s;%I64d;%.8f;%.4f;%d;%.8f;%.8f\n",
      _Symbol, tick.time_msc, tradePrice, vol, side, tick.bid, tick.ask);
      
   uchar buffer[];
   StringToCharArray(msg, buffer, 0, StringLen(msg));
   SocketSend(g_socket, buffer, ArraySize(buffer));
}

//+------------------------------------------------------------------+
//| OnBookEvent: DOM / Market Depth processing (Optional)            |
//+------------------------------------------------------------------+
void OnBookEvent(const string &symbol)
{
   if(!InpSendBook || symbol != _Symbol) return;
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket)) return;
   
   MqlBookInfo book[];
   if(MarketBookGet(symbol, book))
   {
      int size = ArraySize(book);
      if(size > 0)
      {
         string msg = StringFormat("DOM;%s;%d", symbol, size);
         for(int i = 0; i < size && i < 20; i++)
         {
            int type = (book[i].type == BOOK_TYPE_BUY) ? 1 : 2; // 1 = Bid, 2 = Ask
            msg += StringFormat(";%.8f,%.4f,%d", book[i].price, (double)book[i].volume_real, type);
         }
         msg += "\n";
         
         uchar buffer[];
         StringToCharArray(msg, buffer, 0, StringLen(msg));
         SocketSend(g_socket, buffer, ArraySize(buffer));
      }
   }
}
//+------------------------------------------------------------------+
