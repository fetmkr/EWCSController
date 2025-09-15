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
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        h2 {
            color: #34495e;
            margin-top: 30px;
            border-bottom: 2px solid #ecf0f1;
            padding-bottom: 5px;
        }
        h3 {
            color: #7f8c8d;
            margin-top: 20px;
        }
        .endpoint {
            background: white;
            border: 1px solid #ddd;
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
        .get { background: #61affe; color: white; }
        .post { background: #49cc90; color: white; }
        .put { background: #fca130; color: white; }
        .delete { background: #f93e3e; color: white; }
        .path {
            font-family: 'Courier New', monospace;
            font-weight: bold;
            color: #2c3e50;
        }
        .description {
            margin: 10px 0;
            color: #555;
        }
        .example {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 10px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            overflow-x: auto;
            margin: 10px 0;
        }
        .params {
            margin: 10px 0;
        }
        .param {
            background: #ecf0f1;
            padding: 5px 10px;
            border-radius: 3px;
            display: inline-block;
            margin: 3px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
        }
        .section {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .toc {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .toc ul {
            list-style-type: none;
            padding-left: 0;
        }
        .toc li {
            margin: 8px 0;
        }
        .toc a {
            color: #3498db;
            text-decoration: none;
        }
        .toc a:hover {
            text-decoration: underline;
        }
        .feature {
            background: #e8f4f8;
            border-left: 4px solid #3498db;
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
            <li><a href="#device-routes">1. Device Routes - 장치 제어</a></li>
            <li><a href="#ewcs-routes">2. EWCS Routes - 데이터 조회</a></li>
            <li><a href="#image-routes">3. Image Routes - 이미지 관리</a></li>
            <li><a href="#system-routes">4. System Routes - 시스템 설정</a></li>
            <li><a href="#features">5. 주요 특징</a></li>
        </ul>
    </div>

    <div class="section" id="device-routes">
        <h2>1. Device Routes (<code>/api/devices/*</code>)</h2>

        <h3>CS125 센서 제어</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/cs125</span>
            <div class="description">CS125 센서 전원 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/devices/cs125?on=1</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/cs125-heater</span>
            <div class="description">CS125 후드 히터 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/devices/cs125-heater?on=1</div>
        </div>

        <h3>카메라 제어</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/spinel/power</span>
            <div class="description">Spinel 카메라 전원 제어</div>
            <div class="params">
                파라미터: <span class="param">on={0|1}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/devices/spinel/power?on=1</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/spinel/capture</span>
            <div class="description">Spinel 카메라 이미지 캡처</div>
            <div class="example">curl http://localhost:8080/api/devices/spinel/capture</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/oasc/capture</span>
            <div class="description">OASC 카메라 이미지 캡처</div>
            <div class="example">curl http://localhost:8080/api/devices/oasc/capture</div>
        </div>

        <h3>상태 조회</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/spinel/status</span>
            <div class="description">Spinel 카메라 상태 조회</div>
            <div class="example">curl http://localhost:8080/api/devices/spinel/status</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/oasc/status</span>
            <div class="description">OASC 카메라 상태 조회</div>
            <div class="example">curl http://localhost:8080/api/devices/oasc/status</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/devices/status</span>
            <div class="description">모든 장치 상태 조회</div>
            <div class="example">curl http://localhost:8080/api/devices/status</div>
        </div>
    </div>

    <div class="section" id="ewcs-routes">
        <h2>2. EWCS Routes (<code>/api/ewcs/*</code>)</h2>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/ewcs/ewcs_data</span>
            <div class="description">EWCS 데이터 조회 (날짜 범위 검색 지원)</div>
            <div class="params">
                파라미터:
                <span class="param">from={timestamp}</span>
                <span class="param">to={timestamp}</span>
                <span class="param">limit={number}</span>
                <span class="param">images={true|false}</span>
            </div>
            <div class="description">시간 형식: epoch timestamp 또는 YYYY-MM-DD-HH-mm</div>
            <div class="example"># 최신 데이터 1개
curl http://localhost:8080/api/ewcs/ewcs_data

# 최근 10개 데이터
curl http://localhost:8080/api/ewcs/ewcs_data?limit=10

# 날짜 범위 검색 (이미지 포함)
curl "http://localhost:8080/api/ewcs/ewcs_data?from=2024-09-01-00-00&to=2024-09-14-23-59&images=true"</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/ewcs/ewcs_status</span>
            <div class="description">시스템 상태 및 설정 조회</div>
            <div class="example">curl http://localhost:8080/api/ewcs/ewcs_status</div>
        </div>
    </div>

    <div class="section" id="image-routes">
        <h2>3. Image Routes (<code>/api/images/*</code>)</h2>

        <h3>이미지 뷰어</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/images/{spinel|oasc}/viewer</span>
            <div class="description">HTML 이미지 갤러리 뷰어</div>
            <div class="params">
                파라미터: <span class="param">limit={number}</span>
            </div>
            <div class="example">브라우저에서 접속: http://localhost:8080/api/images/spinel/viewer?limit=20</div>
        </div>

        <h3>이미지 데이터 조회</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/images/{spinel|oasc}/images</span>
            <div class="description">이미지 메타데이터 조회 (JSON)</div>
            <div class="params">
                파라미터:
                <span class="param">from={timestamp}</span>
                <span class="param">to={timestamp}</span>
                <span class="param">limit={number}</span>
            </div>
            <div class="example"># Spinel 최근 이미지 10개
curl http://localhost:8080/api/images/spinel/images?limit=10

# OASC 날짜 범위 검색
curl "http://localhost:8080/api/images/oasc/images?from=2024-09-01-00-00&to=2024-09-14-23-59"</div>
        </div>

        <h3>정적 이미지 파일 서빙</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/images/spinel/{파일경로}</span>
            <div class="description">Spinel 카메라 이미지 파일 직접 접근</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/images/oasc/{파일경로}</span>
            <div class="description">OASC 카메라 이미지 파일 직접 접근</div>
        </div>
    </div>

    <div class="section" id="system-routes">
        <h2>4. System Routes (<code>/api/system/*</code>)</h2>

        <h3>설정 관리</h3>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/config</span>
            <div class="description">시스템 설정 조회</div>
            <div class="example">curl http://localhost:8080/api/system/config</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/data-period</span>
            <div class="description">데이터 저장 주기 조회/설정 (초 단위)</div>
            <div class="params">
                파라미터: <span class="param">value={10-3600}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/system/data-period?value=60</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/spinel-period</span>
            <div class="description">Spinel 카메라 저장 주기 조회/설정 (초 단위)</div>
            <div class="params">
                파라미터: <span class="param">value={30-1800}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/system/spinel-period?value=120</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/oasc-period</span>
            <div class="description">OASC 카메라 저장 주기 조회/설정 (초 단위)</div>
            <div class="params">
                파라미터: <span class="param">value={60-3600}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/system/oasc-period?value=300</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/oasc-exposure</span>
            <div class="description">OASC 카메라 노출시간 조회/설정 (초 단위)</div>
            <div class="params">
                파라미터: <span class="param">value={1-30}</span>
            </div>
            <div class="example">curl http://localhost:8080/api/system/oasc-exposure?value=10</div>
        </div>

        <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/system/status</span>
            <div class="description">시스템 런타임 상태 (uptime, memory)</div>
            <div class="example">curl http://localhost:8080/api/system/status</div>
        </div>
    </div>

    <div class="section" id="features">
        <h2>5. 주요 특징</h2>

        <div class="feature">
            <strong>날짜 형식:</strong> epoch timestamp 또는 YYYY-MM-DD-HH-mm 형식 지원
        </div>

        <div class="feature">
            <strong>검증:</strong> 파라미터 값 범위 자동 검증 (middleware/validation.js)
        </div>

        <div class="feature">
            <strong>에러 처리:</strong> 모든 엔드포인트에 try-catch 에러 처리
        </div>

        <div class="feature">
            <strong>정적 파일 서빙:</strong> 이미지 파일 직접 접근 가능
        </div>

        <div class="feature">
            <strong>HTML 뷰어:</strong> 웹 브라우저에서 이미지 갤러리 확인 가능
        </div>
    </div>

    <div style="text-align: center; margin-top: 40px; padding: 20px; color: #7f8c8d;">
        <p>EWCS Controller API v1.0</p>
        <p>Port: 8080</p>
    </div>
</body>
</html>
    `;

    res.send(helpHTML);
  });

  return router;
}