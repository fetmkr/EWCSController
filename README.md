# EWCS Controller

EWCS 제어 소프트웨어

## 개요

EWCS Controller는 Raspberry Pi 기반의 종합 환경 모니터링 시스템입니다. 다양한 센서와 카메라를 통합하여 날씨, 시정, 환경 데이터를 수집하고 실시간으로 모니터링할 수 있습니다.

## 주요 기능

- 실시간 환경 데이터 수집 
- 듀얼 카메라 시스템 (Spinel, OASC)
- 태양광 전력 모니터링
- API 서버
- 자동 데이터 정리
- GPS 
- 위성 통신

## 시스템 구성

### 메인 애플리케이션
- **app.js**: Express 서버, 디바이스 초기화, 데이터 수집 스케줄링

### 디바이스 모듈 (`/devices`)
- **cs125-sensor.js**: CS125 시정계 센서
- **spinel-serial-camera.js**: Spinel SC20MPF 카메라 (SXH Protocol v4.0)
- **oasc-camera.js**: OASC Starlight Oculus 360 USB 카메라
- **epever-controller.js**: EPEVER 태양광 충전 컨트롤러
- **pic24-controller.js**: PIC24 마이크로컨트롤러
- **sht45-sensor.js**: SHT45 온습도 센서
- **adc-reader.js**: MCP3008 ADC
- **gpio-controller.js**: GPIO 제어

### API 라우트 (`/api/routes`)
- **device-routes.js**: 디바이스 제어 API
- **ewcs-routes.js**: EWCS 데이터 API
- **system-routes.js**: 시스템 설정 API
- **image-routes.js**: 이미지 관리 API
- **help-routes.js**: API 문서 API

### 기타 모듈
- **database/sqlite-db.js**: SQLite 데이터베이스
- **config/app-config.js**: 설정 관리
- **utils/system-state.js**: 시스템 상태
- **utils/auto-data-cleanup.js**: 오래된 데이터 정리
```

- 실행 조건들 (모두 만족해야 실행):
    - 디스크 사용률 80% 이상 (maxDiskUsagePercent: 80)
    - 시스템 시간이 2024년 이후 (건강성 체크)
    - 최근 7일 내 최소 100개 파일 존재 (minRecentFiles: 100)

- 삭제 기준:
    - 90일 이상된 파일만 삭제 (minFileAgedays: 90)
    - 최신 2000개 파일 무조건 보존 (minPreserveCount: 2000)
    - 한 번에 최대 10%만 삭제 (maxDeletePercentage: 10)

- 타이밍
    하루에 한번. config.json에 저장된 마지막 클린업 날짜를 보고 비교해서. 

- 대상 디렉토리:
    - ewcs_images/ (spinel 카메라)
    - oasc_images/ (oasc 카메라)
  ```


## 프로젝트 구조

```
EWCSController/
├── app.js
├── package.json
├── config.json
├── api/
│   ├── middleware/
│   └── routes/
├── config/
├── database/
├── devices/
├── utils/
├── scripts/
├── data/
├── ewcs_images/
├── oasc_images/
├── protocol/
├── backup/
└── oasc/
```

## 설치 및 실행

```bash
# 설치
git clone https://github.com/fetmkr/EWCSController.git
cd EWCSController
npm install

# 실행
npm start        # 프로덕션 (sudo 필요)
npm run dev      # 개발 모드
npm run ewcsboard # 디바이스 상태 확인
```

## 시리얼 포트 설정

| 디바이스 | 포트 | Baud Rate |
|---------|------|-----------|
| PIC24 | /dev/ttyAMA0 | 115200 |
| CS125 | /dev/ttyAMA2 | 38400 |
| Spinel Camera | /dev/ttyAMA3 | 115200 |
| EPEVER | /dev/ttyACM0 | 9600 |

## 라이센스

ISC License

## 개발자

- Author: fetm
- Repository: https://github.com/fetmkr/EWCSController
