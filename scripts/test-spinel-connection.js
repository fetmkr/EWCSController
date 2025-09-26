#!/usr/bin/env node

/**
 * Spinel 카메라 연결 테스트 스크립트
 * checkConnection() 함수를 반복 테스트하여 연결 안정성 확인
 * VOUT2 전원 제어 포함
 */

import SpinelCamera from '../devices/spinel-serial-camera.js';
import PIC24Controller from '../devices/pic24-controller.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSpinelConnection() {
  console.log('='.repeat(50));
  console.log('Spinel Camera Connection Test with VOUT2 Control');
  console.log('='.repeat(50));

  let camera = null;
  let pic24 = null;

  try {
    // PIC24 컨트롤러 초기화
    pic24 = new PIC24Controller();
    await pic24.initialize('/dev/ttyAMA0', 115200);
    console.log('\n✅ PIC24 controller initialized');
    await sleep(1000);

    // 카메라 인스턴스 생성
    camera = new SpinelCamera('/dev/ttyAMA3', 115200);
    console.log('✅ Camera instance created');

    // 포트 열릴 때까지 대기
    await sleep(2000);

    // 연결 테스트 횟수
    const testCount = 10;
    let successCount = 0;
    let failCount = 0;

    console.log(`\n📋 Running ${testCount} connection tests with VOUT2 power cycling...\n`);

    for (let i = 1; i <= testCount; i++) {
      console.log(`\n--- Test ${i}/${testCount} ---`);

      try {
        // VOUT2 켜기
        console.log('🔌 Turning ON VOUT2...');
        await pic24.turnOnVOUT(2);
        console.log('✅ VOUT2 ON');

        // 5초 대기 (카메라 부팅)
        console.log('⏳ Waiting 5 seconds for camera boot...');
        await sleep(5000);

        // 연결 테스트
        console.log('🔍 Testing connection...');
        const startTime = Date.now();
        const isConnected = await camera.checkConnection();
        const elapsed = Date.now() - startTime;

        if (isConnected) {
          successCount++;
          console.log(`✅ Test ${i}: SUCCESS (${elapsed}ms)`);
        } else {
          failCount++;
          console.log(`❌ Test ${i}: FAILED (${elapsed}ms)`);
        }

      } catch (error) {
        console.error(`❌ Test ${i}: ERROR - ${error.message}`);
        failCount++;
      } finally {
        // VOUT2 끄기
        try {
          console.log('🔌 Turning OFF VOUT2...');
          await pic24.turnOffVOUT(2);
          console.log('✅ VOUT2 OFF');
        } catch (error) {
          console.error('⚠️ Failed to turn off VOUT2:', error.message);
        }
      }

      // 각 테스트 사이 2초 대기 (전원 안정화)
      if (i < testCount) {
        console.log('⏳ Waiting 2 seconds before next test...');
        await sleep(2000);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${testCount}`);
    console.log(`✅ Success: ${successCount} (${(successCount/testCount*100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failCount} (${(failCount/testCount*100).toFixed(1)}%)`);
    console.log('='.repeat(50));

    // 추가 스트레스 테스트 (빠른 연속 호출)
    const doStressTest = process.argv.includes('--stress');

    if (doStressTest) {
      console.log('\n🔥 Running stress test (rapid successive calls)...\n');

      const stressTestCount = 20;
      let stressSuccess = 0;
      let stressFail = 0;

      const stressStartTime = Date.now();

      for (let i = 1; i <= stressTestCount; i++) {
        process.stdout.write(`\rStress test: ${i}/${stressTestCount}`);

        const isConnected = await camera.checkConnection();

        if (isConnected) {
          stressSuccess++;
        } else {
          stressFail++;
        }

        // 스트레스 테스트는 지연 없이
        await sleep(100); // 최소 딜레이만
      }

      const stressElapsed = Date.now() - stressStartTime;

      console.log('\n\n📊 Stress Test Results:');
      console.log(`Total: ${stressTestCount} tests in ${(stressElapsed/1000).toFixed(2)}s`);
      console.log(`✅ Success: ${stressSuccess} (${(stressSuccess/stressTestCount*100).toFixed(1)}%)`);
      console.log(`❌ Failed: ${stressFail} (${(stressFail/stressTestCount*100).toFixed(1)}%)`);
      console.log(`Average time per test: ${(stressElapsed/stressTestCount).toFixed(1)}ms`);
    }

  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    console.error(error.stack);
  } finally {
    // VOUT2 끄기 확인
    if (pic24) {
      try {
        console.log('\n🔌 Ensuring VOUT2 is OFF...');
        await pic24.turnOffVOUT(2);
        console.log('✅ VOUT2 OFF');
      } catch (error) {
        console.error('⚠️ Failed to turn off VOUT2:', error.message);
      }
    }

    // 카메라 정리
    if (camera) {
      console.log('\n🔧 Closing camera...');
      await camera.close();
      console.log('✅ Camera closed');
    }

    // PIC24 정리
    if (pic24) {
      console.log('🔧 Closing PIC24 controller...');
      await pic24.close();
      console.log('✅ PIC24 controller closed');
    }

    console.log('\n✨ Test completed');
    process.exit(0);
  }
}

// 사용법 표시
function showUsage() {
  console.log('Usage: node test-spinel-connection.js [options]');
  console.log('\nOptions:');
  console.log('  --stress    Run additional stress test with rapid calls');
  console.log('  --help      Show this help message');
  console.log('\nExample:');
  console.log('  node test-spinel-connection.js');
  console.log('  node test-spinel-connection.js --stress');
}

// 도움말 확인
if (process.argv.includes('--help')) {
  showUsage();
  process.exit(0);
}

// 테스트 실행
console.log('Starting Spinel camera connection test...\n');
testSpinelConnection().catch(console.error);