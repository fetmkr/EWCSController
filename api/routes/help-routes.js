import express from 'express';

export default function createHelpRoutes() {
  const router = express.Router();

  router.get('/', (req, res) => {
    const helpHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>EWCS Controller API Documentation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #000;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #fff;
        }
        h1 {
            color: #000;
            border-bottom: 3px solid #000;
            padding-bottom: 10px;
        }
        h2 {
            color: #000;
            margin-top: 30px;
            border-bottom: 2px solid #ccc;
            padding-bottom: 5px;
        }
        h3 {
            color: #333;
            margin-top: 20px;
        }
        .endpoint {
            background: #fff;
            border: 1px solid #000;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .method {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 12px;
            margin-right: 10px;
        }
        .get { background: #000; color: white; }
        .post { background: #333; color: white; }
        .path {
            font-family: 'Courier New', monospace;
            font-weight: bold;
            color: #000;
        }
        .description {
            margin: 10px 0;
            color: #000;
        }
        .example {
            background: #000;
            color: #fff;
            padding: 10px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            overflow-x: auto;
            margin: 10px 0;
            white-space: pre;
        }
        .params {
            margin: 10px 0;
        }
        .param {
            background: #f0f0f0;
            padding: 5px 10px;
            border-radius: 3px;
            display: inline-block;
            margin: 3px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
        }
        .section {
            background: #fff;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border: 1px solid #ccc;
        }
        .toc {
            background: #fff;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border: 1px solid #ccc;
        }
        .toc ul {
            list-style-type: none;
            padding-left: 0;
        }
        .toc li {
            margin: 8px 0;
        }
        .toc a {
            color: #000;
            text-decoration: none;
        }
        .toc a:hover {
            text-decoration: underline;
        }
        .feature {
            background: #f0f0f0;
            border-left: 4px solid #000;
            padding: 10px 15px;
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <h1>EWCS Controller API Documentation</h1>

    <div class="toc">
        <h2>목차</h2>
        <ul>
            <li><a href="#ewcs-routes">1. EWCS Routes - 데이터 조회 및 장치 제어</a></li>
            <li><a href="#schedule-routes">2. Schedule Routes - 스케줄 관리</a></li>
            <li><a href="#image-routes">3. Image Routes - 이미지 관리</a></li>
            <li><a href="#file-routes">4. File Routes - 파일 제공</a></li>
            <li><a href="#other-routes">5. 기타</a></li>
        </ul>
    </div>

    <div class="section" id="ewcs-routes">
        <h2>1. EWCS Routes (<code>/api/*</code>)</h2>

        <h3>데이터 조회</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/ewcs_data</span>
            <div class="description">EWCS 센서 데이터 조회</div>
            <div class="params">
                파라미터:
                <span class="param">from={timestamp}</span>
                <span class="param">to={timestamp}</span>
                <span class="param">limit={number}</span>
                <span class="param">images={true|false}</span>
            </div>
            <div class="description">
                <strong>시간 형식:</strong> epoch timestamp (1234567890) 또는 YYYY-MM-DD-HH-mm (2025-09-20-15-30)<br>
                <strong>기본 동작:</strong> 파라미터 없으면 최신 데이터 1개 반환
            </div>
            <div class="example"># 최신 데이터 1개 (기본)
curl http://192.168.0.203:8080/api/ewcs_data

# 응답 예시
{
  "query": {},
  "count": 1,
  "data": [
    {
      "id": 3773,
      "timestamp": 1758380599741,
      "station_name": "hello station",
      "cs125_visibility": 0,
      "cs125_synop": 0,
      "cs125_temp": 0,
      "cs125_humidity": 0,
      "sht45_temp": 28.309,
      "sht45_humidity": 61.91,
      "rpi_temp": 46.7,
      "chan1_current": 74.121,
      "chan2_current": 0,
      "chan3_current": 3.223,
      "chan4_current": 0,
      "pv_vol": 0,
      "pv_cur": 0,
      "load_vol": 0,
      "load_cur": 0,
      "bat_temp": 0,
      "dev_temp": 0,
      "charg_equip_stat": 0,
      "dischg_equip_stat": 0,
      "timestamp_readable": "2025-09-20T15:03:19.741Z"
    }
  ],
  "timestamp": 1758380722327
}

# 최근 10개 데이터
curl http://192.168.0.203:8080/api/ewcs_data?limit=10

# epoch timestamp로 날짜 범위 검색
curl "http://192.168.0.203:8080/api/ewcs_data?from=1758355800&to=1758442200&limit=50"

# 읽기 쉬운 날짜 형식으로 검색
curl "http://192.168.0.203:8080/api/ewcs_data?from=2025-09-20-09-00&to=2025-09-20-18-00&limit=50"

# 이미지 메타데이터 포함
curl "http://192.168.0.203:8080/api/ewcs_data?limit=5&images=true"

# 특정 시작 시점부터 현재까지
curl "http://192.168.0.203:8080/api/ewcs_data?from=2025-09-20-00-00&limit=100"</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/ewcs_data/now</span>
            <div class="description">실시간 EWCS 데이터 수집 후 반환</div>
            <div class="description">
                <strong>동작:</strong> 모든 센서에서 즉시 데이터를 수집하고 현재 상태를 반환<br>
                <strong>용도:</strong> 최신 상태 확인, 센서 테스트, 실시간 모니터링
            </div>
            <div class="example"># 현재 센서 데이터 수집 및 반환
curl http://192.168.0.203:8080/api/ewcs_data/now
</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/ewcs_status</span>
            <div class="description">EWCS 시스템 상태 (설정, 네트워크, 장치연결, 로그, 시스템정보)</div>
            <div class="description">
                <strong>포함 정보:</strong> 시스템 설정, 스케줄, 네트워크, 장치연결, 로그, 시스템정보<br>
                <strong>용도:</strong> 시스템 진단, 연결 상태 확인, 문제 해결
            </div>
            <div class="example"># 전체 시스템 상태 조회
curl http://192.168.0.203:8080/api/ewcs_status

# 응답 예시
{
  "settings": {
    "stationName": "hello station",
    "oascExposureTime": 33.2,
    "lastCleanupDate": "2024-12-31"
  },
  "schedules": {
    "onoff_schedule": {
      "mode": 0,
      "onMin": 55,
      "offMin": 3,
      "description": "Disabled"
    },
    "satellite_schedule": {
      "hour": 1,
      "min": 0,
      "description": "Daily satellite transmission at 01:00"
    }
  },
  "network_info": {
    "ipAddress": "192.168.0.203",
    "gateway": "192.168.0.1"
  },
  "device_connections": {
    "cs125Connected": 0,
    "cameraConnected": 0,
    "OASCConnected": 0,
    "EPEVERConnected": 0,
    "ADCConnected": 1,
    "SHT45Connected": 1
  },
  "recent_events": [
    {
      "timestamp": "2025-09-20T15:03:13.621Z",
      "event": "System started"
    }
  ],
  "system_info": {
    "uptime": 49.720547546,
    "memory": {
      "rss": 65961984,
      "heapTotal": 9613312,
      "heapUsed": 7544720,
      "external": 2704272,
      "arrayBuffers": 301275
    }
  },
  "timestamp": 1758380642318
}</div>
        </div>

        <h3>시스템 설정</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/station-name</span>
            <div class="description">스테이션 이름 조회/설정</div>
            <div class="params">
                파라미터: <span class="param">value={station_name}</span> (선택사항, 1-16글자)
            </div>
            <div class="description">
                <strong>기본 동작:</strong> 파라미터 없으면 현재 스테이션 이름 반환<br>
                <strong>자동 처리:</strong> 16글자 초과 시 자동으로 잘라냄
            </div>
            <div class="example"># 현재 스테이션 이름 조회
curl http://192.168.0.203:8080/api/station-name

# 응답 예시
{"stationName":"hello station"}

# 스테이션 이름 설정
curl http://192.168.0.203:8080/api/station-name?value=STATION_01

# 긴 이름 설정 (자동으로 16글자로 잘림)
curl "http://192.168.0.203:8080/api/station-name?value=VeryLongStationNameThatWillBeTruncated"

# URL 인코딩 필요한 특수문자
curl "http://192.168.0.203:8080/api/station-name?value=Station%20A1"</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/oasc/exposure</span>
            <div class="description">OASC 노출시간 조회/설정 (초)</div>
            <div class="params">
                파라미터: <span class="param">value={0-3600}</span> (선택사항, 0-3600초)
            </div>
            <div class="description">
                <strong>기본 동작:</strong> 파라미터 없으면 현재 노출시간 반환<br>
                <strong>범위:</strong> 0초(즉시) ~ 3600초(1시간)
            </div>
            <div class="example"># 현재 노출시간 조회
curl http://192.168.0.203:8080/api/oasc/exposure

# 30초 노출시간 설정
curl http://192.168.0.203:8080/api/oasc/exposure?value=30

# 최대 노출시간 (1시간)
curl http://192.168.0.203:8080/api/oasc/exposure?value=3600</div>
        </div>

        <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/network/config</span>
            <div class="description">네트워크 설정 변경 (IP, 게이트웨이, 서브넷)</div>
            <div class="params">
                JSON 파라미터:
                <span class="param">ip: string</span> (필수, IPv4 주소)
                <span class="param">gateway: string</span> (선택적, IPv4 주소)
                <span class="param">subnet: string</span> (선택적, CIDR 1-30, 기본값: 24)
            </div>
            <div class="description">
                <strong>동작:</strong> 네트워크 설정을 즉시 변경하고 네트워크 재시작<br>
                <strong>IP 범위:</strong> 모든 유효한 IPv4 주소 (예: 10.0.1.100, 172.16.0.50)<br>
                <strong>주의:</strong> 네트워크 재시작으로 1-2초간 연결 끊김, 응답을 받지 못할 수 있음
            </div>
            <div class="example"># 전체 네트워크 설정 변경
curl -X POST -H "Content-Type: application/json" \
  -d '{"ip": "10.0.1.100", "gateway": "10.0.1.1", "subnet": "24"}' \
  http://192.168.0.203:8080/api/network/config

# IP만 변경 (게이트웨이와 서브넷은 기존 유지)
curl -X POST -H "Content-Type: application/json" \
  -d '{"ip": "10.0.1.200"}' \
  http://192.168.0.203:8080/api/network/config

# 다른 서브넷으로 변경
curl -X POST -H "Content-Type: application/json" \
  -d '{"ip": "172.16.0.100", "gateway": "172.16.0.1", "subnet": "16"}' \
  http://192.168.0.203:8080/api/network/config

# 응답 예시
{
  "success": true,
  "config": {
    "ip": "10.0.1.100",
    "gateway": "10.0.1.1",
    "subnet": "24"
  },
  "message": "Network configuration changed successfully. Network restarting..."
}

# 변경 후 새 IP로 접속
curl http://10.0.1.100:8080/api/ewcs_status</div>
        </div>


        <h3>장치 제어</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/cs125-heater</span>
            <div class="description">CS125 후드 히터 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span> (필수, 0=끄기, 1=켜기)
            </div>
            <div class="description">
                <strong>용도:</strong> 겨울철 결빙 방지, 센서 보호<br>
                <strong>응답:</strong> 실제 명령 성공/실패 상태 반환
            </div>
            <div class="example"># 히터 켜기
curl http://192.168.0.203:8080/api/cs125-heater?on=1

# 히터 끄기
curl http://192.168.0.203:8080/api/cs125-heater?on=0
</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/spinel/capture</span>
            <div class="description">Spinel 카메라 촬영</div>
            <div class="description">
                <strong>동작:</strong> 즉시 이미지 촬영하고 파일 저장<br>
                <strong>저장위치:</strong> ewcs_images/ 폴더<br>
                <strong>파일형식:</strong> timestamp.jpg (예: 1758355800000.jpg)
            </div>
            <div class="example"># 즉시 촬영
curl http://192.168.0.203:8080/api/spinel/capture

# 촬영 결과를 JSON 파일로 저장
curl http://192.168.0.203:8080/api/spinel/capture > capture_result.json</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/oasc/capture</span>
            <div class="description">OASC 카메라 촬영</div>
            <div class="description">
                <strong>동작:</strong> 설정된 노출시간으로 이미지 촬영<br>
                <strong>저장위치:</strong> oasc_images/ 폴더<br>
                <strong>파일형식:</strong> timestamp.fits (예: 1758355800000.fits)
            </div>
            <div class="example"># 즉시 촬영 (현재 노출시간 사용)
curl http://192.168.0.203:8080/api/oasc/capture</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/vout{1-4}</span>
            <div class="description">PIC24 VOUT 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span> (필수, 0=끄기, 1=켜기)
            </div>
            <div class="description">
                <strong>채널:</strong> VOUT1~4 (각각 독립적으로 제어)<br>
                <strong>용도:</strong> 외부 장치 전원 공급 제어<br>
                <strong>응답:</strong> 실제 PIC24 통신 결과 반환
            </div>
            <div class="example"># VOUT1 켜기
curl http://192.168.0.203:8080/api/vout1?on=1

# VOUT2 끄기
curl http://192.168.0.203:8080/api/vout2?on=0</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/power-save</span>
            <div class="description">PIC24 절전 모드 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span> (필수, 0=비활성화, 1=활성화)
            </div>
            <div class="description">
                <strong>용도:</strong> 배터리 수명 연장, 소비전력 감소<br>
                <strong>주의:</strong> 절전 모드 시 일부 기능 제한될 수 있음
            </div>
            <div class="example"># 절전 모드 활성화
curl http://192.168.0.203:8080/api/power-save?on=1

# 절전 모드 비활성화
curl http://192.168.0.203:8080/api/power-save?on=0</div>
        </div>

        <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/satellite/start</span>
            <div class="description">위성 전송 시작</div>
            <div class="description">
                <strong>동작:</strong> PIC24를 통해 위성 통신 시작<br>
                <strong>용도:</strong> 데이터 전송, 원격 통신<br>
                <strong>방식:</strong> POST 요청 (데이터 전송 명령)
            </div>
            <div class="example"># 위성 전송 시작
curl -X POST http://192.168.0.203:8080/api/satellite/start</div>
        </div>
    </div>

    <div class="section" id="schedule-routes">
        <h2>2. Schedule Routes (<code>/api/schedule/*</code>)</h2>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/schedule/onoff</span>
            <div class="description">ON/OFF 스케줄 조회</div>
            <div class="description">
                <strong>응답 정보:</strong> 현재 설정된 ON/OFF 스케줄 모드와 시간<br>
                <strong>모드:</strong> 0=비활성화, 1=매시간, 2=10분마다
            </div>
            <div class="example"># 현재 ON/OFF 스케줄 조회
curl http://192.168.0.203:8080/api/schedule/onoff

# 응답 예시
{"mode":0,"onMin":55,"offMin":3,"description":"Disabled"}</div>
        </div>

        <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/schedule/onoff</span>
            <div class="description">ON/OFF 스케줄 설정</div>
            <div class="params">
                JSON 파라미터:
                <span class="param">mode: 0|1|2</span> (0=비활성화, 1=매시간, 2=10분마다)
                <span class="param">onMin: number</span> (ON 시점)
                <span class="param">offMin: number</span> (OFF 시점)
            </div>
            <div class="description">
                <strong>모드 0:</strong> 스케줄 비활성화 (테스트용)<br>
                <strong>모드 1:</strong> onMin, offMin은 0-59 (분)<br>
                <strong>모드 2:</strong> onMin, offMin은 0-9 (10분 단위의 분)
            </div>
            <div class="example"># 스케줄 비활성화 (스케쥴러 끄고 설정 테스트 할때 용이)
curl -X POST -H "Content-Type: application/json" \
  -d '{"mode": 0, "onMin": 0, "offMin": 0}' \
  http://192.168.0.203:8080/api/schedule/onoff

# 매시간 15분에 ON, 45분에 OFF
curl -X POST -H "Content-Type: application/json" \
  -d '{"mode": 1, "onMin": 15, "offMin": 45}' \
  http://192.168.0.203:8080/api/schedule/onoff

# 10분마다 3분에 ON, 8분에 OFF
curl -X POST -H "Content-Type: application/json" \
  -d '{"mode": 2, "onMin": 3, "offMin": 8}' \
  http://192.168.0.203:8080/api/schedule/onoff

# 매시간 정시에 ON, 30분에 OFF
curl -X POST -H "Content-Type: application/json" \
  -d '{"mode": 1, "onMin": 0, "offMin": 30}' \
  http://192.168.0.203:8080/api/schedule/onoff</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/schedule/satellite</span>
            <div class="description">위성 전송 스케줄 조회</div>
            <div class="description">
                <strong>응답 정보:</strong> 매일 위성 전송 시간<br>
                <strong>형식:</strong> 24시간 형식 (hour: 0-23, min: 0-59)
            </div>
            <div class="example"># 현재 위성 전송 스케줄 조회
curl http://192.168.0.203:8080/api/schedule/satellite

# 응답 예시
{"hour":1,"min":0,"description":"Daily satellite transmission at 01:00"}</div>
        </div>

        <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/schedule/satellite</span>
            <div class="description">위성 전송 스케줄 설정</div>
            <div class="params">
                JSON 파라미터:
                <span class="param">hour: 0-23</span> (시간)
                <span class="param">min: 0-59</span> (분)
            </div>
            <div class="description">
                <strong>동작:</strong> 매일 지정된 시간에 자동 위성 전송<br>
                <strong>시간 형식:</strong> 24시간 형식
            </div>
            <div class="example"># 매일 오후 12시 30분에 전송
curl -X POST -H "Content-Type: application/json" \
  -d '{"hour": 12, "min": 30}' \
  http://192.168.0.203:8080/api/schedule/satellite

# 매일 새벽 3시에 전송
curl -X POST -H "Content-Type: application/json" \
  -d '{"hour": 3, "min": 0}' \
  http://192.168.0.203:8080/api/schedule/satellite</div>
        </div>
    </div>

    <div class="section" id="image-routes">
        <h2>3. Image Routes (<code>/api/image/*</code>)</h2>

        <h3>이미지 메타데이터</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/image/{spinel|oasc}/data</span>
            <div class="description">이미지 메타데이터 조회</div>
            <div class="params">
                파라미터:
                <span class="param">from={timestamp}</span>
                <span class="param">to={timestamp}</span>
                <span class="param">limit={number}</span>
            </div>
            <div class="description">
                <strong>기본 동작:</strong> 파라미터 없으면 최신 이미지 1개 반환 (ewcs_data와 동일)
            </div>
            <div class="example"># 최신 이미지 1개 (기본)
curl http://192.168.0.203:8080/api/image/spinel/data

# 응답 예시
{
  "camera": "spinel",
  "query": {
    "from": 0,
    "to": 1758380797597,
    "from_readable": "1970-01-01T00:00:00.000Z",
    "to_readable": "2025-09-20T15:06:37.597Z"
  },
  "count": 1,
  "images": [
    {
      "id": 3200,
      "timestamp": 1757927526467,
      "filename": "1757927517461.jpg",
      "timestamp_readable": "2025-09-15T09:12:06.467Z"
    }
  ],
  "timestamp": 1758380797597
}

# 최근 이미지 5개
curl http://192.168.0.203:8080/api/image/spinel/data?limit=5

# 날짜 범위로 검색 (읽기 쉬운 형식)
curl "http://192.168.0.203:8080/api/image/oasc/data?from=2025-09-20-09-00&to=2025-09-20-18-00"

# epoch timestamp로 검색
curl "http://192.168.0.203:8080/api/image/spinel/data?from=1758355800&to=1758442200&limit=20"

# 특정 시간부터 현재까지
curl "http://192.168.0.203:8080/api/image/oasc/data?from=2025-09-20-12-00&limit=50"

# OASC 최신 이미지 1개만
curl http://192.168.0.203:8080/api/image/oasc/data?limit=1</div>
        </div>

        <h3>이미지 뷰어</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/image/{spinel|oasc}/viewer</span>
            <div class="description">HTML 이미지 갤러리 뷰어</div>
            <div class="params">
                파라미터: <span class="param">limit={number}</span> (선택사항, 기본값: 20)
            </div>
            <div class="description">
                <strong>기능:</strong> 웹 브라우저에서 이미지 썸네일과 메타데이터 표시<br>
                <strong>탐색:</strong> 카메라 간 전환, 전체 크기 보기 지원
            </div>
            <div class="example"># 브라우저에서 Spinel 이미지 갤러리 (기본 20개)
브라우저에서: http://192.168.0.203:8080/api/image/spinel/viewer

# OASC 이미지 갤러리
브라우저에서: http://192.168.0.203:8080/api/image/oasc/viewer

# 최근 이미지 50개 표시
브라우저에서: http://192.168.0.203:8080/api/image/spinel/viewer?limit=50

# 많은 이미지 표시 (100개)
브라우저에서: http://192.168.0.203:8080/api/image/oasc/viewer?limit=100</div>
        </div>
    </div>

    <div class="section" id="file-routes">
        <h2>4. File Routes (<code>/file/image/*</code>)</h2>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/file/image/spinel/{filename}</span>
            <div class="description">Spinel 이미지 파일 제공</div>
            <div class="description">
                <strong>경로 구조:</strong> /file/image/spinel/[년-월]/[timestamp].jpg<br>
                <strong>파일 형식:</strong> JPEG 이미지<br>
                <strong>용도:</strong> 직접 이미지 파일 다운로드, 웹 페이지 임베딩
            </div>
            <div class="example"># 브라우저에서 직접 보기
브라우저에서: http://192.168.0.203:8080/file/image/spinel/2025-09/1758355800000.jpg</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/file/image/oasc/{filename}</span>
            <div class="description">OASC 이미지 파일 제공</div>
            <div class="description">
                <strong>경로 구조:</strong> /file/image/oasc/[년-월]/jpg/[timestamp].jpg<br>
                <strong>파일 형식:</strong> JPEG 변환된 이미지 (원본은 FITS)<br>
                <strong>원본:</strong> FITS 파일도 별도 폴더에 저장됨
            </div>
            <div class="example"># 브라우저에서 직접 보기
브라우저에서: http://192.168.0.203:8080/file/image/oasc/2025-09/jpg/1758355800000.jpg</div>
        </div>
    </div>

    <div class="section" id="other-routes">
        <h2>5. 기타</h2>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/help</span>
            <div class="description">API 도움말 (이 페이지)</div>
            <div class="description">
                <strong>내용:</strong> 모든 API 엔드포인트의 상세 사용법과 예제<br>
                <strong>형식:</strong> HTML 문서 (브라우저에서 보기 권장)
            </div>
            <div class="example"># 브라우저에서 도움말 보기
브라우저에서: http://192.168.0.203:8080/api/help</div>
        </div>


        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/</span>
            <div class="description">루트 정보</div>
            <div class="description">
                <strong>내용:</strong> 서비스 기본 정보, 버전, 시작 시간<br>
                <strong>용도:</strong> 서비스 정보 확인, 기본 상태 점검
            </div>
            <div class="example"># 서비스 기본 정보 확인
curl http://192.168.0.203:8080/</div>
        </div>
    </div>


    <div style="text-align: center; margin-top: 40px; padding: 20px; color: #7f8c8d;">
        <p>EWCS Controller API v2.0</p>
        <p>Port: 8080</p>
        <p>Updated: 2025</p>
    </div>
</body>
</html>
    `;

    res.send(helpHTML);
  });

  return router;
}