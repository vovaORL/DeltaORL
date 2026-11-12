#include "candidate.cpp"
#include "legacy_reference.hpp"
#include <random>
#include <fstream>
void require(bool condition,const char*message){if(!condition)throw std::runtime_error(message);}
MqlTick tick(long ms,double bid=1.10001,double ask=1.10003){ms+=1794480000000;MqlTick t;t.time=ms/1000;t.time_msc=ms;t.bid=bid;t.ask=ask;t.volume=0;return t;}
int ticks_in_wire(){int n=0;for(size_t i=0;(i=wire.find("TICK;",i))!=string::npos;i+=5)n++;return n;}
void reset(){
 append_on_boundary=false;mutate_on_boundary=false;source.clear();wire.clear();events.clear();copy_error=0;send_budget=-1;send_chunk=10000000;latest_ms=0;
 g_socket=1;connected=true;g_ready=false;g_cursorMs=0;g_readThrough=0;g_boundary.clear();
 InpHistoryDays=1;InpAudit=true;
}
int main(int argc,char**argv){try{
 // Independent reference is extracted verbatim from the archived 1.00 source.
 std::mt19937 rng(18);Array<MqlTick> records;
 for(int i=0;i<10000;i++){auto t=tick(900000+i/3,1.1+(int(rng()%9)-4)*.00001,1.1001+(rng()%5)*.00001);
 t.last=rng()%2?0:1.1+(rng()%15)*.00001;t.flags=(rng()%5==0?32:rng()%7==0?64:0);records.push_back(t);}
 auto expected=ReferenceHistory(records);LegacySideState hs,ls;ResetLegacySide(hs);ResetLegacySide(ls);
 double pb=0,pa=0;int ps=1;
 for(size_t i=0;i<records.size();i++){
  require(DetermineHistoricalSideLegacy(records[i],hs)==expected[i],"historical 1.00 parity");
  require(DetermineLiveSideLegacy(records[i],ls)==ReferenceLive(records[i],pb,pa,ps),"live 1.00 parity");
 }
 reset();source={tick(900000),tick(900000),tick(900000,1.10001,1.10004),tick(960000)};
 send_chunk=7;require(BeginSession(),"initial history");require(g_sent==4&&ticks_in_wire()==4,"duplicate and ask-only history retained");
 require(wire.find("HELLO;EURUSD;0.000010000000;5\n")!=string::npos,"broker step HELLO");
 require(wire.find(";1.100010000000;1.00000000;")!=string::npos,"Bid chart price");
 auto unchanged=wire;SendLiveTicks();require(wire==unchanged,"no duplicate on repeated copy");
 source.push_back(tick(960000));source.push_back(tick(960000,1.10001,1.10005));SendLiveTicks();
 require(g_sent==6&&ticks_in_wire()==6,"appended boundary duplicate and ask-only retained");
 unchanged=wire;SendLiveTicks();require(wire==unchanged,"boundary append not resent");
 source.back().ask=1.20000;SendLiveTicks();require(!g_ready&&g_socket==INVALID_HANDLE,"changed prefix rejected");
 reset();source={tick(900000)};append_on_boundary=true;require(BeginSession()&&g_sent==1,"snapshot only commits observed boundary prefix");
 SendLiveTicks();require(g_sent==2,"tick appended during snapshot boundary read is live");
 reset();source={tick(900000),tick(900000)};mutate_on_boundary=true;
 require(!BeginSession()&&wire.find("READY")==string::npos&&ticks_in_wire()==0,"changed historical boundary fails before publication");
 reset();source={tick(900000)};copy_error=4403;require(!BeginSession()&&wire.find("READY")==string::npos,"partial history not ready");
 reset();source={tick(900000)};require(BeginSession(),"recovery initial");copy_error=4403;SendLiveTicks();require(!g_ready,"partial live forces full replay");
 copy_error=0;source.push_back(tick(960000));g_socket=1;connected=true;require(BeginSession(),"full replay after error");require(g_sent==2,"new session counters reset");
 reset();source={tick(900000)};require(BeginSession(),"send failure initial");auto cursor=g_cursorMs;source.push_back(tick(960000));send_budget=8;SendLiveTicks();
 require(!g_ready&&g_cursorMs==cursor,"partial send does not commit cursor");
 reset();auto bad=tick(900001);bad.bid=0;source={tick(900000),bad,tick(900001),tick(900001)};
 require(BeginSession()&&g_invalid==1&&g_sent==3,"invalid source accounted");unchanged=wire;SendLiveTicks();require(wire==unchanged,"invalid source not replayed");
 reset();source={tick(900000)};require(BeginSession(),"sparse start");source.push_back(tick(900000+4*3600000));
 for(int i=0;i<5;i++){SendLiveTicks();}
 require(g_sent==2,"drain after long market gap");
 reset();for(int i=0;i<200010;i++)source.push_back(tick(900000+i/3));
 require(BeginSession()&&g_sent==200000,"history limit");
 require(std::any_of(events.begin(),events.end(),[](const string&s){return s.find("dropped=10;")!=string::npos&&s.find("coverage=unverified")!=string::npos;}),"truncation coverage explicit");
 unchanged=wire;SendLiveTicks();require(wire==unchanged,"retained boundary not duplicated");
 reset();source={tick(900000),tick(900001)};source.back().bid=std::nan("");
 require(BeginSession()&&g_invalid==1,"nonfinite boundary source counted");unchanged=wire;SendLiveTicks();require(wire==unchanged,"nonfinite boundary record matched safely");
 reset();for(int i=0;i<200010;i++)source.push_back(tick(900000));
 require(BeginSession()&&ArraySize(g_boundary)==200010,"whole boundary retained beyond history cap");
 unchanged=wire;SendLiveTicks();require(wire==unchanged,"capped identical prefix not resent");source.push_back(tick(900000));SendLiveTicks();require(g_sent==200001,"new identical record after capped history retained");
 reset();for(int i=0;i<200010;i++)source.push_back(tick(900000+i/3));
 require(BeginSession()&&g_sent==200000,"pipeline fixture");
 if(argc==2){std::ofstream output(argv[1]);output<<wire;}
 std::cout<<"PASS: production EA through MQL API shim; legacy parity, Bid, tick size, duplicates, ask-only, cursor, errors, reconnect, 200k cap\n";
 return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
