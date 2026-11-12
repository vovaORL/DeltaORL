// Read-only broker reference export. Never attaches an EA or sends trading requests.
#property copyright "DeltaORL"
#property version "1.00"
#property script_show_inputs
input long InpFromMsc = 0;
input long InpToMsc = 0;

int OpenCsv(const string path)
{
   return FileOpen(path, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',', CP_UTF8);
}
void OnStart()
{
   MqlTick latest;
   if(InpFromMsc <= 0 || InpToMsc < InpFromMsc ||
      !SymbolInfoTick(_Symbol, latest) || InpToMsc > latest.time_msc)
   {
      Print("Set exact audit InpFromMsc/InpToMsc; the end cannot exceed the latest source tick.");
      return;
   }
   string root = StringFormat("DeltaBridgeAudit\\%I64d-%I64u", (long)TimeLocal(), GetMicrosecondCount());
   int ticks = OpenCsv(root + "-ticks.csv"), rates = OpenCsv(root + "-rates.csv");
   int requests = OpenCsv(root + "-requests.csv"), metadata = OpenCsv(root + "-metadata.csv");
   if(ticks == INVALID_HANDLE || rates == INVALID_HANDLE || requests == INVALID_HANDLE || metadata == INVALID_HANDLE)
   {
      if(ticks != INVALID_HANDLE) FileClose(ticks);
      if(rates != INVALID_HANDLE) FileClose(rates);
      if(requests != INVALID_HANDLE) FileClose(requests);
      if(metadata != INVALID_HANDLE) FileClose(metadata);
      Print("Reference export: FileOpen failed, error ", GetLastError());
      return;
   }
   long fromMs = InpFromMsc, toMs = InpToMsc;
   FileWrite(metadata, "symbol", "digits", "chart_mode", "tick_size", "from_msc", "to_msc");
   FileWrite(metadata, _Symbol, _Digits, SymbolInfoInteger(_Symbol, SYMBOL_CHART_MODE),
             DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), 12), fromMs, toMs);
   FileWrite(ticks, "source_sequence", "time_msc", "bid", "ask", "last", "raw_volume", "volume_real", "flags");
   FileWrite(rates, "timeframe", "time", "open", "high", "low", "close", "tick_volume", "real_volume");
   FileWrite(requests, "kind", "from_msc", "to_msc", "count", "error");
   bool requestOk = true;
   long sequence = 0;
   for(long from = fromMs; from <= toMs && !IsStopped();)
   {
      long to = MathMin(from + 3600000 - 1, toMs);
      MqlTick chunk[];
      ResetLastError();
      int count = CopyTicksRange(_Symbol, chunk, COPY_TICKS_ALL, (ulong)from, (ulong)to);
      int error = GetLastError();
      FileWrite(requests, "ticks", from, to, count, error);
      if(error != 0 || count < 0) { requestOk = false; break; }
      for(int i = 0; i < count; i++)
         FileWrite(ticks, ++sequence, chunk[i].time_msc, DoubleToString(chunk[i].bid, 12),
                   DoubleToString(chunk[i].ask, 12), DoubleToString(chunk[i].last, 12), chunk[i].volume,
                   DoubleToString(chunk[i].volume_real, 8), chunk[i].flags);
      from = to + 1;
   }
   for(int index = 0; index < 2; index++)
   {
      ENUM_TIMEFRAMES period = index == 0 ? PERIOD_M1 : PERIOD_M15;
      MqlRates bars[];
      ResetLastError();
      int count = CopyRates(_Symbol, period, (datetime)(fromMs / 1000), (datetime)(toMs / 1000), bars);
      int error = GetLastError();
      FileWrite(requests, index == 0 ? "rates_M1" : "rates_M15", fromMs, toMs, count, error);
      if(error != 0 || count < 0) requestOk = false;
      for(int i = 0; i < count; i++)
         FileWrite(rates, PeriodSeconds(period), (long)bars[i].time, DoubleToString(bars[i].open, 12),
                   DoubleToString(bars[i].high, 12), DoubleToString(bars[i].low, 12),
                   DoubleToString(bars[i].close, 12), bars[i].tick_volume, bars[i].real_volume);
   }
   if(IsStopped()) requestOk = false;
   FileClose(ticks); FileClose(rates); FileClose(requests); FileClose(metadata);
   Print("Reference export: ", root, "; request_ok=", requestOk,
         "; source_ticks=", sequence, "; broker_coverage=unverified (requests are not proof of complete history)");
}
