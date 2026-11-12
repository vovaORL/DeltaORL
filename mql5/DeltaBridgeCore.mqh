#ifndef DELTA_BRIDGE_CORE_MQH
#define DELTA_BRIDGE_CORE_MQH
// Pure transport/classification helpers, also compiled by the native contract tests.
struct LegacySideState
{
   bool has_previous;
   MqlTick previous;
   int previous_side;
};
void ResetLegacySide(LegacySideState &state)
{
   state.has_previous = false;
   state.previous_side = 1;
   state.previous.bid = 0;
   state.previous.ask = 0;
   state.previous.last = 0;
}
int DetermineHistoricalSideLegacy(const MqlTick &tick, LegacySideState &state)
{
   int side = 0;
   if((tick.flags & TICK_FLAG_BUY) != 0) side = 1;
   else if((tick.flags & TICK_FLAG_SELL) != 0) side = -1;
   else if(tick.last > 0)
   {
      if(tick.ask > 0 && tick.last >= tick.ask) side = 1;
      else if(tick.bid > 0 && tick.last <= tick.bid) side = -1;
      else if(state.has_previous && state.previous.last > 0)
      {
         if(tick.last > state.previous.last) side = 1;
         else if(tick.last < state.previous.last) side = -1;
         else side = state.previous_side;
      }
   }
   else if(state.has_previous)
   {
      if(tick.bid > state.previous.bid || tick.ask > state.previous.ask) side = 1;
      else if(tick.bid < state.previous.bid || tick.ask < state.previous.ask) side = -1;
      else side = state.previous_side;
   }
   else side = 1;
   if(side != 0) state.previous_side = side;
   state.previous = tick;
   state.has_previous = true;
   return side;
}
int DetermineLiveSideLegacy(const MqlTick &tick, LegacySideState &state)
{
   int side = 0;
   if((tick.flags & TICK_FLAG_BUY) != 0) side = 1;
   else if((tick.flags & TICK_FLAG_SELL) != 0) side = -1;
   else if(tick.last > 0)
   {
      if(tick.ask > 0 && tick.last >= tick.ask) side = 1;
      else if(tick.bid > 0 && tick.last <= tick.bid) side = -1;
      else if(state.previous.bid > 0)
      {
         // Intentionally preserve 1.00's live comparison with previous Bid.
         if(tick.last > state.previous.bid) side = 1;
         else if(tick.last < state.previous.bid) side = -1;
         else side = state.previous_side;
      }
      else side = 1;
   }
   else
   {
      if(state.previous.bid > 0 && state.previous.ask > 0)
      {
         if(tick.bid > state.previous.bid || tick.ask > state.previous.ask) side = 1;
         else if(tick.bid < state.previous.bid || tick.ask < state.previous.ask) side = -1;
         else side = state.previous_side;
      }
      else side = 1;
   }
   if(side != 0) state.previous_side = side;
   state.previous = tick;
   state.has_previous = true;
   return side;
}
bool SameQuoteNumber(const double left, const double right)
{
   return left == right || (left != left && right != right);
}
bool SameSourceTick(const MqlTick &left, const MqlTick &right)
{
   return left.time == right.time && left.time_msc == right.time_msc &&
          SameQuoteNumber(left.bid, right.bid) && SameQuoteNumber(left.ask, right.ask) && SameQuoteNumber(left.last, right.last) &&
          left.volume == right.volume && SameQuoteNumber(left.volume_real, right.volume_real) && left.flags == right.flags;
}
string InvalidBidReason(const MqlTick &tick)
{
   if(tick.time_msc <= 0) return "nonpositive_time";
   if(!MathIsValidNumber(tick.bid) || tick.bid <= 0) return "nonpositive_or_nonfinite_bid";
   if(!MathIsValidNumber(tick.ask) || tick.ask < 0) return "negative_or_nonfinite_ask";
   if(!MathIsValidNumber(tick.last) || tick.last < 0) return "negative_or_nonfinite_last";
   if(!MathIsValidNumber(tick.volume_real) || tick.volume_real < 0) return "negative_or_nonfinite_volume_real";
   return "";
}
bool ValidBidTick(const MqlTick &tick) { return InvalidBidReason(tick) == ""; }
double ChartPrice(const MqlTick &tick) { return tick.bid; }
double LegacyVolume(const MqlTick &tick)
{
   double volume = tick.volume_real > 0 ? tick.volume_real : (double)tick.volume;
   return volume > 0 ? volume : 1;
}
#endif
