#include "ClusterAggregator.hpp"
#include <chrono>
#include <iostream>
#include <sys/resource.h>
using Clock=std::chrono::steady_clock;
double seconds(Clock::time_point start){return std::chrono::duration<double>(Clock::now()-start).count();}
int main(){
 for(int scenario=0;scenario<2;scenario++){
  delta::ClusterAggregator aggregator("EURUSD",.00001,60);
  auto start=Clock::now();
  for(int i=0;i<200000;i++){
   double bid=1.08+(scenario==0?(i%400<200?i%200:199-i%200):(i%2001))*.00001;
   delta::Tick tick;
   tick.symbol="EURUSD";tick.time_msc=1794480300000LL+(scenario==0?i/3*600LL:i/3);
   tick.price=bid;tick.bid=bid;tick.ask=bid+.00002;tick.volume=1;
   tick.side=i%2?delta::TradeSide::Buy:delta::TradeSide::Sell;aggregator.process_tick(tick);
  }
  double ingest=seconds(start);start=Clock::now();auto m1=aggregator.serialize_snapshot_json(1000);double snapshot=seconds(start);
  start=Clock::now();aggregator.set_timeframe(900);auto m15=aggregator.serialize_snapshot_json(1000);double rebuild15=seconds(start);
  start=Clock::now();aggregator.set_timeframe(60);auto restored=aggregator.serialize_snapshot_json(1000);double rebuild1=seconds(start);
  rusage usage{};getrusage(RUSAGE_SELF,&usage);
  std::cout<<"{\"scenario\":\""<<(scenario==0?"quote_walk_with_same_ms":"dense_2001_price_levels")
    <<"\",\"ticks\":200000,\"tick_size\":0.00001,\"ingest_seconds\":"<<ingest
    <<",\"m1_snapshot_seconds\":"<<snapshot<<",\"m15_rebuild_and_snapshot_seconds\":"<<rebuild15
    <<",\"m1_restore_and_snapshot_seconds\":"<<rebuild1<<",\"m1_bytes\":"<<m1.size()
    <<",\"m15_bytes\":"<<m15.size()<<",\"peak_rss_kib\":"<<usage.ru_maxrss
    <<",\"m1_roundtrip_identical\":"<<(m1==restored?"true":"false")<<"}\n";
  if(m1!=restored||aggregator.get_cumulative_delta()!=0)return 1;
 }
}
