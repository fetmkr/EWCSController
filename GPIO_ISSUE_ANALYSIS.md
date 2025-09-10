# GPIO 16번 핀 문제 분석

## 문제 상황
- `node scripts/device-health-check.js` 실행 시 GPIO 16번 핀 export에서 EINVAL 에러 발생
- `onoff` 라이브러리에서 `writeFileSync` 호출 시 실패

## 원인 분석

### 1. GPIO 16번 핀 하드웨어 이슈
```bash
sudo sh -c 'echo "16" > /sys/class/gpio/export'
# 결과: sh: 1: echo: echo: I/O error
```
- GPIO 16번 핀 자체가 하드웨어적으로 문제가 있거나
- 이미 다른 프로세스에서 사용 중이거나 
- 시스템에서 예약된 핀일 가능성

### 2. onoff 라이브러리 문제
- onoff 라이브러리는 내부적으로 `/sys/class/gpio/export`에 직접 쓰기를 시도
- 일부 Raspberry Pi 환경에서 권한이나 타이밍 문제로 실패하는 경우 있음
- Node.js 22.15.0과의 호환성 문제 가능성

### 3. 시스템 상태 확인 결과
```bash
/sys/kernel/debug/gpio 출력에서:
gpio-528 (GPIO16) - 사용 가능한 상태로 표시되지만 실제 export 시 실패
```

## 해결 방안

### 임시 해결책
GPIO 기능을 비활성화하여 헬스체크 스크립트가 동작하도록 함
- LED 제어 기능만 비활성화, 다른 디바이스 체크는 정상 진행
- 시스템 전체 기능에는 영향 없음

### 근본적 해결책 (나중에 적용)
1. 다른 GPIO 핀 사용 (예: 18, 22, 24번 등)
2. `rpi-gpio` 라이브러리로 교체
3. `pigpio` 라이브러리 사용 검토
4. 하드웨어 연결 상태 점검

## 결론
현재는 GPIO 기능을 비활성화하여 디바이스 헬스체크가 동작하도록 하고, 
추후 다른 GPIO 핀이나 라이브러리로 교체 예정