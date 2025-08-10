#include <napi.h>
#include <libusb-1.0/libusb.h>
#include <string>
#include <thread>
#include <chrono>

// SX 카메라 관련 상수
#define SX_VID                     0x1278  // Starlight Xpress Vendor ID
#define SX_ECHO2_PID               0x0525  // Starlight Xpress ECHO2 Product ID
#define SXUSB_GET_FIRMWARE_VERSION 0x11    // 기존 펌웨어 버전 명령
#define SXUSB_CAMERA_MODEL         0x14    // 기존 카메라 모델 명령

// ECHO2 카메라용 벌크 전송 명령 코드
#define SX_CMD_TYPE                0x40    // 명령 타입 바이트
#define ECHO2_GET_FIRMWARE_VERSION 0xFF    // 대체 펌웨어 버전 명령
#define ECHO2_CAMERA_MODEL         0xFE    // 대체 카메라 모델 명령
#define ECHO2_INIT_CMD             0x01    // 초기화 명령
#define ECHO2_IMAGE_SETUP_CMD      0x02    // 이미지 설정 명령
#define ECHO2_EXPOSURE_CMD         0x00    // 노출 명령

class SXCamera : public Napi::ObjectWrap<SXCamera> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  SXCamera(const Napi::CallbackInfo& info);
  ~SXCamera();

private:
  static Napi::FunctionReference constructor;
  
  // 메서드
  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value GetFirmwareVersion(const Napi::CallbackInfo& info);
  Napi::Value GetCameraModel(const Napi::CallbackInfo& info);
  Napi::Value IsConnected(const Napi::CallbackInfo& info);
  Napi::Value GetLastError(const Napi::CallbackInfo& info);
  Napi::Value CaptureImage(const Napi::CallbackInfo& info);

    // 디버깅 함수 추가 - 이 부분을 추가하세요
  bool DebugUSBCommands();
  Napi::Value DebugCamera(const Napi::CallbackInfo& info);

  
  // 내부 함수
  bool FindEndpoints(int interface_number);
  bool ClaimAnyInterface();
  bool GetFirmwareVersionInternal(float &version);
  bool SendTwoStageCommand(unsigned char cmdCode, unsigned char *responseData, int &responseLength);
  bool CaptureImageInternal(unsigned short *buffer, int &width, int &height, float exposureTime);
  
  // 필드
  libusb_device_handle *handle;
  libusb_context *ctx;
  std::string lastError;
  int claimedInterface;  // 클레임한 인터페이스 번호
  int bulkInEndpoint;    // 입력 엔드포인트 (0x82)
  int bulkOutEndpoint;   // 출력 엔드포인트 (0x01)
  
  // 이미지 관련 정보
  int width;          // 이미지 너비 (1392)
  int height;         // 이미지 높이 (1040) 
  int bitsPerPixel;   // 이미지 비트심도 (16)
};

Napi::FunctionReference SXCamera::constructor;

Napi::Object SXCamera::Init(Napi::Env env, Napi::Object exports) {
  Napi::HandleScope scope(env);
  
  Napi::Function func = DefineClass(env, "SXCamera", {
    InstanceMethod("open", &SXCamera::Open),
    InstanceMethod("close", &SXCamera::Close),
    InstanceMethod("getFirmwareVersion", &SXCamera::GetFirmwareVersion),
    InstanceMethod("getCameraModel", &SXCamera::GetCameraModel),
    InstanceMethod("isConnected", &SXCamera::IsConnected),
    InstanceMethod("getLastError", &SXCamera::GetLastError),
    InstanceMethod("captureImage", &SXCamera::CaptureImage),

    InstanceMethod("debugCamera", &SXCamera::DebugCamera)

  });
  
  constructor = Napi::Persistent(func);
  constructor.SuppressDestruct();
  
  exports.Set("SXCamera", func);
  return exports;
}

SXCamera::SXCamera(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<SXCamera>(info), 
    handle(nullptr), 
    ctx(nullptr), 
    claimedInterface(-1), 
    bulkInEndpoint(0x82),  // 와이어샤크에서 확인된 IN 엔드포인트
    bulkOutEndpoint(0x01), // 와이어샤크에서 확인된 OUT 엔드포인트
    width(1392),          // ECHO2 카메라 해상도
    height(1040),         // ECHO2 카메라 해상도
    bitsPerPixel(16)      // 16비트 이미지
{
  // libusb 초기화
  libusb_init(&ctx);
  
  // 디버그 모드 활성화 (2는 info 레벨, 3은 debug 레벨)
  libusb_set_option(ctx, LIBUSB_OPTION_LOG_LEVEL, 3);
}

SXCamera::~SXCamera() {
  // 정리
  if (handle) {
    if (claimedInterface >= 0) {
      libusb_release_interface(handle, claimedInterface);
    }
    libusb_close(handle);
    handle = nullptr;
  }
  
  if (ctx) {
    libusb_exit(ctx);
    ctx = nullptr;
  }
}

bool SXCamera::FindEndpoints(int interface_number) {
  libusb_config_descriptor *config;
  int res = libusb_get_active_config_descriptor(libusb_get_device(handle), &config);
  
  if (res < 0) {
    lastError = "설정 디스크립터를 가져올 수 없습니다: " + std::string(libusb_error_name(res));
    return false;
  }
  
  bool found = false;
  
  // 인터페이스 검색
  if (interface_number < config->bNumInterfaces) {
    const libusb_interface *interface = &config->interface[interface_number];
    
    for (int j = 0; j < interface->num_altsetting; j++) {
      const libusb_interface_descriptor *intf = &interface->altsetting[j];
      
      printf("인터페이스 %d, Alt Setting %d: 엔드포인트 %d개\n", 
             interface_number, j, intf->bNumEndpoints);
      
      // 각 엔드포인트 검사
      for (int k = 0; k < intf->bNumEndpoints; k++) {
        const libusb_endpoint_descriptor *ep = &intf->endpoint[k];
        
        // 엔드포인트 방향 확인
        if (ep->bEndpointAddress & LIBUSB_ENDPOINT_IN) {
          bulkInEndpoint = ep->bEndpointAddress;
          printf("IN 엔드포인트 발견: 0x%02x\n", bulkInEndpoint);
          found = true;
        } else {
          bulkOutEndpoint = ep->bEndpointAddress;
          printf("OUT 엔드포인트 발견: 0x%02x\n", bulkOutEndpoint);
          found = true;
        }
      }
    }
  }
  
  libusb_free_config_descriptor(config);
  return found;
}

bool SXCamera::ClaimAnyInterface() {
  libusb_config_descriptor *config;
  int res = libusb_get_active_config_descriptor(libusb_get_device(handle), &config);
  
  if (res < 0) {
    lastError = "설정 디스크립터를 가져올 수 없습니다: " + std::string(libusb_error_name(res));
    return false;
  }
  
  bool claimed = false;
  
  // 먼저 인터페이스 1 시도 (Wireshark 분석 기반)
  res = libusb_claim_interface(handle, 1);
  if (res == 0) {
    printf("인터페이스 1 클레임 성공\n");
    claimed = true;
    claimedInterface = 1;
    FindEndpoints(1);
  } else {
    printf("인터페이스 1 클레임 실패: %s\n", libusb_error_name(res));
    
    // 다른 모든 인터페이스 시도
    for (int i = 0; i < config->bNumInterfaces; i++) {
      if (i == 1) continue; // 이미 시도함
      
      res = libusb_claim_interface(handle, i);
      if (res == 0) {
        printf("인터페이스 %d 클레임 성공\n", i);
        claimed = true;
        claimedInterface = i;
        FindEndpoints(i);
        break;
      } else {
        printf("인터페이스 %d 클레임 실패: %s\n", i, libusb_error_name(res));
      }
    }
  }
  
  libusb_free_config_descriptor(config);
  return claimed;
}

Napi::Value SXCamera::Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  // 이미 연결되어 있으면 성공으로 반환
  if (handle) {
    return Napi::Boolean::New(env, true);
  }
  
  // USB 장치 검색
  libusb_device **devs;
  libusb_device *dev = nullptr;
  int count = libusb_get_device_list(ctx, &devs);
  
  if (count < 0) {
    lastError = "USB 장치 목록을 가져올 수 없습니다.";
    return Napi::Boolean::New(env, false);
  }
  
  printf("USB 장치 검색 중...\n");
  
  // SX 카메라 찾기 (ECHO2 제품 ID 포함)
  for (int i = 0; i < count; i++) {
    libusb_device_descriptor desc;
    int res = libusb_get_device_descriptor(devs[i], &desc);
    
    if (res < 0) {
      continue;
    }
    
    // 벤더 ID 출력
    printf("검색 중: VID=0x%04x, PID=0x%04x\n", desc.idVendor, desc.idProduct);
    
    // Starlight Xpress ECHO2 장치 확인
    if (desc.idVendor == SX_VID && desc.idProduct == SX_ECHO2_PID) {
      printf("Starlight Xpress ECHO2 카메라 발견!\n");
      dev = devs[i];
      break;
    }
  }
  
  // 장치가 없으면 실패
  if (!dev) {
    libusb_free_device_list(devs, 1);
    lastError = "Starlight Xpress ECHO2 카메라를 찾을 수 없습니다.";
    return Napi::Boolean::New(env, false);
  }
  
  // 장치 열기
  int res = libusb_open(dev, &handle);
  
  if (res < 0) {
    lastError = "카메라를 열 수 없습니다: " + std::string(libusb_error_name(res));
    libusb_free_device_list(devs, 1);
    handle = nullptr;
    return Napi::Boolean::New(env, false);
  }
  
  // 구성 정보 가져오기
  libusb_config_descriptor *config;
  res = libusb_get_active_config_descriptor(dev, &config);
  libusb_free_device_list(devs, 1);
  
  if (res < 0) {
    lastError = "설정 정보를 가져올 수 없습니다: " + std::string(libusb_error_name(res));
    libusb_close(handle);
    handle = nullptr;
    return Napi::Boolean::New(env, false);
  }
  
  printf("장치 정보: %d개의 인터페이스\n", config->bNumInterfaces);
  
  // 커널 드라이버가 활성화되어 있는지 확인
  for (int i = 0; i < config->bNumInterfaces; i++) {
    int active = libusb_kernel_driver_active(handle, i);
    if (active) {
      printf("인터페이스 %d에 커널 드라이버가 활성화되어 있습니다. 분리 시도...\n", i);
      int err = libusb_detach_kernel_driver(handle, i);
      if (err) {
        printf("커널 드라이버 분리 실패: %s\n", libusb_error_name(err));
      } else {
        printf("커널 드라이버 분리 성공\n");
      }
    }
  }
  
  // 인터페이스 클레임
  if (!ClaimAnyInterface()) {
    lastError = "어떤 인터페이스도 클레임할 수 없습니다.";
    libusb_close(handle);
    handle = nullptr;
    return Napi::Boolean::New(env, false);
  }
  
  printf("카메라 연결 성공. 인터페이스: %d, 입력 엔드포인트: 0x%02x, 출력 엔드포인트: 0x%02x\n", 
         claimedInterface, bulkInEndpoint, bulkOutEndpoint);
  
  // 장치 재설정 시도
  res = libusb_reset_device(handle);
  if (res < 0) {
    printf("장치 재설정 경고: %s\n", libusb_error_name(res));
    // 계속 진행
  }
  
  return Napi::Boolean::New(env, true);
}

Napi::Value SXCamera::Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (handle) {
    if (claimedInterface >= 0) {
      libusb_release_interface(handle, claimedInterface);
      claimedInterface = -1;
    }
    libusb_close(handle);
    handle = nullptr;
  }
  
  return env.Undefined();
}

bool SXCamera::GetFirmwareVersionInternal(float &version) {
  // 기존 컨트롤 전송 방식 시도
  unsigned char data[16] = {0};
  
  printf("기존 방식으로 펌웨어 버전 요청 (명령 0x%02x)...\n", SXUSB_GET_FIRMWARE_VERSION);
  
  int res = libusb_control_transfer(
    handle,
    LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR,
    SXUSB_GET_FIRMWARE_VERSION,
    0, 0,
    data, 16,
    5000
  );
  
  if (res >= 2) {
    int versionInt = data[0] | (data[1] << 8);
    version = versionInt / 100.0f;
    printf("기존 방식으로 펌웨어 버전 가져오기 성공: %.2f\n", version);
    return true;
  }
  
  printf("기존 방식 실패. 새로운 벌크 전송 방식으로 시도...\n");
  
  // 새로운 벌크 전송 방식 시도 (Wireshark 분석 기반)
  // 1단계: 명령 전송
  unsigned char cmd[8] = {SX_CMD_TYPE, ECHO2_GET_FIRMWARE_VERSION, 0, 0, 0, 0, 0, 0};
  int transferred = 0;
  
  printf("벌크 전송 방식으로 펌웨어 버전 명령 전송: %02x %02x ...\n", cmd[0], cmd[1]);
  
  res = libusb_bulk_transfer(
    handle,
    bulkOutEndpoint,  // OUT 엔드포인트
    cmd, 
    sizeof(cmd),
    &transferred,
    5000   // 타임아웃
  );
  
  if (res < 0) {
    printf("펌웨어 버전 명령 전송 실패: %s\n", libusb_error_name(res));
    lastError = "펌웨어 버전 명령 전송 실패: " + std::string(libusb_error_name(res));
    return false;
  }
  
  // 2단계: 응답 데이터 읽기
  unsigned char verData[4] = {0};
  
  res = libusb_bulk_transfer(
    handle,
    bulkInEndpoint,  // IN 엔드포인트
    verData,
    sizeof(verData),
    &transferred,
    5000   // 타임아웃
  );
  
  if (res < 0 || transferred < 4) {
    printf("펌웨어 버전 데이터 읽기 실패: %s\n", libusb_error_name(res));
    lastError = "펌웨어 버전 데이터 읽기 실패: " + std::string(libusb_error_name(res));
    return false;
  }
  
  // 데이터 출력
  printf("펌웨어 버전 데이터 (%d 바이트): ", transferred);
  for (int i = 0; i < transferred; i++) {
    printf("%02x ", verData[i]);
  }
  printf("\n");
  
  // 버전 해석 (Wireshark 분석 기반)
  int minor = verData[0];  // 0x1b = 27
  int major = verData[2];  // 0x01 = 1
  
  // 버전 값 설정
  version = major + (minor / 100.0f);
  printf("펌웨어 버전: %.2f\n", version);
  
  return true;
}

Napi::Value SXCamera::GetFirmwareVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!handle) {
    Napi::Error::New(env, "카메라가 연결되어 있지 않습니다.").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  float version = 0.0f;
  bool success = GetFirmwareVersionInternal(version);
  
  if (!success) {
    Napi::Error::New(env, lastError).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  return Napi::Number::New(env, version);
}

Napi::Value SXCamera::GetCameraModel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!handle) {
    Napi::Error::New(env, "카메라가 연결되어 있지 않습니다.").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  // 컨트롤 전송으로 모델 정보 요청
  unsigned char data[2] = {0};
  
  printf("컨트롤 전송으로 카메라 모델 요청 (명령 0x%02x)...\n", 14);
  
  int res = libusb_control_transfer(
    handle,
    LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR,
    14, // CAMERA_MODEL
    0, 0, // VALUE, INDEX
    data, 2, // 2바이트 데이터
    5000 // 타임아웃
  );
  
  if (res < 0) {
    std::string error = "카메라 모델을 가져오지 못했습니다: " + std::string(libusb_error_name(res));
    printf("오류: %s\n", error.c_str());
    
    // 오류가 발생해도 계속 진행 (ECHO2로 간주)
    printf("ECHO2 카메라로 간주하고 계속 진행합니다.\n");
    
    // ECHO2로 강제 설정
    Napi::Object result = Napi::Object::New(env);
    result.Set("modelCode", Napi::Number::New(env, 0x25)); // 임의 코드
    result.Set("modelName", Napi::String::New(env, "ECHO2"));
    return result;
  }
  
  // 받은 데이터 크기 출력
  printf("받은 데이터 크기: %d 바이트\n", res);
  
  // 데이터 덤프
  printf("데이터 덤프: ");
  for (int i = 0; i < res; i++) {
    printf("%02x ", data[i]);
  }
  printf("\n");
  
  int model = (res >= 1) ? data[0] : 0;
  printf("모델 코드: %d (0x%02x)\n", model, model);
  
  // 모델 코드와 함께 모델 이름 반환
  Napi::Object result = Napi::Object::New(env);
  result.Set("modelCode", Napi::Number::New(env, model));
  
  // 모델 코드에 따른 모델 이름 매핑 (기존 코드와 동일)
  std::string modelName = "Unknown";
  switch (model) {
    // 기존 케이스 분기...
  }
  
  printf("모델 이름: %s\n", modelName.c_str());
  result.Set("modelName", Napi::String::New(env, modelName));
  return result;
}

bool SXCamera::SendTwoStageCommand(unsigned char cmdCode, unsigned char *responseData, int &responseLength) {
  // 1단계: 명령 전송
  unsigned char cmd[8] = {SX_CMD_TYPE, cmdCode, 0, 0, 0, 0, 0, 0};
  int transferred = 0;
  
  int res = libusb_bulk_transfer(
    handle,
    bulkOutEndpoint,  // OUT 엔드포인트
    cmd, 
    sizeof(cmd),
    &transferred,
    5000   // 타임아웃
  );
  
  if (res < 0) {
    printf("명령 전송 실패 (0x%02x): %s\n", cmdCode, libusb_error_name(res));
    lastError = "명령 전송 실패: " + std::string(libusb_error_name(res));
    return false;
  }
  
  // 2단계: 응답 데이터 읽기
  res = libusb_bulk_transfer(
    handle,
    bulkInEndpoint,  // IN 엔드포인트
    responseData,
    responseLength,
    &transferred,
    5000   // 타임아웃
  );
  
  if (res < 0) {
    printf("응답 데이터 읽기 실패 (0x%02x): %s\n", cmdCode, libusb_error_name(res));
    lastError = "응답 데이터 읽기 실패: " + std::string(libusb_error_name(res));
    return false;
  }
  
  responseLength = transferred;
  return true;
}

bool SXCamera::DebugUSBCommands() {
  int transferred = 0;
  int res = 0;
  
  printf("\n===== USB 디버깅 시작 =====\n");
  printf("카메라 엔드포인트 설정: IN=0x%02x, OUT=0x%02x\n", bulkInEndpoint, bulkOutEndpoint);
  
  // 1. 카메라 모델 요청 테스트 - 정확한 프로토콜 사용
  unsigned char modelCmd[8] = {0xC0, 14, 0, 0, 0, 0, 0, 0};
  printf("\n카메라 모델 요청 명령 전송: ");
  for (int i = 0; i < 8; i++) printf("%02x ", modelCmd[i]);
  printf("\n");
  
  res = libusb_bulk_transfer(handle, bulkOutEndpoint, modelCmd, sizeof(modelCmd), &transferred, 5000);
  printf("결과: %s, 전송: %d 바이트\n", libusb_error_name(res), transferred);
  
  // 응답 확인
  unsigned char modelResponse[2] = {0};
  printf("모델 응답 읽기 시도...\n");
  res = libusb_bulk_transfer(handle, bulkInEndpoint, modelResponse, sizeof(modelResponse), &transferred, 5000);
  printf("결과: %s, 수신: %d 바이트\n", libusb_error_name(res), transferred);
  
  if (transferred > 0) {
    printf("모델 응답 데이터: ");
    for (int i = 0; i < transferred; i++) printf("%02x ", modelResponse[i]);
    printf("\n");
    
    // 모델 해석
    if (transferred >= 2) {
      int modelNum = modelResponse[0] | (modelResponse[1] << 8);
      printf("모델 번호: 0x%04x\n", modelNum);
      
      // 모델 코드에 따른 모델 이름 매핑
      std::string modelName = "Unknown";
      switch (modelNum) {
        case 0x45: modelName = "MX5"; break;
        case 0x84: modelName = "MX5C"; break;
        case 0x47: modelName = "MX7"; break;
        case 0xC7: modelName = "MX7C"; break;
        case 0xC8: modelName = "MX8C"; break;
        case 0x49: modelName = "MX9"; break;
        case 0x05: modelName = "H5"; break;
        case 0x85: modelName = "H5C"; break;
        case 0x09: modelName = "H9"; break;
        case 0x89: modelName = "H9C"; break;
        case 0x10: modelName = "H16"; break;
        case 0x12: modelName = "H18"; break;
        case 0x46: modelName = "LodeStar"; break;
        case 0x17: modelName = "CoStar"; break;
        case 0x25: modelName = "ECHO2"; break;
        case 0xBC: modelName = "ECHO2 (0xBC)"; break; // 새 모델 코드 추가
        default: 
          // 제품 ID로 모델 식별
          libusb_device_descriptor desc;
          libusb_device *dev = libusb_get_device(handle);
          libusb_get_device_descriptor(dev, &desc);
          
          if (desc.idProduct == SX_ECHO2_PID) {
            modelName = "ECHO2";
          } else {
            modelName = "Unknown SX camera";
          }
          break;
      }
      printf("모델 이름: %s\n", modelName.c_str());
    }
  }
  
  // 2. 펌웨어 버전 요청 테스트
  unsigned char fwCmd[8] = {0xC0, 255, 0, 0, 0, 0, 0, 0};
  printf("\n펌웨어 버전 요청 명령 전송: ");
  for (int i = 0; i < 8; i++) printf("%02x ", fwCmd[i]);
  printf("\n");
  
  res = libusb_bulk_transfer(handle, bulkOutEndpoint, fwCmd, sizeof(fwCmd), &transferred, 5000);
  printf("결과: %s, 전송: %d 바이트\n", libusb_error_name(res), transferred);
  
  // 응답 확인
  unsigned char fwResponse[4] = {0};
  printf("펌웨어 버전 응답 읽기 시도...\n");
  res = libusb_bulk_transfer(handle, bulkInEndpoint, fwResponse, sizeof(fwResponse), &transferred, 5000);
  printf("결과: %s, 수신: %d 바이트\n", libusb_error_name(res), transferred);
  
  if (transferred > 0) {
    printf("펌웨어 버전 응답 데이터: ");
    for (int i = 0; i < transferred; i++) printf("%02x ", fwResponse[i]);
    printf("\n");
    
    // 버전 해석
    if (transferred >= 4) {
      int minorVersion = fwResponse[0] | (fwResponse[1] << 8);
      int majorVersion = fwResponse[2] | (fwResponse[3] << 8);
      printf("펌웨어 버전: %d.%d\n", majorVersion, minorVersion);
    }
  }
  
  // 3. 이미지 픽셀 읽기 테스트 (간단한 예)
  printf("\n이미지 픽셀 읽기 테스트...\n");
  
  // 이미지 읽기 명령 구성 (READ_PIXELS=3)
  unsigned char pixelCmd[18] = {
    0x40, 3, 0, 0, 0, 0, 10, 0, // 명령 헤더 (8바이트)
    0, 0,     // X_OFFSET_L, X_OFFSET_H
    0, 0,     // Y_OFFSET_L, Y_OFFSET_H
    0x70, 0x05, // WIDTH_L, WIDTH_H (1392)
    0x10, 0x04, // HEIGHT_L, HEIGHT_H (1040)
    1, 1      // X_BIN, Y_BIN
  };
  
  printf("픽셀 읽기 명령 전송: ");
  for (int i = 0; i < 18; i++) printf("%02x ", pixelCmd[i]);
  printf("\n");
  
  res = libusb_bulk_transfer(handle, bulkOutEndpoint, pixelCmd, sizeof(pixelCmd), &transferred, 5000);
  printf("결과: %s, 전송: %d 바이트\n", libusb_error_name(res), transferred);
  
  // 이미지 데이터 읽기 시도 (작은 블록만)
  unsigned char pixelData[1024] = {0};
  printf("이미지 데이터 읽기 시도 (1KB)...\n");
  res = libusb_bulk_transfer(handle, bulkInEndpoint, pixelData, sizeof(pixelData), &transferred, 10000);
  printf("결과: %s, 수신: %d 바이트\n", libusb_error_name(res), transferred);
  
  if (transferred > 0) {
    printf("처음 16바이트: ");
    for (int i = 0; i < (transferred > 16 ? 16 : transferred); i++) printf("%02x ", pixelData[i]);
    printf("\n");
  }
  
  printf("\n===== USB 디버깅 완료 =====\n");
  return true;
}


Napi::Value SXCamera::DebugCamera(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!handle) {
    Napi::Error::New(env, "카메라가 연결되어 있지 않습니다.").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  bool success = DebugUSBCommands();
  return Napi::Boolean::New(env, success);
}

bool SXCamera::CaptureImageInternal(unsigned short *buffer, int &width, int &height, float exposureTime) {
  int transferred = 0;
  int res = 0;
  
  // 변환: 밀리초 단위 노출 시간 계산
  uint32_t exposureMs = static_cast<uint32_t>(exposureTime * 1000.0f);
  
  // READ_PIXELS_DELAYED 명령 구성 (14바이트 파라미터)
  unsigned char cmd[22] = {
    // 명령 헤더 (8바이트)
    0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 14, 0,
    
    // 파라미터 블록 (14바이트)
    0, 0,                                        // X_OFFSET_L, X_OFFSET_H
    0, 0,                                        // Y_OFFSET_L, Y_OFFSET_H
    0x70, 0x05,                                  // WIDTH_L, WIDTH_H (1392)
    0x10, 0x04,                                  // HEIGHT_L, HEIGHT_H (1040)
    1, 1,                                        // X_BIN, Y_BIN
    static_cast<unsigned char>(exposureMs & 0xFF),               // DELAY_0 (노출 시간 밀리초, 하위 바이트)
    static_cast<unsigned char>((exposureMs >> 8) & 0xFF),        // DELAY_1
    static_cast<unsigned char>((exposureMs >> 16) & 0xFF),       // DELAY_2
    static_cast<unsigned char>((exposureMs >> 24) & 0xFF)        // DELAY_3 (노출 시간 밀리초, 상위 바이트)
  };
  
  printf("READ_PIXELS_DELAYED 명령 전송 (노출 시간: %.2f초)...\n", exposureTime);
  res = libusb_bulk_transfer(handle, bulkOutEndpoint, cmd, sizeof(cmd), &transferred, 5000);
  if (res < 0) {
    lastError = "READ_PIXELS_DELAYED 명령 전송 실패: " + std::string(libusb_error_name(res));
    return false;
  }
  
  printf("노출 시작 (%.2f초)... 카메라 내부 타이머 사용 중\n", exposureTime);
  
  // 노출 완료 대기 (내부 타이머 + 여유 시간)
  std::this_thread::sleep_for(std::chrono::milliseconds(exposureMs + 500));
  printf("노출 완료. 이미지 데이터 수신 시작...\n");
  
  // 이미지 데이터 청크 단위로 읽기
  const int expectedTotalBytes = width * height * 2; // 2바이트(16비트) 픽셀
  unsigned char *imageBuffer = new unsigned char[expectedTotalBytes];
  int totalBytesReceived = 0;
  
  // 여러 작은 청크로 데이터 읽기
  const int chunkSize = 64 * 1024; // 64KB
  int retryCount = 0;
  const int maxRetries = 3;
  
  while (totalBytesReceived < expectedTotalBytes && retryCount < maxRetries) {
    int bytesToRead = std::min(chunkSize, expectedTotalBytes - totalBytesReceived);
    
    printf("청크 데이터 요청: %d 바이트 (총 %d/%d)...\n", 
           bytesToRead, totalBytesReceived, expectedTotalBytes);
    
    res = libusb_bulk_transfer(
      handle,
      bulkInEndpoint,
      imageBuffer + totalBytesReceived,
      bytesToRead,
      &transferred,
      10000 // 10초 타임아웃
    );
    
    if (res < 0) {
      if (res == LIBUSB_ERROR_TIMEOUT) {
        retryCount++;
        printf("타임아웃 발생. 재시도 %d/%d...\n", retryCount, maxRetries);
        
        // 첫 청크에서 타임아웃이 발생하고 재시도가 남아있으면 계속
        if (totalBytesReceived == 0 && retryCount < maxRetries) {
          std::this_thread::sleep_for(std::chrono::milliseconds(500));
          continue;
        }
        
        // 이미 일부 데이터를 받았으면 부분 성공
        if (totalBytesReceived > 0) {
          printf("타임아웃 발생했지만 이미 %d 바이트를 수신했습니다. 부분 성공으로 간주합니다.\n", totalBytesReceived);
          break;
        }
      }
      
      if (retryCount >= maxRetries) {
        delete[] imageBuffer;
        lastError = "이미지 데이터 수신 실패 (최대 재시도 횟수 초과): " + std::string(libusb_error_name(res));
        return false;
      }
    } else {
      // 성공적으로 데이터 수신
      totalBytesReceived += transferred;
      printf("청크 데이터 수신 완료: %d 바이트 (총 %d/%d)\n", 
             transferred, totalBytesReceived, expectedTotalBytes);
      
      // 더 이상 데이터가 없으면 종료
      if (transferred < bytesToRead) {
        printf("더 이상 수신할 데이터가 없습니다. 전송 완료로 간주합니다.\n");
        break;
      }
      
      // 짧은 대기 시간 추가
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
      
      // 재시도 카운터 초기화
      retryCount = 0;
    }
  }
  
  printf("총 이미지 데이터 크기: %d 바이트 (예상: %d 바이트)\n", 
         totalBytesReceived, expectedTotalBytes);
  
  // 데이터 수신 완전히 실패한 경우
  if (totalBytesReceived == 0) {
    delete[] imageBuffer;
    lastError = "이미지 데이터를 수신하지 못했습니다.";
    return false;
  }
  
  // 이미지 데이터 변환 (16비트)
  int processablePixels = totalBytesReceived / 2;
  for (int i = 0; i < processablePixels; i++) {
    buffer[i] = imageBuffer[i*2] | (imageBuffer[i*2+1] << 8);
  }
  
  // 데이터가 부족한 경우 남은 픽셀을 0으로 채움
  if (processablePixels < width * height) {
    printf("경고: 수신된 데이터가 예상보다 적습니다 (%d/%d 픽셀). 남은 픽셀을 0으로 채웁니다.\n", 
           processablePixels, width * height);
    for (int i = processablePixels; i < width * height; i++) {
      buffer[i] = 0;
    }
  }
  
  delete[] imageBuffer;
  return true;
}

Napi::Value SXCamera::CaptureImage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!handle) {
    Napi::Error::New(env, "카메라가 연결되어 있지 않습니다.").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  // 노출 시간 매개변수 (기본값: 1초)
  float exposureTime = 1.0;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    exposureTime = info[0].As<Napi::Number>().FloatValue();
  }
  
  // 이미지 크기 (ECHO2 카메라 해상도: 1392x1040)
  int width = this->width;
  int height = this->height;
  int pixelCount = width * height;
  
  // 이미지 버퍼 할당
  unsigned short *buffer = new unsigned short[pixelCount];
  
  // 이미지 캡처
  bool success = CaptureImageInternal(buffer, width, height, exposureTime);
  
  if (!success) {
    delete[] buffer;
    Napi::Error::New(env, lastError).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  
  // Node.js 버퍼로 변환
  Napi::ArrayBuffer arrayBuffer = Napi::ArrayBuffer::New(env, buffer, pixelCount * sizeof(unsigned short), 
    [](Napi::Env env, void* data) {
      delete[] static_cast<unsigned short*>(data);
    });
  
  Napi::Uint16Array result = Napi::Uint16Array::New(env, pixelCount, arrayBuffer, 0);
  
  // 이미지 정보를 포함한 객체 반환
  Napi::Object imageObj = Napi::Object::New(env);
  imageObj.Set("data", result);
  imageObj.Set("width", Napi::Number::New(env, width));
  imageObj.Set("height", Napi::Number::New(env, height));
  imageObj.Set("bitsPerPixel", Napi::Number::New(env, bitsPerPixel));
  
  return imageObj;
}

Napi::Value SXCamera::IsConnected(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, handle != nullptr);
}

Napi::Value SXCamera::GetLastError(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, lastError);
}

// 모듈 초기화
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return SXCamera::Init(env, exports);
}

NODE_API_MODULE(sx_camera, Init)