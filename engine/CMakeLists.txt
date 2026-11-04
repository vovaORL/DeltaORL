cmake_minimum_required(VERSION 3.20)
project(DeltaEngine CXX)

if(NOT WIN32)
    message(FATAL_ERROR "DeltaORL requires Windows (MT5, Winsock and CryptoAPI).")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_CXX_EXTENSIONS OFF)

set(SOURCES
    src/main.cpp
    src/ClusterAggregator.cpp
    src/MT5Receiver.cpp
    src/MarketSimulator.cpp
    src/WSServer.cpp
    src/MT5FileReader.cpp
)

add_executable(delta_engine ${SOURCES})
target_include_directories(delta_engine PRIVATE include)
target_compile_definitions(delta_engine PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(delta_engine PRIVATE ws2_32 crypt32)

if (MSVC)
    target_compile_options(delta_engine PRIVATE /W4 /utf-8 $<$<CONFIG:Release>:/O2>)
else()
    target_compile_options(delta_engine PRIVATE -Wall -Wextra -Wpedantic $<$<CONFIG:Release>:-O3>)
    if(MINGW)
        target_link_options(delta_engine PRIVATE -static)
    endif()
endif()

include(CTest)
if(BUILD_TESTING)
    add_executable(engine_tests tests/engine_tests.cpp src/ClusterAggregator.cpp src/MT5FileReader.cpp)
    target_include_directories(engine_tests PRIVATE include)
    target_compile_definitions(engine_tests PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    if(MINGW)
        target_link_options(engine_tests PRIVATE -static)
    endif()
    add_test(NAME engine_tests COMMAND engine_tests)
endif()
