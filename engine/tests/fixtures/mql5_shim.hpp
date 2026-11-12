// Test-only MQL5 API shim. Production EA source is syntax-adapted, not reimplemented.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
using string = std::string;
using uchar = unsigned char;
template<class T> using Array = std::vector<T>;
#define input
const int INVALID_HANDLE=-1, WHOLE_ARRAY=-1, CP_UTF8=65001;
const int TICK_FLAG_BUY=32,TICK_FLAG_SELL=64,COPY_TICKS_ALL=0;
const int SYMBOL_TRADE_TICK_SIZE=1,SYMBOL_CHART_MODE=2,SYMBOL_CHART_MODE_BID=0;
const int FILE_WRITE=1,FILE_CSV=2,FILE_ANSI=4,FILE_SHARE_READ=8,ACCOUNT_COMPANY=0;
const int INIT_PARAMETERS_INCORRECT=2,INIT_SUCCEEDED=0,BOOK_TYPE_BUY=1,BOOK_TYPE_SELL=2;
string _Symbol="EURUSD";
int _Digits=5,_Period=1;
double _Point=.00001;
struct MqlTick {long time=0; double bid=0,ask=0,last=0; ulong volume=0; long time_msc=0; unsigned flags=0; double volume_real=0;};
struct MqlBookInfo {int type;double price,volume_real;ulong volume;};
std::vector<MqlTick> source;
string wire;
int api_error=0,copy_error=0,send_budget=-1,send_chunk=10000000,copy_calls=0;
bool connected=true,append_on_boundary=false,mutate_on_boundary=false;
long latest_ms=0;
std::vector<string> events;
template<class T> int ArraySize(const Array<T>&a){return int(a.size());}
template<class T> int ArrayResize(Array<T>&a,int n,int=0){a.resize(n);return n;}
template<class T> int ArrayCopy(Array<T>&a,const Array<T>&b,int dst=0,int start=0,int count=-1){
 if(count<0)count=int(b.size())-start;
 if(dst+count>int(a.size()))a.resize(dst+count);
 std::copy_n(b.begin()+start,count,a.begin()+dst);return count;
}
template<class A,class B> auto MathMin(A a,B b){using T=std::common_type_t<A,B>;return std::min(T(a),T(b));}
template<class A,class B> auto MathMax(A a,B b){using T=std::common_type_t<A,B>;return std::max(T(a),T(b));}
bool MathIsValidNumber(double value){return std::isfinite(value);}
const char* FormatArg(const string&s){return s.c_str();}
template<class T>T FormatArg(T value){return value;}
template<class...T> string StringFormat(string format,T...args){
 for(auto pattern:{std::pair<string,string>{"%I64d","%ld"},{"%I64u","%lu"}})
  for(size_t p=0;(p=format.find(pattern.first,p))!=string::npos;)format.replace(p,pattern.first.size(),pattern.second);
 int n=std::snprintf(nullptr,0,format.c_str(),FormatArg(args)...);
 std::vector<char>b(n+1);std::snprintf(b.data(),b.size(),format.c_str(),FormatArg(args)...);return b.data();
}
string DoubleToString(double v,int digits){return StringFormat("%.*f",digits,v);}
int StringToCharArray(const string&s,Array<uchar>&out,int,int,int){out.assign(s.begin(),s.end());out.push_back(0);return int(out.size());}
int StringLen(const string&s){return int(s.size());}
int StringFind(const string&s,const string&part){auto p=s.find(part);return p==string::npos?-1:int(p);}
string StringSubstr(const string&s,int from,int size=-1){return s.substr(from,size<0?string::npos:size);}
string CharArrayToString(const Array<uchar>&a,int from,int count,int){return string(a.begin()+from,a.begin()+from+count);}
void ResetLastError(){api_error=0;} int GetLastError(){return api_error;}
int CopyTicksRange(const string&,Array<MqlTick>&ticks,int,ulong from,ulong to){
 copy_calls++;
 if(from==to&&append_on_boundary){source.push_back(source.back());append_on_boundary=false;}
 if(from==to&&mutate_on_boundary){source.back().ask+=.01;mutate_on_boundary=false;}
 ticks.clear();for(auto&t:source)if(ulong(t.time_msc)>=from&&ulong(t.time_msc)<=to)ticks.push_back(t);
 api_error=copy_error;return int(ticks.size());
}
bool SymbolInfoTick(const string&,MqlTick&t){if(source.empty())return false;t=source.back();if(latest_ms)t.time_msc=latest_ms;return true;}
double SymbolInfoDouble(const string&,int){return .00001;}
long SymbolInfoInteger(const string&,int){return SYMBOL_CHART_MODE_BID;}
string AccountInfoString(int){return "Fixture Broker";}
void SocketClose(int){connected=false;}
int SocketCreate(){connected=true;return 1;}
bool SocketConnect(int,const string&,int,int){return true;}
bool SocketIsConnected(int){return connected;}
int SocketSend(int,const Array<uchar>&data,int count){
 if(send_budget==0)return -1;
 int n=std::min(count,send_chunk);if(send_budget>0)n=std::min(n,send_budget);
 wire.append(data.begin(),data.begin()+n);if(send_budget>0)send_budget-=n;return n;
}
unsigned SocketIsReadable(int){return 0;}
int SocketRead(int,Array<uchar>&,int,int){return 0;}
int FileOpen(const string&,int,char,int){return 1;}
template<class...T> void Print(T...){ }
template<class...T> unsigned FileWrite(int,T...values){std::ostringstream s;((s<<values<<'|'),...);events.push_back(s.str());return 1;}
void FileFlush(int){} void FileClose(int){}
bool IsStopped(){return false;}
long TimeLocal(){return 1000;}
ulong GetMicrosecondCount(){static ulong n=0;return ++n;}
ulong GetTickCount64(){return 999999;}
long ChartID(){return 1;}
bool SymbolSelect(const string&,bool){return true;}
bool ChartSetSymbolPeriod(int,const string&,int){return true;}
void MarketBookAdd(const string&){} void MarketBookRelease(const string&){}
bool MarketBookGet(const string&,Array<MqlBookInfo>&){return false;}
void EventSetMillisecondTimer(int){} void EventKillTimer(){}
